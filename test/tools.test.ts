import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun } from '../src/server/runs.ts'
import { resolveTools, runToolLoop, toInputItem, type AppTool } from '../src/server/tools.ts'
import { applyEvent, initialState } from '../src/shared/responses.ts'
import type { Item, ResponseEvent } from '../src/shared/types.ts'

const msg = (text: string): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
const fc = (callId: string, name = 'echo', args = '{"a":1}'): Item => ({ type: 'function_call', call_id: callId, name, arguments: args, status: 'completed' })

// 1 リクエスト分の偽ストリーム: output items と completed を流す
function round(output: Item[], usage: Record<string, number> = {}, id = `resp-${Math.random()}`): ResponseEvent[] {
  return [
    ...output.map((item, i) => ({ type: 'response.output_item.done', output_index: i, item }) as ResponseEvent),
    { type: 'response.completed', response: { id, model: 'm', output, usage } } as ResponseEvent,
  ]
}

function scripted(rounds: ResponseEvent[][]) {
  const seen: Item[][] = []
  let n = 0
  return {
    seen,
    request: async function* (input: Item[]) {
      seen.push(input)
      yield* rounds[n++] ?? []
    },
  }
}

const echo: AppTool = {
  name: 'echo',
  description: 'test',
  parameters: { type: 'object' },
  needsApproval: false,
  execute: async (args) => `ok:${JSON.stringify(args)}`,
}

function run() {
  return createRun<ResponseEvent>(null)
}

test('function_call が無ければ 1 リクエストで終わる', async () => {
  const r = run()
  const s = scripted([round([msg('hi')], { input_tokens: 3, output_tokens: 5 })])
  const { state, requests, error } = await runToolLoop({ initialInput: [], request: s.request, tools: [echo], userId: 'u', run: r })
  assert.equal(requests, 1)
  assert.equal(error, undefined)
  assert.deepEqual(state.output.map((i) => i.type), ['message'])
  assert.deepEqual(state.usage, { input_tokens: 3, output_tokens: 5 })
})

test('function_call → 実行 → 再送で終わる。output は時系列に連結され usage は合算される', async () => {
  const r = run()
  const s = scripted([
    round([fc('c1')], { input_tokens: 10, output_tokens: 4, cost: 0.001 }, 'resp-1'),
    round([msg('done')], { input_tokens: 20, output_tokens: 6, cost: 0.002 }, 'resp-2'),
  ])
  const { state, requests, error } = await runToolLoop({ initialInput: [{ type: 'message', role: 'user', content: [] }], request: s.request, tools: [echo], userId: 'u', run: r })
  assert.equal(requests, 2)
  assert.equal(error, undefined)
  assert.deepEqual(state.output.map((i) => i.type), ['function_call', 'function_call_output', 'message'])
  assert.equal(state.output[1].call_id, 'c1')
  assert.equal(state.output[1].output, 'ok:{"a":1}')
  assert.deepEqual(state.usage, { input_tokens: 30, output_tokens: 10, cost: 0.003 })
  assert.equal(state.id, 'resp-2')
  // 2 回目の input = 前回 input + function_call + function_call_output
  assert.deepEqual(s.seen[1].map((i) => i.type), ['message', 'function_call', 'function_call_output'])
  // クライアントは applyEvent のまま同じ結果に畳める
  const folded = r.events.reduce(applyEvent, initialState())
  assert.deepEqual(folded.output, state.output)
  assert.deepEqual(folded.usage, state.usage)
  assert.deepEqual(folded.id, state.id)
})

test('needsApproval で拒否すると function_call_output に理由が入る', async () => {
  const gated: AppTool = { ...echo, needsApproval: true }
  const r = run()
  const s = scripted([round([fc('c9')]), round([msg('了解')])])
  const p = runToolLoop({ initialInput: [], request: s.request, tools: [gated], userId: 'u', run: r, approvalTimeoutMs: 5000 })
  while (!r.pending.has('c9')) await new Promise((res) => setTimeout(res, 0))
  // 承認待ちの item が push されている (リロード時の復元用)
  assert.equal(r.events.some((e) => e.type === 'response.output_item.done' && (e.item as Item)?.approval === 'pending'), true)
  r.pending.get('c9')!.resolve(false)
  const { state, error } = await p
  assert.equal(error, undefined)
  assert.equal(state.output[1].output, 'ユーザーが拒否しました')
  assert.deepEqual(state.output.map((i) => i.type), ['function_call', 'function_call_output', 'message'])
  assert.equal(r.pending.size, 0)
})

test('承認タイムアウトは拒否扱い', async () => {
  const gated: AppTool = { ...echo, needsApproval: true }
  const r = run()
  const s = scripted([round([fc('cT')]), round([msg('ok')])])
  const { state } = await runToolLoop({ initialInput: [], request: s.request, tools: [gated], userId: 'u', run: r, approvalTimeoutMs: 10 })
  assert.equal(state.output[1].output, 'ユーザーが拒否しました')
})

test('abort した承認待ちは拒否扱い', async () => {
  const gated: AppTool = { ...echo, needsApproval: true }
  const r = run()
  const s = scripted([round([fc('cA')])])
  const p = runToolLoop({ initialInput: [], request: s.request, tools: [gated], userId: 'u', run: r, approvalTimeoutMs: 5000 })
  while (!r.pending.has('cA')) await new Promise((res) => setTimeout(res, 0))
  r.abort.abort()
  const { state, error } = await p
  assert.equal(state.output[1].output, 'ユーザーが拒否しました')
  assert.equal(error, '停止しました')
})

test('上限を超えたらエラーで保存する', async () => {
  const r = run()
  const rounds = Array.from({ length: 5 }, (_, i) => round([fc(`c${i}`)]))
  const { requests, error } = await runToolLoop({ initialInput: [], request: scripted(rounds).request, tools: [echo], userId: 'u', run: r, maxRequests: 3 })
  assert.equal(requests, 3)
  assert.equal(error, 'ツール呼び出し回数の上限に達しました')
})

test('未知のツール・実行例外は output にエラー理由が入る', async () => {
  const r = run()
  const boom: AppTool = { ...echo, name: 'boom', execute: async () => { throw new Error('壊れた') } }
  const s = scripted([round([fc('c1', 'nope'), fc('c2', 'boom')]), round([msg('end')])])
  const { state } = await runToolLoop({ initialInput: [], request: s.request, tools: [boom], userId: 'u', run: r })
  assert.deepEqual(state.output.map((i) => i.type), ['function_call', 'function_call', 'function_call_output', 'function_call_output', 'message'])
  assert.match(String(state.output[2].output), /不明なツール/)
  assert.match(String(state.output[3].output), /^エラー: 壊れた/)
})

test('toInputItem: approval と function_call_output の余分なキーを落とす', () => {
  assert.deepEqual(toInputItem({ type: 'function_call', call_id: 'c', name: 'n', arguments: '{}', approval: 'approved' }), {
    type: 'function_call',
    call_id: 'c',
    name: 'n',
    arguments: '{}',
  })
  assert.deepEqual(toInputItem({ type: 'function_call_output', call_id: 'c', output: 'x', approval: 'denied', extra: 1 }), {
    type: 'function_call_output',
    call_id: 'c',
    output: 'x',
  })
  const m = msg('hi')
  assert.equal(toInputItem(m), m)
})

test('resolveTools は今は空', async () => {
  assert.deepEqual(await resolveTools({ model: 'm' }, 'u'), [])
})
