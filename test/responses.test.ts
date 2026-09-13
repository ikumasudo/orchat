import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { sseData } from '../src/server/openrouter.ts'
import { addUsage, applyEvent, initialState, itemDone, itemText, offsetEvent, splitStepsAnswer } from '../src/shared/responses.ts'
import type { Item, ResponseEvent } from '../src/shared/types.ts'

test('applyEvent builds items from added/delta/annotation events', () => {
  const s = initialState()
  ;[
    { type: 'response.output_item.added', output_index: 0, item: { id: 'rs', type: 'reasoning', status: 'in_progress', summary: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'reasoning_text', text: '' } },
    { type: 'response.reasoning_text.delta', output_index: 0, content_index: 0, delta: 'think' },
    { type: 'response.reasoning_text.delta', output_index: 0, content_index: 0, delta: 'ing' },
    { type: 'response.output_item.added', output_index: 1, item: { id: 'ws', type: 'openrouter:web_search', status: 'in_progress' } },
    { type: 'response.output_item.done', output_index: 1, item: { id: 'ws', type: 'openrouter:web_search', status: 'completed', action: { type: 'search', query: 'q' } } },
    { type: 'response.output_item.added', output_index: 2, item: { id: 'msg', type: 'message', role: 'assistant', content: [] } },
    { type: 'response.output_text.annotation.added', output_index: 2, content_index: 0, annotation: { type: 'url_citation', url: 'https://a' } },
    { type: 'response.output_text.delta', output_index: 2, content_index: 0, delta: 'Hel' },
    { type: 'response.output_text.delta', output_index: 2, content_index: 0, delta: 'lo' },
  ].forEach((e) => applyEvent(s, e as ResponseEvent))
  assert.equal(itemText(s.output[0]), 'thinking')
  assert.equal(s.output[1].action?.query, 'q')
  assert.equal(s.output[2].content?.[0].text, 'Hello')
  assert.equal(s.output[2].content?.[0].annotations?.length, 1)
  assert.equal(s.completed, false)
})

test('splitStepsAnswer: 末尾の連続 message が回答、それ以外がステップ', () => {
  const msg = (text: string): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
  const rs: Item = { type: 'reasoning', status: 'completed' }
  const tool: Item = { type: 'openrouter:web_search', status: 'completed' }

  // 回答のみ → ステップなし
  assert.deepEqual(splitStepsAnswer([msg('a'), msg('b')]), { steps: [], answer: [msg('a'), msg('b')] })
  // 思考+ツール+回答
  assert.deepEqual(splitStepsAnswer([rs, tool, msg('答え')]), { steps: [rs, tool], answer: [msg('答え')] })
  // 途中 message はステップ側
  assert.deepEqual(splitStepsAnswer([msg('検索します'), tool, msg('答え')]), { steps: [msg('検索します'), tool], answer: [msg('答え')] })
  // 非 message のみ / 空
  assert.deepEqual(splitStepsAnswer([rs, tool]), { steps: [rs, tool], answer: [] })
  assert.deepEqual(splitStepsAnswer([]), { steps: [], answer: [] })
})

test('splitStepsAnswer: ストリーミング中の境界移動', () => {
  const msg = (text: string): Item => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] })
  // 回答を流している途中は回答側
  let out = [msg('Hello')]
  assert.deepEqual(splitStepsAnswer(out).answer, [msg('Hello')])
  // ツール呼び出しが来たら流していたテキストはステップ側へ移る
  const tool: Item = { type: 'openrouter:web_search', status: 'in_progress' }
  out = [...out, tool]
  assert.deepEqual(splitStepsAnswer(out), { steps: [msg('Hello'), tool], answer: [] })
  // 最終回答が来たら末尾だけ回答に戻る
  out = [...out, msg('答え')]
  assert.deepEqual(splitStepsAnswer(out), { steps: [msg('Hello'), tool], answer: [msg('答え')] })
})

test('function_call_arguments.delta は output_item.done / response.completed で上書きされる (applyEvent 無変更で足りる)', () => {
  const call: Item = { id: 'fc', type: 'function_call', call_id: 'c1', name: 'f', arguments: '{"a":1}', status: 'completed' }
  const s = initialState()
  ;[
    { type: 'response.output_item.added', output_index: 0, item: { id: 'fc', type: 'function_call', call_id: 'c1', name: 'f', arguments: '' } },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: '{"a"' },
    { type: 'response.function_call_arguments.delta', output_index: 0, delta: ':1}' },
    { type: 'response.output_item.done', output_index: 0, item: call },
  ].forEach((e) => applyEvent(s, e as ResponseEvent))
  assert.deepEqual(s.output[0], call)
  applyEvent(s, { type: 'response.completed', response: { output: [call] } })
  assert.deepEqual(s.output, [call])
})

test('addUsage: 数値は合算、片方だけなら残す、ネストは再帰', () => {
  assert.equal(addUsage(undefined, undefined), undefined)
  assert.deepEqual(addUsage(undefined, { input_tokens: 1 }), { input_tokens: 1 })
  assert.deepEqual(
    addUsage({ input_tokens: 10, output_tokens: 5, cost: 0.1, output_tokens_details: { reasoning_tokens: 2 } }, { input_tokens: 20, cost: 0.2, output_tokens_details: { reasoning_tokens: 3 }, server_tool_use_details: { web_search_requests: 1 } }),
    { input_tokens: 30, output_tokens: 5, cost: 0.30000000000000004, output_tokens_details: { reasoning_tokens: 5 }, server_tool_use_details: { web_search_requests: 1 } },
  )
})

test('offsetEvent: output_index をずらし、completed は前回 output と連結・usage 合算。purely functional', () => {
  const prev = { output: [{ type: 'message' }, { type: 'function_call' }, { type: 'function_call_output' }] as Item[], usage: { input_tokens: 1, cost: 1 } }
  const delta: ResponseEvent = { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'x' }
  assert.equal(offsetEvent(delta, 3, prev).output_index, 3)
  assert.equal(delta.output_index, 0)
  const created: ResponseEvent = { type: 'response.created', response: { id: 'r2' } }
  assert.equal(offsetEvent(created, 3, prev), created)
  const done = offsetEvent({ type: 'response.completed', response: { id: 'r2', output: [{ type: 'message' }], usage: { input_tokens: 2, cost: 2 } } }, 3, prev)
  assert.deepEqual(done.response?.output?.map((i) => i.type), ['message', 'function_call', 'function_call_output', 'message'])
  assert.deepEqual(done.response?.usage, { input_tokens: 3, cost: 3 })
  assert.equal(done.response?.id, 'r2')
  // 2 リクエスト分を offsetEvent 経由で applyEvent に流すと 1 つの output に畳まれる
  const s = initialState()
  ;[
    { type: 'response.output_item.added', output_index: 0, item: { type: 'function_call', call_id: 'c' } },
    { type: 'response.completed', response: { output: [{ type: 'function_call', call_id: 'c' }], usage: { cost: 1 } } },
  ].forEach((e) => applyEvent(s, e as ResponseEvent))
  applyEvent(s, itemDone(1, { type: 'function_call_output', call_id: 'c', output: 'ok' }))
  const p2 = { output: [...s.output], usage: s.usage } // prev は前回までのスナップショット (runTurn では state と local が別なので共有されない)
  ;[
    { type: 'response.output_item.added', output_index: 0, item: { type: 'message', content: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'hi' },
    { type: 'response.completed', response: { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hi' }] }], usage: { cost: 2 } } },
  ].forEach((e) => applyEvent(s, offsetEvent(e as ResponseEvent, 2, p2)))
  assert.deepEqual(s.output.map((i) => i.type), ['function_call', 'function_call_output', 'message'])
  assert.equal(itemText(s.output[2]), 'hi')
  assert.deepEqual(s.usage, { cost: 3 })
})

test('sseData splits events and drops comments', async () => {
  const raw = ': OPENROUTER PROCESSING\n\ndata: {"a":1}\n\ndata: {"b":\ndata: 2}\n\ndata: [DONE]\n\n'
  const out: string[] = []
  for await (const x of sseData(new Blob([raw]).stream())) out.push(x)
  assert.deepEqual(out, ['{"a":1}', '{"b":\n2}', '[DONE]'])
})

// spike フィクスチャ: delta の畳み込み結果が response.completed の output と一致すること
for (const name of ['resp-reasoning', 'resp-reasoning-turn2', 'resp-web', 'resp-web-gpt', 'resp-shell']) {
  const file = `test/fixtures/${name}.jsonl`
  test(`fixture ${name}: streamed items match completed output`, { skip: !existsSync(file) && 'run `pnpm spike` first' }, () => {
    const events = readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as ResponseEvent)
    const streamed = events.filter((e) => e.type !== 'response.completed').reduce(applyEvent, initialState())
    const final = events.reduce(applyEvent, initialState())
    assert.ok(final.completed && final.usage?.cost != null, 'usage.cost in response.completed')
    assert.deepEqual(streamed.output.map((i) => i.type), final.output.map((i) => i.type))
    for (const [k, item] of final.output.entries()) if (item.type === 'message') assert.equal(itemText(streamed.output[k]), itemText(item))
  })
}
