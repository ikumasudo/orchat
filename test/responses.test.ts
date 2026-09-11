import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { sseData } from '../src/server/openrouter.ts'
import { applyEvent, initialState, itemText } from '../src/shared/responses.ts'
import type { ResponseEvent } from '../src/shared/types.ts'

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
