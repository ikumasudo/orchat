import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToRoot, siblings, deepestLeaf } from '../src/server/tree.ts'

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

test('empty tree', () => {
  assert.deepEqual(pathToRoot([], 'x'), [])
})
