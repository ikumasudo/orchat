import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToRoot, siblings, deepestLeaf, transcript } from '../src/server/tree.ts'
import type { DbMessage } from '../src/shared/types.ts'

const t = (n: number) => new Date(2026, 0, n)
//  u1 ─ a1 ─ u2 ─ a2
//     └ a1'(regen) ─ u2'
const rows = [
  { id: 'u1', parentId: null, createdAt: t(1) },
  { id: 'a1', parentId: 'u1', createdAt: t(2) },
  { id: 'u2', parentId: 'a1', createdAt: t(3) },
  { id: 'a2', parentId: 'u2', createdAt: t(4) },
  { id: "a1'", parentId: 'u1', createdAt: t(5) },
  { id: "u2'", parentId: "a1'", createdAt: t(6) },
]

test('pathToRoot returns root→leaf', () => {
  assert.deepEqual(pathToRoot(rows, 'a2').map((r) => r.id), ['u1', 'a1', 'u2', 'a2'])
  assert.deepEqual(pathToRoot(rows, "u2'").map((r) => r.id), ['u1', "a1'", "u2'"])
  assert.deepEqual(pathToRoot(rows, null), [])
})

test('siblings groups by parent in creation order', () => {
  assert.deepEqual(siblings(rows)['u1'], ['a1', "a1'"])
  assert.deepEqual(siblings(rows)[''], ['u1'])
})

test('deepestLeaf follows newest child', () => {
  assert.equal(deepestLeaf(rows, 'a1'), 'a2')
  assert.equal(deepestLeaf(rows, "a1'"), "u2'")
})

test('transcript: role 行に整形し、reasoning / tool item は捨て、maxChars で切る', () => {
  const m = (id: string, parentId: string | null, role: string, body: DbMessage['body'], n: number): DbMessage =>
    ({ id, parentId, role, body, createdAt: t(n), conversationId: 'c', model: null, usage: null, cost: null, generationId: null })
  const msgs = [
    m('u1', null, 'user', { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'レシピ教えて' }] }, 1),
    m('a1', 'u1', 'assistant', {
      output: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: '考え中' }] },
        { type: 'function_call', name: 'x', call_id: '1', arguments: '{}' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'ズッキーニの味噌漬け' }] },
      ],
    }, 2),
    m("a1'", 'u1', 'assistant', { output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '別ブランチ' }] }] }, 3),
  ]
  assert.equal(transcript(msgs, 'a1', 1000), 'user: レシピ教えて\n\nassistant: ズッキーニの味噌漬け')
  assert.equal(transcript(msgs, "a1'", 1000), 'user: レシピ教えて\n\nassistant: 別ブランチ')
  assert.equal(transcript(msgs, 'a1', 10), 'user: レシピ教\n[…以下省略]')
  assert.equal(transcript(msgs, null, 10), '')
})
