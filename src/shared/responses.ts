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
    case 'response.function_call_arguments.delta':
      // arguments は output_item.done で完成形が来るので連結しない
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

// 2 回目以降のリクエストのイベントを 1 ターンの通し番号に直す純関数。
// output_index をずらし、completed/done の output はそれまでの items に連結、usage の数値は合算する。
// サーバーが run に push する前に通す。クライアントは applyEvent のまま畳める
export function offsetEvent(ev: ResponseEvent, base: number, prev: { output: Item[]; usage?: Usage }): ResponseEvent {
  const out = base === 0 ? ev : { ...ev, ...(ev.output_index != null ? { output_index: ev.output_index + base } : {}) }
  if ((ev.type === 'response.completed' || ev.type === 'response.done') && ev.response) {
    return { ...out, response: { ...ev.response, output: [...prev.output, ...(ev.response.output ?? [])], usage: mergeUsage(prev.usage, ev.response.usage) } }
  }
  return out
}

const num = (v: unknown) => (typeof v === 'number' ? v : 0)

function mergeUsage(a?: Usage, b?: Usage): Usage | undefined {
  if (!a) return b
  if (!b) return a
  const out: Usage = { ...a, ...b }
  for (const k of ['input_tokens', 'output_tokens', 'cost'] as const) {
    if (a[k] != null || b[k] != null) out[k] = num(a[k]) + num(b[k])
  }
  if (a.output_tokens_details || b.output_tokens_details) {
    const r = { ...a.output_tokens_details, ...b.output_tokens_details }
    if (a.output_tokens_details?.reasoning_tokens != null || b.output_tokens_details?.reasoning_tokens != null) {
      r.reasoning_tokens = num(a.output_tokens_details?.reasoning_tokens) + num(b.output_tokens_details?.reasoning_tokens)
    }
    out.output_tokens_details = r
  }
  if (a.server_tool_use_details || b.server_tool_use_details) {
    const d = { ...a.server_tool_use_details, ...b.server_tool_use_details }
    for (const k of ['web_search_requests', 'tool_calls_executed'] as const) {
      if (a.server_tool_use_details?.[k] != null || b.server_tool_use_details?.[k] != null) {
        d[k] = num(a.server_tool_use_details?.[k]) + num(b.server_tool_use_details?.[k])
      }
    }
    out.server_tool_use_details = d
  }
  return out
}

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
