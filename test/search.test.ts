import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeLike } from '../src/shared/search.ts'

test('LIKE の特殊文字をエスケープする', () => {
  assert.equal(escapeLike('100%確実_テスト\\おわり'), '100\\%確実\\_テスト\\\\おわり')
  assert.equal(escapeLike('日本語の部分一致'), '日本語の部分一致')
  assert.equal(escapeLike(''), '')
})

test('エスケープ後は % と _ を含めてもパターン断片として安全', () => {
  for (const q of ['%', '_', '\\', '%_%']) {
    const pat = `%${escapeLike(q)}%`
    assert.match(pat, /^%.*%$/)
    assert.ok(!/(?<!\\)[%_]/.test(pat.slice(1, -1)))
  }
})
