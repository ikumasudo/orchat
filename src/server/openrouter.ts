import type { ORModel, ResponseEvent } from '../shared/types.js'

const BASE = 'https://openrouter.ai/api/v1'
const headers = () => ({
  Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
  'Content-Type': 'application/json',
  'HTTP-Referer': process.env.BASE_URL ?? '',
  'X-Title': 'orchat',
})

// Responses API (/responses) のストリーム。イベントをそのまま流す
export async function* responsesStream(body: Record<string, unknown>, signal?: AbortSignal): AsyncGenerator<ResponseEvent> {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ ...body, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
  for await (const data of sseData(res.body)) {
    if (data === '[DONE]') return
    const ev = JSON.parse(data) as ResponseEvent
    if (ev.type === 'error' || ev.type === 'response.failed') {
      const err = ev.error ?? (ev.response?.error as { message?: string } | undefined)
      throw new Error(`OpenRouter: ${err?.message ?? JSON.stringify(err ?? ev)}`)
    }
    yield ev
  }
}

// `data: ...` 行だけを取り出す最小 SSE パーサ (コメント行 `: OPENROUTER PROCESSING` は捨てる)
export async function* sseData(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buf = ''
  for await (const bytes of stream) {
    buf += decoder.decode(bytes, { stream: true })
    let i: number
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, i)
      buf = buf.slice(i + 2)
      const data = event
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trimStart())
        .join('\n')
      if (data) yield data
    }
  }
}

let modelsCache: { at: number; models: ORModel[] } | undefined
export async function listModels(): Promise<ORModel[]> {
  if (modelsCache && Date.now() - modelsCache.at < 60 * 60 * 1000) return modelsCache.models
  const res = await fetch(`${BASE}/models`, { headers: headers() })
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`)
  let models = ((await res.json()) as { data: ORModel[] }).data
  const allow = (process.env.MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  if (allow.length) models = allow.flatMap((id) => models.filter((m) => m.id === id))
  modelsCache = { at: Date.now(), models }
  return models
}
