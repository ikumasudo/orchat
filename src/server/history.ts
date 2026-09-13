import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm'
import { db, schema } from './db/index.js'
import { escapeLike, snippet } from '../shared/search.js'
import { itemText } from '../shared/responses.js'
import type { AssistantBody, DbMessage, UserBody } from '../shared/types.js'
import { transcript } from './tree.js'
import type { AppTool } from './tools.js'

const { conversations, messages } = schema

// タイトル + 本文 (input_text / output_text の text) の部分一致検索。会話単位で返す
// ponytail: 全走査。遅くなったら messages に検索用テキストの generated column + pg_trgm GIN を追加する
export function searchConversations(userId: string, q: string, opts: { exclude?: string; limit?: number } = {}) {
  const pat = `%${escapeLike(q)}%`
  return db
    .select({ id: conversations.id, title: conversations.title, updatedAt: conversations.updatedAt })
    .from(conversations)
    .where(
      and(
        eq(conversations.userId, userId),
        opts.exclude ? ne(conversations.id, opts.exclude) : undefined,
        sql`(${conversations.title} ilike ${pat} escape '\\' or exists (
          select 1 from ${messages}
          where ${messages.conversationId} = ${conversations.id}
            and jsonb_path_query_array(
                  ${messages.body},
                  'strict $.**.content[*] ? (@.type == "input_text" || @.type == "output_text").text'
                )::text ilike ${pat} escape '\\'))`,
      ),
    )
    .orderBy(desc(conversations.updatedAt))
    .limit(opts.limit ?? 50)
}

const bodyText = (r: DbMessage) => (r.role === 'user' ? [r.body as UserBody] : (r.body as AssistantBody).output).filter((it) => it?.type === 'message').map(itemText).join(' ')
const ymd = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })

// 過去の会話をモデルが自分で検索して読むための function tool。読み取り専用なので承認なし
export function historyTools(userId: string, currentConversationId: string): AppTool[] {
  return [
    {
      name: 'search_past_chats',
      description:
        'ユーザーの過去のチャット (この会話以外) をキーワードで検索する。タイトルと本文の部分一致なので、文章ではなく短い単語 1 つで検索し、見つからなければ同義語や別の表記で試す。結果は 1 行 1 件 (id | タイトル | 更新日 | 抜粋)。詳細は read_past_chat で id を指定して読む',
      parameters: { type: 'object', properties: { query: { type: 'string', description: '検索する単語 (短く)' } }, required: ['query'], additionalProperties: false },
      needsApproval: false,
      async execute(args) {
        const q = String((args as { query?: unknown })?.query ?? '').trim()
        if (!q) return 'エラー: query が空です'
        const hits = await searchConversations(userId, q, { exclude: currentConversationId, limit: 10 })
        if (!hits.length) return '見つかりませんでした。別の短いキーワードで試してください'
        const rows = (await db.query.messages.findMany({
          where: inArray(
            messages.conversationId,
            hits.map((h) => h.id),
          ),
        })) as DbMessage[]
        return hits
          .map((h) => {
            const text = rows.filter((r) => r.conversationId === h.id).map(bodyText).join(' ')
            return `${h.id} | ${h.title || '(無題)'} | ${ymd(h.updatedAt)} | ${snippet(text, q)}`
          })
          .join('\n')
      },
    },
    {
      name: 'read_past_chat',
      description: 'search_past_chats で得た id の会話の本文 (現在のブランチ) を読む。長い場合は末尾が省略される',
      parameters: { type: 'object', properties: { id: { type: 'string', description: '会話の id (UUID)' } }, required: ['id'], additionalProperties: false },
      needsApproval: false,
      async execute(args) {
        const id = String((args as { id?: unknown })?.id ?? '')
        const conv = await db.query.conversations.findFirst({ where: and(eq(conversations.id, id), eq(conversations.userId, userId)) }).catch(() => undefined)
        if (!conv) return 'エラー: その id の会話はありません'
        const rows = (await db.query.messages.findMany({ where: eq(messages.conversationId, conv.id) })) as DbMessage[]
        return `# ${conv.title || '(無題)'} (${ymd(conv.updatedAt)})\n\n${transcript(rows, conv.leafId, 20_000)}`
      },
    },
  ]
}
