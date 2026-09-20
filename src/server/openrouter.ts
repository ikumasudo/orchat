import type { Item, ORModel, ResponseEvent } from '../shared/types.js'
import { isPublishedFile, itemText } from '../shared/responses.js'

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

// 非ストリームで呼び、output の message テキストだけ返す (reasoning item は捨てる)
export async function responsesText(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${BASE}/responses`, { method: 'POST', headers: headers(), body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`OpenRouter ${res.status}: ${await res.text()}`)
  const r = (await res.json()) as { output: Item[]; status?: string; incomplete_details?: { reason?: string } }
  const text = r.output.filter((it) => it.type === 'message').map(itemText).join('')
  // reasoning モデルが max_output_tokens を推論で使い切ると message 無しの incomplete で返る。黙って空を返さず失敗にする
  if (!text) throw new Error(`OpenRouter: empty output (${r.status}${r.incomplete_details?.reason ? `: ${r.incomplete_details.reason}` : ''})`)
  return text
}

// shell item が引用した公開対象 (outputs/ 配下) の file_id から、ダウンロードに使う container_id と表示名を引く。
// 引用に無い file_id や outputs/ 外は undefined (クライアント指定の container_id は使わない)
export function findShellFile(item: Item, fileId: string): { container_id: string; filename: string } | undefined {
  if (item.type !== 'openrouter:shell') return undefined
  const f = item.files?.find((x) => x.file_id === fileId)
  const container_id = f?.container_id ?? item.container_id
  if (!f || !container_id || !isPublishedFile(f.filename)) return undefined
  return { container_id, filename: f.filename }
}

// container ファイルの生バイト。所有確認は呼び出し側で済ませてから使う
export function containerFileContent(containerId: string, fileId: string): Promise<Response> {
  return fetch(`${BASE}/containers/${encodeURIComponent(containerId)}/files/${encodeURIComponent(fileId)}/content`, { headers: headers() })
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

export const AUTO_MODEL = 'openrouter/auto'
// MODELS env (カンマ区切り)。ピッカーの表示と Auto Router の行き先の両方に使う
export const allowedModels = () => (process.env.MODELS ?? '').split(',').map((s) => s.trim()).filter(Boolean)

// MODELS が空なら全モデル許可、設定時は完全一致のみ許可する。auto を使うなら auto 自身も一覧に必要
export const isModelAllowed = (model: string, allow: string[] = allowedModels()) => !allow.length || allow.includes(model)

// openrouter/auto のとき: 行き先を allow (auto 自身を除く) に限定し、effort 未指定なら high。それ以外のモデルは素通し
export function autoRouter<T extends { model: string; reasoning?: { effort: string } }>(body: T, allow: string[]): T & { plugins?: unknown[] } {
  if (body.model !== AUTO_MODEL) return body
  const allowed_models = allow.filter((m) => m !== AUTO_MODEL)
  return { ...body, reasoning: body.reasoning ?? { effort: 'high' }, ...(allowed_models.length && { plugins: [{ id: 'auto-router', allowed_models }] }) }
}

let modelsCache: { at: number; models: ORModel[] } | undefined
export async function listModels(): Promise<ORModel[]> {
  if (modelsCache && Date.now() - modelsCache.at < 60 * 60 * 1000) return modelsCache.models
  const res = await fetch(`${BASE}/models`, { headers: headers() })
  if (!res.ok) throw new Error(`OpenRouter /models ${res.status}`)
  let models = ((await res.json()) as { data: ORModel[] }).data
  const allow = allowedModels()
  if (allow.length) models = allow.flatMap((id) => models.filter((m) => m.id === id))
  modelsCache = { at: Date.now(), models }
  return models
}
