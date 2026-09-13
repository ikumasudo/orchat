// 会話ツリーの純関数。会話の全メッセージをロードして JS で計算する
// ponytail: 会話全件ロード。1 会話が数千件を超えたら recursive CTE に

import type { AssistantBody, DbMessage, UserBody } from '../shared/types.js'
import { itemText } from '../shared/responses.js'

type Node = { id: string; parentId: string | null; createdAt: Date }

export function pathToRoot<T extends Node>(rows: T[], leafId: string | null): T[] {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const path: T[] = []
  for (let cur = leafId ? byId.get(leafId) : undefined; cur; cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    path.push(cur)
  }
  return path.reverse()
}

// parentId ('' = root) → 兄弟 id の配列 (作成順)
export function siblings<T extends Node>(rows: T[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const r of [...rows].sort((a, b) => +a.createdAt - +b.createdAt)) {
    ;(out[r.parentId ?? ''] ??= []).push(r.id)
  }
  return out
}

// leaf を切り替えたとき、その子孫の中で最新の葉まで降りる
export function deepestLeaf<T extends Node>(rows: T[], id: string): string {
  const sib = siblings(rows)
  let cur = id
  for (let kids = sib[cur]; kids?.length; kids = sib[cur]) cur = kids[kids.length - 1]
  return cur
}

// 会話の葉までの経路を `user: …` / `assistant: …` の行に整形する (reasoning / tool item は捨てる)。maxChars 超は末尾を切る
export function transcript(rows: DbMessage[], leafId: string | null, maxChars: number): string {
  const lines = pathToRoot(rows, leafId).map((r) => {
    const items = r.role === 'user' ? [r.body as UserBody] : (r.body as AssistantBody).output
    const text = items.filter((it) => it?.type === 'message').map(itemText).join('\n').trim()
    return `${r.role}: ${text}`
  })
  const all = lines.join('\n\n')
  return all.length > maxChars ? `${all.slice(0, maxChars)}\n[…以下省略]` : all
}
