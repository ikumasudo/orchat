import { test } from 'node:test'
import assert from 'node:assert/strict'
import { conversationTitle } from '../src/shared/types.ts'

test('conversationTitle: 前後の空白だけを取り、前後以外の意味は変えない', () => {
  const parsed = conversationTitle.safeParse('  案件A「見積」。  ')
  assert.equal(parsed.success, true)
  if (parsed.success) assert.equal(parsed.data, '案件A「見積」。')
})

test('conversationTitle: 空・改行・101文字を拒否し、100文字を受理する', () => {
  assert.equal(conversationTitle.safeParse('').success, false)
  assert.equal(conversationTitle.safeParse('   ').success, false)
  assert.equal(conversationTitle.safeParse('案件A\n見積').success, false)
  assert.equal(conversationTitle.safeParse('あ'.repeat(101)).success, false)
  const parsed = conversationTitle.safeParse('あ'.repeat(100))
  assert.equal(parsed.success, true)
  if (parsed.success) assert.equal(parsed.data.length, 100)
})
