import type { Item, ResponseEvent, Usage } from './types.js'

export type ResponseState = { output: Item[]; usage?: Usage; id?: string; model?: string; completed: boolean }

export const initialState = (): ResponseState => ({ output: [], completed: false })

// Responses API のストリームイベントを output items に畳み込む。
// *.added / *.done は item / part をそのまま置き、*.delta は text に連結、response.completed で全体を置き換える。
// 未知の item type もそのまま残る (DB に透過保存し、UI は知っている type だけ描く)
export function applyEvent(s: ResponseState, ev: ResponseEvent): ResponseState {
  const i = ev.output_index
  switch (ev.type) {
    case 'response.output_item.added':
    case 'response.output_item.done':
      if (i != null && ev.item) s.output[i] = ev.item
      break
    case 'response.content_part.added':
    case 'response.content_part.done':
      if (i != null && ev.part && ev.content_index != null) (itemAt(s, i).content ??= [])[ev.content_index] = ev.part
      break
    case 'response.reasoning_summary_part.added':
    case 'response.reasoning_summary_part.done':
      if (i != null && ev.part && ev.summary_index != null) (itemAt(s, i).summary ??= [])[ev.summary_index] = ev.part
      break
    case 'response.output_text.annotation.added':
      if (i != null && ev.annotation && ev.content_index != null) {
        const part = ((itemAt(s, i).content ??= [])[ev.content_index] ??= { type: 'output_text', text: '' })
        ;(part.annotations ??= []).push(ev.annotation)
      }
      break
    case 'response.completed':
    case 'response.done':
      if (ev.response?.output) s.output = ev.response.output
      s.usage = ev.response?.usage ?? s.usage
      s.id = ev.response?.id ?? s.id
      s.model = ev.response?.model ?? s.model
      s.completed = true
      break
    case 'response.created':
      s.id = ev.response?.id ?? s.id
      s.model = ev.response?.model ?? s.model
      break
    default:
      if (ev.type.endsWith('.delta') && typeof ev.delta === 'string' && i != null) {
        const item = itemAt(s, i)
        const parts = ev.summary_index != null ? (item.summary ??= []) : (item.content ??= [])
        const idx = ev.summary_index ?? ev.content_index ?? 0
        const part = (parts[idx] ??= { type: ev.type.includes('reasoning') ? 'reasoning_text' : 'output_text', text: '' })
        part.text = (part.text ?? '') + ev.delta
      } else if (/^response\.[a-z_:]+\.(in_progress|searching|completed|failed)$/.test(ev.type) && i != null) {
        // response.web_search_call.searching 等: item の status を更新
        itemAt(s, i).status = ev.type.split('.').pop()
      }
  }
  return s
}

const itemAt = (s: ResponseState, i: number) => (s.output[i] ??= { type: 'unknown' })

// UI 用ヘルパー
export const itemText = (item: Item) => [...(item.content ?? []), ...(item.summary ?? [])].map((p) => p.text ?? '').join('')
export const isToolItem = (item: Item) => item.type.startsWith('openrouter:') || item.type.endsWith('_call')

// アシスタント output を「ステップ」と「回答」に分ける。
// 末尾に連続する message item が回答、それより前 (reasoning・ツール・途中 message) がすべてステップ。
// ストリーミング中はこの境界が動く (回答を流している途中でツール呼び出しが来たら、そのテキストはステップ側へ移る)。
export function splitStepsAnswer(output: Item[]): { steps: Item[]; answer: Item[] } {
  let i = output.length
  while (i > 0 && output[i - 1]?.type === 'message') i--
  return { steps: output.slice(0, i), answer: output.slice(i) }
}

// ユーザーに渡す最終成果物は /workspace/home/outputs/ 配下だけ。引用の filename は home からの相対パスなので 'outputs/' 始まりだけを公開する
export const isPublishedFile = (filename?: string): filename is string =>
  !!filename && filename.startsWith('outputs/') && !filename.split('/').some((s) => s === '..' || s === '')

// shell が作成/変更した公開対象ファイル (file_id で重複排除、output 順)
export function shellFiles(items: Item[]): Array<{ file_id: string; filename: string }> {
  const out = new Map<string, { file_id: string; filename: string }>()
  for (const it of items) {
    if (it.type !== 'openrouter:shell') continue
    for (const f of it.files ?? []) if (f.file_id && isPublishedFile(f.filename)) out.set(f.file_id, { file_id: f.file_id, filename: f.filename.split('/').pop() || f.file_id })
  }
  return [...out.values()]
}

// ---- ツールループ用 (1 ターンに複数リクエストを流して 1 つの output に連結する) ----

// usage の数値フィールドを合算する (両方数値なら足す、片方だけなら残す、object は再帰)
export function addUsage(a?: Usage, b?: Usage): Usage | undefined {
  if (!a || !b) return a ?? b
  const out: Record<string, unknown> = { ...a }
  for (const [k, v] of Object.entries(b)) {
    const x = out[k]
    out[k] = typeof x === 'number' && typeof v === 'number' ? x + v : x && v && typeof x === 'object' && typeof v === 'object' ? addUsage(x as Usage, v as Usage) : (v ?? x)
  }
  return out as Usage
}

// 2 回目以降のリクエストのイベントを、前回までの output の後ろに続くように書き換える。
// applyEvent はリクエスト単位の output_index / response.completed を前提にしているので、run に push する前にこれで揃える
export function offsetEvent(ev: ResponseEvent, base: number, prev: { output: Item[]; usage?: Usage }): ResponseEvent {
  const out: ResponseEvent = ev.output_index != null ? { ...ev, output_index: ev.output_index + base } : ev
  if ((ev.type === 'response.completed' || ev.type === 'response.done') && ev.response) {
    return { ...out, response: { ...ev.response, output: prev.output.concat(ev.response.output ?? []), usage: addUsage(prev.usage, ev.response.usage) } }
  }
  return out
}

// アプリが作る item (function_call_output、承認状態の更新) を流すための合成イベント
export const itemDone = (output_index: number, item: Item): ResponseEvent => ({ type: 'response.output_item.done', output_index, item })
