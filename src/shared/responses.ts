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
