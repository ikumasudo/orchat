import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cleanTitle } from '../src/server/title.ts'

test('cleanTitle: 引用符・句点・前置き行を落とし 50 文字に切る', () => {
  assert.equal(cleanTitle('「Drizzle の jsonb 型付け」'), 'Drizzle の jsonb 型付け')
  assert.equal(cleanTitle('"Typing jsonb in Drizzle."\n'), 'Typing jsonb in Drizzle')
  assert.equal(cleanTitle('Drizzle の jsonb 型付け。\n\n補足: customType を使います'), 'Drizzle の jsonb 型付け')
  assert.equal(cleanTitle('**タイトル**'), 'タイトル')
  assert.equal(cleanTitle('あ'.repeat(80)).length, 50)
  assert.equal(cleanTitle('  \n'), '')
})
