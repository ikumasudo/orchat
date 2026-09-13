// ILIKE のワイルドカード (`%` `_`) とエスケープ文字 (`\`) をリテラル扱いにする。
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}

// q の最初の一致 (大文字小文字無視) の前後を len 文字で切り出す。一致なしは先頭 len 文字
export function snippet(text: string, q: string, len = 160): string {
  const t = text.replace(/\s+/g, ' ').trim()
  const i = q ? t.toLowerCase().indexOf(q.toLowerCase()) : -1
  const start = Math.max(0, Math.min(i < 0 ? 0 : i - Math.floor(len / 3), t.length - len))
  const s = t.slice(start, start + len)
  return (start > 0 ? '…' : '') + s + (start + len < t.length ? '…' : '')
}

export const ymd = (d: Date) => d.toLocaleDateString('ja-JP', { timeZone: 'Asia/Tokyo' })

// 直近の会話一覧を instructions 用の文にする。search_past_chats の出力と同じ「id | タイトル | 日付」形式
export function recentChatsPrompt(rows: { id: string; title: string; updatedAt: Date }[]): string {
  if (!rows.length) return ''
  return [
    'ユーザーの最近のチャット (新しい順、id | タイトル | 更新日):',
    ...rows.map((r) => `${r.id} | ${r.title || '(無題)'} | ${ymd(r.updatedAt)}`),
    '関係しそうな話題ならまず read_past_chat で該当会話を読んでから答えてください。ここに無くても以前の相談やユーザー固有の事情・好みが関係しそうなら search_past_chats で探してください。',
  ].join('\n')
}
