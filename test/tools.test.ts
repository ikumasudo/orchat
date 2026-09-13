import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun } from '../src/server/runs.ts'
import { runTurn, toInputItem, type AppTool } from '../src/server/tools.ts'
import { applyEvent, initialState } from '../src/shared/responses.ts'
import type { Item, ResponseEvent } from '../src/shared/types.ts'

// 1 リクエスト分の偽ストリーム: items を added → completed で流す
const response = (items: Item[], cost = 1): ResponseEvent[] => [
  { type: 'response.created', response: { id: `r${cost}`, model: 'm' } },
  ...items.map((item, output_index): ResponseEvent => ({ type: 'response.output_item.added', output_index, item })),
  { type: 'response.completed', response: { id: `r${cost}`, model: 'm', output: items, usage: { input_tokens: 10, cost } } },
]
const msg = (text: string): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const call = (call_id: string, name: string, args: unknown): Item => ({ type: 'function_call', call_id, name, arguments: JSON.stringify(args), status: 'completed' })

// responses を順番に返す。渡された body.input を記録する
function fakeStream(responses: ResponseEvent[][]) {
  const inputs: Item[][] = []
  const stream = async function* (body: Record<string, unknown>) {
    inputs.push(body.input as Item[])
    const r = responses[inputs.length - 1]
    if (!r) throw new Error('no more responses')
    yield* r
  }
  return { stream, inputs }
}

const echo: AppTool = { name: 'echo', description: '', parameters: {}, needsApproval: false, execute: async (args) => `echo:${JSON.stringify(args)}` }
const danger: AppTool = { name: 'danger', description: '', parameters: {}, needsApproval: true, execute: async () => 'done' }
const boom: AppTool = { name: 'boom', description: '', parameters: {}, needsApproval: false, execute: async () => { throw new Error('bad') } }

const fold = (events: ResponseEvent[]) => events.reduce(applyEvent, initialState())
const opts = (stream: ReturnType<typeof fakeStream>['stream'], tools: AppTool[], run = createRun<ResponseEvent>(null)) => ({ stream, body: { model: 'm', input: [{ type: 'message', role: 'user' } as Item] }, tools, run, userId: 'u' })

test('function_call 無し: 1 リクエストで終わり、イベントは素通し', async () => {
  const r1 = response([msg('hi')])
  const { stream, inputs } = fakeStream([r1])
  const run = createRun<ResponseEvent>(null)
  const state = await runTurn(opts(stream, [echo], run))
  assert.equal(inputs.length, 1)
  assert.deepEqual(run.events, r1)
  assert.equal(state.error, undefined)
  assert.deepEqual(state.output, [msg('hi')])
  assert.deepEqual(state.usage, { input_tokens: 10, cost: 1 })
  assert.equal(state.id, 'r1')
})

test('function_call → 実行 → function_call_output を付けて再送。output_index がずれて 1 つの output に連結、usage 合算', async () => {
  const { stream, inputs } = fakeStream([response([msg('呼びます'), call('c1', 'echo', { a: 1 }), call('c2', 'nope', {})], 1), response([msg('答え')], 2)])
  const run = createRun<ResponseEvent>(null)
  const state = await runTurn(opts(stream, [echo], run))
  assert.equal(inputs.length, 2)
  assert.deepEqual(
    state.output.map((i) => i.type),
    ['message', 'function_call', 'function_call', 'function_call_output', 'function_call_output', 'message'],
  )
  assert.deepEqual(state.output[3], { type: 'function_call_output', call_id: 'c1', output: 'echo:{"a":1}' })
  assert.equal(state.output[4].output, 'エラー: 不明なツール nope')
  // 2 回目の input = 1 回目の input + 1 回目の output + function_call_output
  assert.deepEqual(inputs[1], [...inputs[0], ...state.output.slice(0, 5)])
  // 購読側が applyEvent だけで畳んでも同じ output になる
  const folded = fold(run.events)
  assert.deepEqual(folded.output, state.output)
  assert.deepEqual(folded.usage, { input_tokens: 20, cost: 3 })
  assert.deepEqual(state.usage, { input_tokens: 20, cost: 3 })
  assert.equal(state.id, 'r2')
  assert.equal(state.error, undefined)
})

test('needsApproval: pending を流して待ち、拒否すると output に理由、approval: denied が再 push される', async () => {
  const { stream } = fakeStream([response([call('c1', 'danger', {})]), response([msg('了解')])])
  const run = createRun<ResponseEvent>(null)
  const p = runTurn(opts(stream, [danger], run))
  // 承認待ちになるまで待つ
  while (!run.pending.has('c1')) await new Promise((r) => setTimeout(r, 0))
  const pendingEv = run.events.at(-1)!
  assert.equal(pendingEv.type, 'response.output_item.done')
  assert.equal(pendingEv.item?.approval, 'pending')
  run.pending.get('c1')!.resolve(false)
  const state = await p
  assert.equal(run.pending.size, 0)
  assert.equal(state.output[0].approval, 'denied')
  assert.deepEqual(state.output[1], { type: 'function_call_output', call_id: 'c1', output: 'ユーザーが拒否しました' })
  assert.deepEqual(fold(run.events).output, state.output)
})

test('needsApproval: 承認すると実行される。abort 中の承認待ちは拒否扱いで停止', async () => {
  const s1 = fakeStream([response([call('c1', 'danger', {})]), response([msg('ok')])])
  const run1 = createRun<ResponseEvent>(null)
  const p1 = runTurn(opts(s1.stream, [danger], run1))
  while (!run1.pending.has('c1')) await new Promise((r) => setTimeout(r, 0))
  run1.pending.get('c1')!.resolve(true)
  const state1 = await p1
  assert.equal(state1.output[0].approval, 'approved')
  assert.equal(state1.output[1].output, 'done')

  const s2 = fakeStream([response([call('c1', 'danger', {})])])
  const run2 = createRun<ResponseEvent>(null)
  const p2 = runTurn(opts(s2.stream, [danger], run2))
  while (!run2.pending.has('c1')) await new Promise((r) => setTimeout(r, 0))
  run2.abort.abort()
  const state2 = await p2
  assert.equal(state2.output[0].approval, 'denied')
  assert.equal(state2.error, '停止しました') // 2 回目の stream で偽ストリームが例外 → aborted なので停止扱い
})

test('execute の例外は output に入る', async () => {
  const { stream } = fakeStream([response([call('c1', 'boom', {})]), response([msg('x')])])
  const state = await runTurn(opts(stream, [boom]))
  assert.equal(state.output[1].output, 'エラー: bad')
})

test('上限: 20 リクエストで打ち切り、error に理由', async () => {
  const { stream, inputs } = fakeStream(Array.from({ length: 30 }, (_, i) => response([call(`c${i}`, 'echo', {})])))
  const state = await runTurn(opts(stream, [echo]))
  assert.equal(inputs.length, 20)
  assert.equal(state.error, 'ツール呼び出し回数の上限に達しました')
  assert.equal(state.output.length, 40)
})

test('toInputItem: approval と余分なキーを落とす', () => {
  assert.deepEqual(toInputItem({ type: 'function_call', call_id: 'c', name: 'f', arguments: '{}', approval: 'approved' }), { type: 'function_call', call_id: 'c', name: 'f', arguments: '{}' })
  assert.deepEqual(toInputItem({ type: 'function_call_output', call_id: 'c', output: 'o', extra: 1 }), { type: 'function_call_output', call_id: 'c', output: 'o' })
  const m: Item = { type: 'message', role: 'assistant', content: [] }
  assert.equal(toInputItem(m), m)
})
