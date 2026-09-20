import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoRouter, isModelAllowed } from '../src/server/openrouter.ts'

const allow = ['openrouter/auto', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-luna']

test('autoRouter: auto なら行き先を MODELS (auto 自身を除く) に絞り、effort 既定 high', () => {
  const body = autoRouter({ model: 'openrouter/auto', input: [] }, allow)
  assert.deepEqual(body.plugins, [{ id: 'auto-router', allowed_models: ['openai/gpt-5.6-sol', 'openai/gpt-5.6-luna'] }])
  assert.deepEqual(body.reasoning, { effort: 'high' })
  assert.deepEqual(body.input, [])
})

test('autoRouter: ユーザー指定の effort は上書きしない、MODELS 空なら plugins なし', () => {
  const body = autoRouter({ model: 'openrouter/auto', reasoning: { effort: 'low' } }, [])
  assert.deepEqual(body.reasoning, { effort: 'low' })
  assert.equal('plugins' in body, false)
})

test('autoRouter: auto 以外は素通し', () => {
  const src = { model: 'openai/gpt-5.6-sol', input: [] }
  const body = autoRouter(src, allow)
  assert.equal(body, src)
  assert.equal(body.reasoning, undefined)
})

test('isModelAllowed: MODELS 空なら任意のモデルを許可する', () => {
  assert.equal(isModelAllowed('openai/gpt-5.6-sol', []), true)
  assert.equal(isModelAllowed('anthropic/claude-sonnet-4.5', []), true)
})

test('isModelAllowed: MODELS 設定時は一覧にあるモデルだけ許可する', () => {
  assert.equal(isModelAllowed('openai/gpt-5.6-luna', allow), true)
  assert.equal(isModelAllowed('openrouter/auto', allow), true)
  assert.equal(isModelAllowed('anthropic/claude-sonnet-4.5', allow), false)
})

test('isModelAllowed: auto を使うには一覧に auto 自身が必要', () => {
  assert.equal(isModelAllowed('openrouter/auto', ['openai/gpt-5.6-luna']), false)
})
