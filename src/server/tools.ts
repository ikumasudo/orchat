import type { ChatSettings, Item, ResponseEvent } from '../shared/types.js'
import { applyEvent, initialState, offsetEvent, type ResponseState } from '../shared/responses.js'
import type { Run } from './runs.js'

export type AppTool = {
  name: string
  description: string
  parameters: Record<string, unknown>
  needsApproval: boolean
  execute(args: unknown, ctx: { userId: string; signal: AbortSignal }): Promise<string>
}

// 後続 Issue が MCP / Skills のツールを足す。今は空
export async function resolveTools(_settings: ChatSettings, _userId: string): Promise<AppTool[]> {
  return []
}

// ponytail: 1 ターン 20 リクエスト上限。長いツール連鎖が必要になったら設定化する
export const MAX_TOOL_REQUESTS = 20
export const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

// 履歴・次リクエストに返す前の整形。アプリが付けた非標準キーを落とす
export function toInputItem(item: Item): Item {
  if (item.type === 'function_call') {
    const { approval: _omit, ...rest } = item as Item & { approval?: unknown }
    return rest
  }
  if (item.type === 'function_call_output') {
    return { type: item.type, call_id: item.call_id, output: item.output }
  }
  return item
}

export type StreamStep = (input: Item[]) => AsyncGenerator<ResponseEvent>

// function_call → 実行 → function_call_output → 再送のループ。
// request は 1 リクエスト分のストリームを流す関数 (本番は responsesStream、テストは偽物)。
// イベントは offsetEvent で通し番号に直して run に push するので、クライアントは applyEvent のまま畳める
export async function runToolLoop(opts: {
  initialInput: Item[]
  request: StreamStep
  tools: AppTool[]
  userId: string
  run: Run<ResponseEvent>
  approvalTimeoutMs?: number
  maxRequests?: number
}): Promise<{ state: ResponseState; requests: number; error?: string }> {
  const { request, tools, userId, run } = opts
  const approvalTimeoutMs = opts.approvalTimeoutMs ?? APPROVAL_TIMEOUT_MS
  const maxRequests = opts.maxRequests ?? MAX_TOOL_REQUESTS
  const byName = new Map(tools.map((t) => [t.name, t]))
  const state = initialState()
  let input = opts.initialInput
  let error: string | undefined
  let requests = 0

  for (let round = 0; round < maxRequests; round++) {
    if (run.abort.signal.aborted) {
      error = '停止しました'
      break
    }
    requests++
    const base = state.output.length
    const snap = { output: [...state.output], usage: state.usage }
    try {
      for await (const ev of request(input)) {
        const off = offsetEvent(ev, base, snap)
        applyEvent(state, off)
        run.push(off)
      }
    } catch (e) {
      error = run.abort.signal.aborted ? '停止しました' : e instanceof Error ? e.message : String(e)
      break
    }
    const fresh = state.output.slice(base)
    const calls = fresh.filter((it) => it?.type === 'function_call')
    if (!calls.length) break
    if (round + 1 >= maxRequests) {
      error = 'ツール呼び出し回数の上限に達しました'
      break
    }
    const outputs: Item[] = []
    for (const fc of calls) {
      const out = await runOneCall(fc, byName, { userId, run, state, approvalTimeoutMs })
      outputs.push(out)
      if (run.abort.signal.aborted) {
        error = '停止しました'
        break
      }
    }
    input = [...input, ...fresh.map(toInputItem), ...outputs]
    if (error) break
  }
  return { state, requests, error }
}

async function runOneCall(
  fc: Item,
  byName: Map<string, AppTool>,
  ctx: { userId: string; run: Run<ResponseEvent>; state: ResponseState; approvalTimeoutMs: number },
): Promise<Item> {
  const { run, state } = ctx
  const tool = typeof fc.name === 'string' ? byName.get(fc.name) : undefined
  const callId = typeof fc.call_id === 'string' ? fc.call_id : ''
  const idx = state.output.indexOf(fc)

  let approved = true
  if (tool?.needsApproval && !run.abort.signal.aborted) {
    const gate = Promise.withResolvers<boolean>()
    run.pending.set(callId, gate)
    setApproval(fc, idx, 'pending', run, state)
    approved = await waitApproval(gate.promise, run.abort.signal, ctx.approvalTimeoutMs)
    run.pending.delete(callId)
    setApproval(fc, idx, approved ? 'approved' : 'denied', run, state)
  } else if (!tool) {
    approved = true
  }

  let output: string
  if (!approved) {
    output = 'ユーザーが拒否しました'
  } else if (!tool) {
    output = `エラー: 不明なツールです (${String(fc.name)})`
  } else {
    try {
      output = await tool.execute(parseArgs(fc.arguments), { userId: ctx.userId, signal: run.abort.signal })
    } catch (e) {
      output = `エラー: ${e instanceof Error ? e.message : String(e)}`
    }
  }
  const item: Item = { type: 'function_call_output', call_id: callId, output }
  const ev: ResponseEvent = { type: 'response.output_item.done', output_index: state.output.length, item }
  applyEvent(state, ev)
  run.push(ev)
  return item
}

function setApproval(fc: Item, idx: number, approval: string, run: Run<ResponseEvent>, state: ResponseState) {
  const ev: ResponseEvent = { type: 'response.output_item.done', output_index: idx, item: { ...fc, approval } }
  applyEvent(state, ev)
  run.push(ev)
}

function waitApproval(gate: Promise<boolean>, signal: AbortSignal, ms: number): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      cleanup()
      resolve(false)
    }, ms)
    const onAbort = () => {
      cleanup()
      resolve(false)
    }
    const cleanup = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    gate.then((v) => {
      cleanup()
      resolve(v)
    })
  })
}

function parseArgs(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}
