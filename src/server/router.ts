import { os, ORPCError } from '@orpc/server'
import { z } from 'zod'
import { and, desc, eq, sql, gte, lt } from 'drizzle-orm'
import { db, schema } from './db/index.js'
import type { User } from './auth.js'
import { chatSettings, conversationTitle, serverTools, userPart, type AssistantBody, type ChatSettings, type DbMessage, type Item, type ResponseEvent, type UserBody, type UserPart } from '../shared/types.js'
import { allowedModels, autoRouter, isModelAllowed, listModels, responsesStream } from './openrouter.js'
import { generateTitle } from './title.js'
import { itemText } from '../shared/responses.js'
import { deepestLeaf, pathToRoot, siblings } from './tree.js'
import { historyTools, recentConversations, searchConversations } from './history.js'
import { recentChatsPrompt } from '../shared/search.js'
import { createRun, runs, type Run } from './runs.js'
import { resolveTools, runTurn, toFunctionTool, toInputItem, type AppTool } from './tools.js'
import { loadSkills, skillsPrompt, skillTools } from './skills.js'

const base = os.$context<{ user: User }>()
const { conversations, messages, attachments, users } = schema

async function ownConversation(userId: string, id: string) {
  const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.userId, userId)) })
  if (!conv) throw new ORPCError('NOT_FOUND')
  return conv
}

// MODELS の強制。許可リストは起動時固定なので、変更には再起動が必要
function assertModelAllowed(model: string) {
  if (!isModelAllowed(model)) throw new ORPCError('BAD_REQUEST', { message: `このモデルは許可されていません: ${model}` })
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
  search: base.input(z.object({ q: z.string().min(1).max(200) })).handler(({ context, input }) => {
    const q = input.q.trim()
    return q ? searchConversations(context.user.id, q) : []
  }),
  get: base.input(z.object({ id: z.uuid() })).handler(async ({ context, input }) => {
    const conversation = await ownConversation(context.user.id, input.id)
    const rows = (await db.query.messages.findMany({ where: eq(messages.conversationId, input.id) })) as DbMessage[]
    const run = runs.get(input.id)
    return { conversation, path: pathToRoot(rows, conversation.leafId), siblings: siblings(rows), active: run ? { parentId: run.parentId } : null }
  }),
  create: base.input(z.object({ settings: chatSettings })).handler(async ({ context, input }) => {
    assertModelAllowed(input.settings.model)
    const [conv] = await db.insert(conversations).values({ userId: context.user.id, settings: input.settings }).returning()
    return conv
  }),
  delete: base.input(z.object({ id: z.uuid() })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.id)
    await db.delete(conversations).where(eq(conversations.id, input.id))
  }),
  updateSettings: base.input(z.object({ id: z.uuid(), settings: chatSettings })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.id)
    assertModelAllowed(input.settings.model)
    await db.update(conversations).set({ settings: input.settings }).where(eq(conversations.id, input.id))
  }),
  rename: base.input(z.object({ id: z.uuid(), title: conversationTitle })).handler(async ({ context, input }) => {
    const [renamed] = await db
      .update(conversations)
      .set({ title: input.title, titleManual: true })
      .where(and(eq(conversations.id, input.id), eq(conversations.userId, context.user.id)))
      .returning({ id: conversations.id, title: conversations.title })
    if (!renamed) throw new ORPCError('NOT_FOUND')
    return renamed
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

// 生成本体。リクエストとは独立に走り、終わったら保存する。function tool の実行ループは runTurn
// titleFrom: 初回送信の user テキスト。渡されたときだけ応答完了後にタイトルを LLM で付け直す (一覧は 5 秒ポーリングで拾う)
async function generate(conversationId: string, parentId: string | null, run: Run<ResponseEvent>, body: Record<string, unknown>, s: ChatSettings, tools: AppTool[], userId: string, titleFrom?: string) {
  const state = await runTurn({ stream: responsesStream, body, tools, run, userId })
  let error = state.error
  try {
    // 何も生成されずに失敗したときは assistant を保存しない (次ターンの履歴に空メッセージが混ざるのを防ぐ)
    const output = state.output.filter(Boolean)
    if (!error || output.length) {
      const assistant: AssistantBody = error ? { output, error } : { output }
      const cost = typeof state.usage?.cost === 'number' ? String(state.usage.cost) : null
      const [saved] = await db
        .insert(messages)
        .values({ conversationId, parentId, role: 'assistant', body: assistant, model: state.model ?? s.model, usage: state.usage, cost, generationId: state.id })
        .returning()
      await db.update(conversations).set({ leafId: saved.id, updatedAt: new Date() }).where(eq(conversations.id, conversationId))
      if (titleFrom) {
        const answer = output.filter((it) => it.type === 'message').map(itemText).join('\n')
        generateTitle(conversationId, titleFrom, answer).catch((e) => console.error(`title ${conversationId}: ${e instanceof Error ? e.message : e}`))
      }
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  } finally {
    if (error) console.error(`generate ${conversationId}: ${error}`)
    runs.delete(conversationId)
    run.end(error)
  }
}

const messagesRouter = {
  // 生成を開始して即返す。イベントは stream で受け取る (切断しても生成は続く)
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
    .handler(async ({ context, input }) => {
      const conv = await ownConversation(context.user.id, input.conversationId)
      assertModelAllowed(input.settings.model)
      if (runs.has(conv.id)) throw new ORPCError('CONFLICT', { message: '応答を生成中です' })
      let parentId = input.parentId
      let userMsg: DbMessage | undefined
      const titleFrom = !conv.title && !conv.titleManual && input.content ? textOf(input.content) : undefined // 初回送信だけ

      if (input.content) {
        const body: UserBody = { type: 'message', role: 'user', content: input.content }
        ;[userMsg] = (await db.insert(messages).values({ conversationId: conv.id, parentId, role: 'user', body }).returning()) as DbMessage[]
        parentId = userMsg.id
        // タイトルはDB行の最新値で判定し、空の自動タイトルだけ初回フォールバックで埋める。手動設定はCASEで保持する
        const fallbackTitle = textOf(input.content).slice(0, 50)
        await db
          .update(conversations)
          .set({
            leafId: userMsg.id,
            title: sql`case when ${conversations.title} = '' and ${conversations.titleManual} = false then ${fallbackTitle} else ${conversations.title} end`,
            settings: input.settings,
            updatedAt: new Date(),
          })
          .where(eq(conversations.id, conv.id))
      }

      // 履歴 = user message item + assistant の output items をそのまま並べる (reasoning / server tool の item も含めて返送する)
      const rows = (await db.query.messages.findMany({ where: eq(messages.conversationId, conv.id) })) as DbMessage[]
      const history = pathToRoot(rows, parentId).flatMap((r) => (r.role === 'user' ? [r.body as Item] : (r.body as AssistantBody).output))
      const inputItems = (await resolveAttachments(context.user.id, history)).map(toInputItem)

      const s = input.settings
      const useHistory = !!s.tools?.includes('app:history')
      // Skill は送信のたびに読み直す (追加・変更が再起動なしで反映される)。一覧は 1 つ以上あるときだけ提示する
      const { skills, warnings } = await loadSkills()
      for (const w of warnings) console.warn(`skills: ${w}`)
      const appTools = [...(await resolveTools(s, context.user.id)), ...(useHistory ? historyTools(context.user.id, conv.id) : []), ...skillTools(skills)]
      // 直近の会話をモデルに見せる。検索は自発的に起きにくいので、まず一覧で「最近の関心」を渡す
      // ponytail: 10 件固定。トークンが気になれば件数を減らす
      const recent = useHistory ? await recentConversations(context.user.id, conv.id) : []
      const tools = [
        ...serverTools.filter((t) => s.tools?.includes(t.id)).map((t) => ('parameters' in t ? { type: t.id, parameters: t.parameters } : { type: t.id })),
        ...appTools.map(toFunctionTool),
      ]
      // モデルは今日の日付を知らない (Web 検索の結果を「古い」と誤認する) ので送信時だけ渡す。DB には保存しない
      const today = new Date().toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' })
      const body: Record<string, unknown> = autoRouter(
        {
          model: s.model,
          instructions: [
            `今日の日付は ${today} (JST) です。`,
            // ツール description だけだと「前に聞いた」と言われたときしか動かないので、一覧と共に自発的に使うよう明示する
            useHistory && (recentChatsPrompt(recent) || 'ユーザーが明示しなくても、以前の相談の続きやユーザー固有の事情・好みが関係しそうな話題なら、まず search_past_chats で過去のチャットを確認してから答えてください。'),
            skills.length > 0 && skillsPrompt(skills),
            // ファイルを /workspace/home の外に書くと保存されず、モデルが sandbox: 等の偽リンクを書く原因になる
            s.tools?.includes('openrouter:shell') &&
              'シェルでファイルを作成する場合は /workspace/home 以下に保存してください。ユーザーに渡す最終成果物だけを /workspace/home/outputs/ に保存してください (outputs/ 以外のファイルは画面に表示されません)。表示されるファイルは回答の下にダウンロードボタンとして並ぶので、回答にダウンロードURLや sandbox: 形式のリンクを書かないでください。',
          ]
            .filter(Boolean)
            .join('\n'),
          input: inputItems,
          ...(s.reasoning && { reasoning: s.reasoning }),
          ...(tools.length && { tools }),
        },
        allowedModels(),
      )

      const run = createRun<ResponseEvent>(parentId)
      runs.set(conv.id, run)
      void generate(conv.id, parentId, run, body, s, appTools, context.user.id, titleFrom)
      return { parentId, message: userMsg }
    }),
  // 進行中の生成に接続する。バッファ済みイベントを再生してから live を流し、終わったら閉じる
  stream: base.input(z.object({ conversationId: z.uuid() })).handler(async function* ({ context, input, signal }): AsyncGenerator<ResponseEvent> {
    await ownConversation(context.user.id, input.conversationId)
    const run = runs.get(input.conversationId) as Run<ResponseEvent> | undefined
    if (!run) return
    yield* run.subscribe(signal)
    if (run.error && !run.abort.signal.aborted) throw new ORPCError('BAD_GATEWAY', { message: run.error })
  }),
  stop: base.input(z.object({ conversationId: z.uuid() })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.conversationId)
    runs.get(input.conversationId)?.abort.abort()
  }),
  // 承認待ちの function_call を承認 / 拒否する
  decide: base.input(z.object({ conversationId: z.uuid(), callId: z.string(), approved: z.boolean() })).handler(async ({ context, input }) => {
    await ownConversation(context.user.id, input.conversationId)
    const pending = runs.get(input.conversationId)?.pending.get(input.callId)
    if (!pending) throw new ORPCError('NOT_FOUND', { message: '承認待ちのツール呼び出しがありません' })
    pending.resolve(input.approved)
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
