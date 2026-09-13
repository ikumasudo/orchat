import { test } from 'node:test'
import assert from 'node:assert/strict'
import { escapeLike, recentChatsPrompt, snippet } from '../src/shared/search.ts'

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

test('snippet: 一致位置の前後を切り出し、切れた側に … を付ける', () => {
  const text = 'a'.repeat(300) + 'ズッキーニ' + 'b'.repeat(300)
  const s = snippet(text, 'ずっきーに'.replace('ずっきーに', 'ズッキーニ'), 60)
  assert.equal(s.length, 62)
  assert.ok(s.startsWith('…') && s.endsWith('…'))
  assert.ok(s.includes('ズッキーニ'))
  assert.equal(s.indexOf('ズッキーニ'), 21) // 前に len/3 = 20 文字 + '…'
})

test('snippet: 一致なし・短文・大文字小文字無視・空白畳み込み', () => {
  assert.equal(snippet('short  text\n\nhere', 'なし', 160), 'short text here')
  assert.equal(snippet('x'.repeat(50) + 'World', 'WORLD', 10), '…xxxxxWorld')
  assert.equal(snippet('x'.repeat(100), '', 10), 'x'.repeat(10) + '…')
})

test('recentChatsPrompt: 空なら空文字、あれば id | タイトル | 日付 の行と指示文', () => {
  assert.equal(recentChatsPrompt([]), '')
  const rows = [
    { id: 'a1', title: 'orchat 移行', updatedAt: new Date('2026-09-12T15:00:00Z') }, // JST 9/13 00:00
    { id: 'b2', title: '', updatedAt: new Date('2026-09-11T00:00:00Z') },
  ]
  const lines = recentChatsPrompt(rows).split('\n')
  assert.equal(lines.length, 4)
  assert.equal(lines[1], 'a1 | orchat 移行 | 2026/9/13')
  assert.equal(lines[2], 'b2 | (無題) | 2026/9/11')
  assert.match(lines[3], /read_past_chat/)
  assert.match(lines[3], /search_past_chats/)
})
