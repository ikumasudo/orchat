// ILIKE のワイルドカード (`%` `_`) とエスケープ文字 (`\`) をリテラル扱いにする。
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`)
}
