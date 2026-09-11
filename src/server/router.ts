import { os, ORPCError } from '@orpc/server'
import { z } from 'zod'
import { and, desc, eq, sql, gte, lt } from 'drizzle-orm'
import { db, schema } from './db/index.js'
import type { User } from './auth.js'
import { chatSettings, serverTools, userPart, type AssistantBody, type DbMessage, type Item, type StreamEvent, type UserBody, type UserPart } from '../shared/types.js'
import { listModels, responsesStream } from './openrouter.js'
import { applyEvent, initialState } from '../shared/responses.js'
import { deepestLeaf, pathToRoot, siblings } from './tree.js'

const base = os.$context<{ user: User }>()
const { conversations, messages, attachments, users } = schema

async function ownConversation(userId: string, id: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.userId, userId)) })
  if (!conv) throw new ORPCError('NOT_FOUND')
  return conv
}

const models = {
  list: base.handler(() => listModels()),
}

const conversationsRouter = {
  list: base.handler(({ context }) =>
    db
      .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
      .from(conversations)
      .where(eq(conversations.userId, context.user.id))
      .orderBy(desc(conversations.updatedAt)),
  ),
  get: base.input(z.object({ id: z.uuid() })).handler(async ({ context, input }) => {
    const conversation = await ownConversation(context.user.id, input.id)
    const rows = (await db.query.messages.findMany({ where: eq(messages.conversationId, input.id) })) as DbMessage[]
    return { conversation, path: pathToRoot(rows, conversation.leafId), siblings: siblings(rows) }
  }),
  create: base.input(z.object({ settings: chatSettings })).handler(async ({ context, input }) => {
    const [conv] = await db.insert(conversations).values({ userId: context.user.id, settings: input.settings }).returning()
    return conv
  }),
  delete: base.input(z.object({ id: z.uuid() })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.id)
    await db.delete(conversations).where(eq(conversations.id, input.id))
  }),
  updateSettings: base.input(z.object({ id: z.uuid(), settings: chatSettings })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.id)
    await db.update(conversations).set({ settings: input.settings }).where(eq(conversations.id, input.id))
  }),
  // ブランチ切替: 指定ノードの子孫で最新の葉まで降りる
  setLeaf: base.input(z.object({ id: z.uuid(), messageId: z.uuid() })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.id)
    const rows = await db.query.messages.findMany({ where: eq(messages.conversationId, input.id) })
    const leafId = deepestLeaf(rows, input.messageId)
    await db.update(conversations).set({ leafId }).where(eq(conversations.id, input.id))
    return { leafId }
  }),
}

// attachment:<uuid> 参照を data URL に解決する
async function resolveAttachments(userId: string, items: Item[]): Promise<Item[]> {
  const out: Item[] = []
  for (const item of items) {
    if (item.type !== 'message' || item.role !== 'user' || !Array.isArray(item.content)) {
      out.push(item)
      continue
    }
    const content = []
    for (const p of item.content as UserPart[]) {
      const ref = p.type === 'input_image' ? p.image_url : p.type === 'input_file' ? p.file_data : ''
      if (!ref.startsWith('attachment:')) {
        content.push(p)
        continue
      }
      const att = await db.query.attachments.findFirst({
        where: and(eq(attachments.id, ref.slice('attachment:'.length)), eq(attachments.userId, userId)),
      })
      if (!att) throw new ORPCError('NOT_FOUND', { message: `attachment ${ref}` })
      const dataUrl = `data:${att.mime};base64,${att.data.toString('base64')}`
      content.push(p.type === 'input_image' ? { ...p, image_url: dataUrl } : { ...p, file_data: dataUrl })
    }
    out.push({ ...item, content })
  }
  return out
}

const textOf = (content: UserPart[]) => content.filter((p) => p.type === 'input_text').map((p) => p.text).join('\n')

const messagesRouter = {
  send: base
    .input(
      z.object({
        conversationId: z.uuid(),
        // 新規送信: parentId の子として user message を作る。再生成: content を省略し parentId を直接親にする
        parentId: z.uuid().nullable(),
        content: z.array(userPart).min(1).optional(),
        settings: chatSettings,
      }),
    )
    .handler(async function* ({ context, input, signal }): AsyncGenerator<StreamEvent> {
      const conv = await ownConversation(context.user.id, input.conversationId)
      let parentId = input.parentId

      if (input.content) {
        const body: UserBody = { type: 'message', role: 'user', content: input.content }
        const [userMsg] = await db.insert(messages).values({ conversationId: conv.id, parentId, role: 'user', body }).returning()
        parentId = userMsg.id
        const title = conv.title || textOf(input.content).slice(0, 50)
        await db.update(conversations).set({ leafId: userMsg.id, title, settings: input.settings, updatedAt: new Date() }).where(eq(conversations.id, conv.id))
        yield { type: 'user', message: userMsg as DbMessage }
      }

      // 履歴 = user message item + assistant の output items をそのまま並べる (reasoning / server tool の item も含めて返送する)
      const rows = (await db.query.messages.findMany({ where: eq(messages.conversationId, conv.id) })) as DbMessage[]
      const history = pathToRoot(rows, parentId).flatMap((r) => (r.role === 'user' ? [r.body as Item] : (r.body as AssistantBody).output))
      const inputItems = await resolveAttachments(context.user.id, history)

      const s = input.settings
      const tools = serverTools.filter((t) => s.tools?.includes(t.id)).map((t) => ('parameters' in t ? { type: t.id, parameters: t.parameters } : { type: t.id }))
      // モデルは今日の日付を知らない (Web 検索の結果を「古い」と誤認する) ので送信時だけ渡す。DB には保存しない
      const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      const body: Record<string, unknown> = {
        model: s.model,
        instructions: `今日の日付は ${today} (JST) です。`,
        input: inputItems,
        ...(s.reasoning && { reasoning: s.reasoning }),
        ...(tools.length && { tools }),
      }

      const state = initialState()
      let error: string | undefined
      try {
        for await (const event of responsesStream(body, signal)) {
          applyEvent(state, event)
          yield { type: 'event', event }
        }
      } catch (e) {
        // 途中エラー / abort でも生成済み部分は保存する
        error = e instanceof Error ? e.message : String(e)
      }

      // 何も生成されずに失敗したときは assistant を保存しない (次ターンの履歴に空メッセージが混ざるのを防ぐ)
      const output = state.output.filter(Boolean)
      if (error && !output.length) throw new ORPCError('BAD_GATEWAY', { message: error })

      const assistant: AssistantBody = error ? { output, error } : { output }
      const cost = typeof state.usage?.cost === 'number' ? String(state.usage.cost) : null
      const [saved] = await db
        .insert(messages)
        .values({ conversationId: conv.id, parentId, role: 'assistant', body: assistant, model: state.model ?? s.model, usage: state.usage, cost, generationId: state.id })
        .returning()
      await db.update(conversations).set({ leafId: saved.id, updatedAt: new Date() }).where(eq(conversations.id, conv.id))
      yield { type: 'done', message: saved as DbMessage }
      if (error && !signal?.aborted) throw new ORPCError('BAD_GATEWAY', { message: error })
    }),
}

const attachmentsRouter = {
  upload: base.input(z.object({ file: z.file().max(20 * 1024 * 1024) })).handler(async ({ context, input }) => {
    const { file } = input
    const [row] = await db
      .insert(attachments)
      .values({ userId: context.user.id, filename: file.name, mime: file.type || 'application/octet-stream', size: file.size, data: Buffer.from(await file.arrayBuffer()) })
      .returning({ id: attachments.id })
    return { id: row.id, ref: `attachment:${row.id}` }
  }),
}

const usageRouter = {
  // month: 'YYYY-MM'。admin は全員分、一般ユーザーは自分だけ
  summary: base.input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) })).handler(async ({ context, input }) => {
    const from = new Date(`${input.month}-01T00:00:00Z`)
    const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1))
    const where = [gte(messages.createdAt, from), lt(messages.createdAt, to), eq(messages.role, 'assistant')]
    if (!context.user.admin) where.push(eq(conversations.userId, context.user.id))
    return db
      .select({
        email: users.email,
        name: users.name,
        cost: sql<string>`coalesce(sum(${messages.cost}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(messages)
      .innerJoin(conversations, eq(messages.conversationId, conversations.id))
      .innerJoin(users, eq(conversations.userId, users.id))
      .where(and(...where))
      .groupBy(users.id)
      .orderBy(desc(sql`sum(${messages.cost})`))
  }),
}

export const router = {
  me: base.handler(({ context }) => context.user),
  models,
  conversations: conversationsRouter,
  messages: messagesRouter,
  attachments: attachmentsRouter,
  usage: usageRouter,
}
export type Router = typeof router
