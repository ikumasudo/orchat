// \( ... \) → $ ... $、\[ ... \] → $$ ... $$ に寄せる描画用の正規化。
// remark-math は \( / \[ 区切りを解釈しないため、描画直前に通す。DB の保存内容は変えない。
// コードフェンス (``` / ~~~) とインラインコード (`...`) の中、エスケープ済み (\\() は触らない。
export function normalizeMathDelimiters(text: string): string {
  const lines = text.split('\n')
  const out: string[] = []
  let buf: string[] = []
  let fence: { ch: string; len: number } | null = null
  const flush = () => {
    if (buf.length > 0) {
      out.push(convertOutsideCode(buf.join('\n')))
      buf = []
    }
  }
  for (const line of lines) {
    const m = line.match(/^\s*(`{3,}|~{3,})/)
    if (fence) {
      out.push(line)
      if (m && m[1][0] === fence.ch && m[1].length >= fence.len) fence = null
    } else if (m) {
      flush()
      fence = { ch: m[1][0], len: m[1].length }
      out.push(line)
    } else {
      buf.push(line)
    }
  }
  flush()
  return out.join('\n')
}

// インラインコード (`...`) の外側だけを変換する
function convertOutsideCode(segment: string): string {
  return segment
    .split(/(`+[^`\n]*?`+)/g)
    .map((part, i) => (i % 2 === 1 ? part : convertDelimiters(part)))
    .join('')
}

function convertDelimiters(s: string): string {
  return s
    .replace(/(?<!\\)\\\[([\s\S]*?)(?<!\\)\\\]/g, '$$$$$1$$$$')
    .replace(/(?<!\\)\\\(([\s\S]*?)(?<!\\)\\\)/g, '$$$1$$')
}
