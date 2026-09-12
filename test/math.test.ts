import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMathDelimiters } from '../src/shared/math.ts'

test('素の変換: \\( \\) → $ $, \\[ \\] → $$ $$', () => {
  assert.equal(normalizeMathDelimiters('解は \\(x^2\\) である'), '解は $x^2$ である')
  assert.equal(normalizeMathDelimiters('\\[E = mc^2\\]'), '$$E = mc^2$$')
  assert.equal(
    normalizeMathDelimiters('インライン \\(a\\) とブロック\n\\[b\\]\nおわり'),
    'インライン $a$ とブロック\n$$b$$\nおわり',
  )
})

test('コードフェンスの中は不変 (閉じていないフェンスも末尾まで保護)', () => {
  const fenced = '```latex\n\\(x^2\\)\n```\nおわり \\(y\\)'
  assert.equal(normalizeMathDelimiters(fenced), '```latex\n\\(x^2\\)\n```\nおわり $y$')
  assert.equal(normalizeMathDelimiters('```\n\\[a\\]\n'), '```\n\\[a\\]\n')
  assert.equal(normalizeMathDelimiters('~~~md\n\\(a\\)\n~~~'), '~~~md\n\\(a\\)\n~~~')
})

test('インラインコードの中は不変', () => {
  assert.equal(normalizeMathDelimiters('`\\(x\\)` はコード'), '`\\(x\\)` はコード')
  assert.equal(normalizeMathDelimiters('前 `a` 中 \\(x\\) 後'), '前 `a` 中 $x$ 後')
})

test('エスケープ済み (\\\\) は触らない', () => {
  assert.equal(normalizeMathDelimiters('\\\\(x\\\\)'), '\\\\(x\\\\)')
  assert.equal(normalizeMathDelimiters('\\\\[x\\\\]'), '\\\\[x\\\\]')
})

test('変換対象が無い文字列はそのまま返る', () => {
  for (const s of ['', 'ただのテキスト', 'costs $5 and $10', '$$x^2$$', '閉じない \\( だけ']) {
    assert.equal(normalizeMathDelimiters(s), s)
  }
})
