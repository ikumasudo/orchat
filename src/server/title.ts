import { eq } from 'drizzle-orm'
import { db, schema } from './db/index.js'
import { responsesText } from './openrouter.js'

// 既定は Auto Router (cost 指定なし = 安価な帯)。モデルの入れ替わりに追従するので固定 id を保守しなくてよい
const TITLE_MODEL = () => process.env.TITLE_MODEL || 'openrouter/auto'

// モデル出力をタイトルに整える: 1 行目だけ、引用符と末尾の句点を剥がし、50 文字まで
export function cleanTitle(raw: string): string {
  const line = raw.trim().split('\n')[0]?.trim() ?? ''
  return line
    .replace(/^[「『"'“‘*#\s]+|[」』"'”’*\s]+$/g, '')
    .replace(/[。.]+$/, '')
    .trim()
    .slice(0, 50)
}

// 初回の user 発言と assistant 応答からタイトルを生成して保存する。失敗しても先頭 50 文字のフォールバックが残る
export async function generateTitle(conversationId: string, userText: string, assistantText: string) {
  const title = cleanTitle(
    await responsesText({
      model: TITLE_MODEL(),
      instructions: 'この会話の内容を表す短いタイトルを、会話と同じ言語で 15 文字程度で 1 つだけ出力してください。引用符・句点・前置き・説明は不要です。',
      input: `[ユーザー]\n${userText.slice(0, 2000)}\n\n[アシスタント]\n${assistantText.slice(0, 2000)}`,
      max_output_tokens: 1000, // auto が reasoning モデルに振ると推論分も消費する (60 では使い切って message が出なかった)
    }),
  )
  if (title) await db.update(schema.conversations).set({ title }).where(eq(schema.conversations.id, conversationId))
}
