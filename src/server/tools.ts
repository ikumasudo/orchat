import type { ChatSettings, Item, ResponseEvent } from '../shared/types.js'
import { addUsage, applyEvent, initialState, itemDone, offsetEvent, type ResponseState } from '../shared/responses.js'
import type { Run } from './runs.js'

// アプリ側で実行する function tool。Responses API には { type: 'function', name, description, parameters } として渡す
export type AppTool = {
  name: string // ^[a-zA-Z0-9_-]{1,64}$
  description: string
  parameters: Record<string, unknown> // JSON Schema
  needsApproval: boolean // true なら実行前にユーザー承認
  execute(args: unknown, ctx: { userId: string; signal: AbortSignal }): Promise<string> // モデルに返す文字列
}

// 設定から使えるツールを解決する。MCP (後続 Issue) がここに足す。Skill は skills.ts 側
export async function resolveTools(_settings: ChatSettings, _userId: string): Promise<AppTool[]> {
  return []
}

// 履歴返送用: アプリが付けた非標準キーを落とす (function_call の approval、function_call_output の余分なキー)
export function toInputItem(item: Item): Item {
  if (item.type === 'function_call') {
    const { approval: _, ...rest } = item
    return rest
  }
  if (item.type === 'function_call_output') return { type: item.type, call_id: item.call_id, output: item.output }
  return item
}

export const toFunctionTool = (t: AppTool) => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters })

// ponytail: 1 ターンのリクエスト上限と承認待ちタイムアウトは定数。足りなくなったら settings に
const MAX_REQUESTS = 20
const APPROVAL_TIMEOUT_MS = 10 * 60 * 1000

type Stream = (body: Record<string, unknown>, signal: AbortSignal) => AsyncIterable<ResponseEvent>

// 1 ターン分の生成: ストリーム → function_call を実行 → function_call_output を付けて再送、を function_call が無くなるまで繰り返す。
// run には全リクエストのイベントを output_index をずらして push するので、購読側は applyEvent だけで 1 つの output に畳める
export async function runTurn(opts: { stream: Stream; body: Record<string, unknown>; tools: AppTool[]; run: Run<ResponseEvent>; userId: string }): Promise<ResponseState & { error?: string }> {
  const { stream, tools, run, userId } = opts
  const state = initialState()
  let input = opts.body.input as Item[]
  let error: string | undefined
  try {
    for (let n = 0; ; n++) {
      if (n >= MAX_REQUESTS) {
        error = 'ツール呼び出し回数の上限に達しました'
        break
      }
      const prev = { output: state.output, usage: state.usage }
      const local = initialState()
      for await (const ev of stream({ ...opts.body, input }, run.abort.signal)) {
        applyEvent(local, ev)
        run.push(offsetEvent(ev, prev.output.length, prev))
      }
      state.output = prev.output.concat(local.output)
      state.usage = addUsage(prev.usage, local.usage)
      state.id = local.id ?? state.id
      state.model = local.model ?? state.model
      state.completed = local.completed

      const calls = local.output.filter((it) => it?.type === 'function_call')
      if (!calls.length) break
      const outs: Item[] = []
      for (const call of calls) {
        const output = await callTool(call, tools, run, userId, state)
        const out: Item = { type: 'function_call_output', call_id: call.call_id, output }
        state.output.push(out)
        run.push(itemDone(state.output.length - 1, out))
        outs.push(out)
      }
      input = [...input, ...local.output, ...outs]
    }
  } catch (e) {
    error = run.abort.signal.aborted ? '停止しました' : e instanceof Error ? e.message : String(e)
  }
  return error ? { ...state, error } : state
}

// 1 つの function_call を (必要なら承認を待って) 実行し、モデルに返す文字列を作る。失敗理由も文字列で返してモデルに続きを書かせる
async function callTool(call: Item, tools: AppTool[], run: Run<ResponseEvent>, userId: string, state: ResponseState): Promise<string> {
  const tool = tools.find((t) => t.name === call.name)
  if (!tool) return `エラー: 不明なツール ${String(call.name)}`
  if (tool.needsApproval && !(await approve(call, run, state))) return 'ユーザーが拒否しました'
  try {
    const args: unknown = typeof call.arguments === 'string' ? JSON.parse(call.arguments) : call.arguments
    return await tool.execute(args, { userId, signal: run.abort.signal })
  } catch (e) {
    return `エラー: ${e instanceof Error ? e.message : String(e)}`
  }
}

// item に approval: 'pending' を付けて流し、messages.decide の決定を待つ。タイムアウト / 停止は拒否扱い
async function approve(call: Item, run: Run<ResponseEvent>, state: ResponseState): Promise<boolean> {
  const idx = state.output.indexOf(call)
  const callId = String(call.call_id)
  const decision = Promise.withResolvers<boolean>()
  run.pending.set(callId, decision)
  const update = (approval: Item['approval']) => {
    const item = { ...call, approval }
    state.output[idx] = item
    run.push(itemDone(idx, item))
  }
  update('pending')
  const timer = setTimeout(() => decision.resolve(false), APPROVAL_TIMEOUT_MS)
  const onAbort = () => decision.resolve(false)
  run.abort.signal.addEventListener('abort', onAbort, { once: true })
  try {
    const ok = await decision.promise
    update(ok ? 'approved' : 'denied')
    return ok
  } finally {
    clearTimeout(timer)
    run.abort.signal.removeEventListener('abort', onAbort)
    run.pending.delete(callId)
  }
}
