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
