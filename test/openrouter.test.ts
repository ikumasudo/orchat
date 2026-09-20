import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoRouter, findShellFile, isModelAllowed, truncateStream } from '../src/server/openrouter.ts'
import type { Item } from '../src/shared/types.ts'

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

const shell = (extra: Partial<Item>): Item => ({ type: 'openrouter:shell', ...extra })

test('findShellFile: outputs/ 配下の file_id から container_id と表示名を引く', () => {
  const item = shell({ container_id: 'gen_1', files: [{ type: 'container_file_citation', file_id: 'cfile_a', filename: 'outputs/a.png', container_id: 'gen_1' }] })
  assert.deepEqual(findShellFile(item, 'cfile_a'), { container_id: 'gen_1', filename: 'outputs/a.png' })
})

test('findShellFile: container_id は引用 → item の順でフォールバックする', () => {
  const item = shell({ container_id: 'gen_1', files: [{ file_id: 'cfile_a', filename: 'outputs/a.png' }] })
  assert.deepEqual(findShellFile(item, 'cfile_a'), { container_id: 'gen_1', filename: 'outputs/a.png' })
})

test('findShellFile: 引用に無い file_id や container_id 欠落は拒否', () => {
  const item = shell({ container_id: 'gen_1', files: [{ file_id: 'cfile_a', filename: 'outputs/a.png', container_id: 'gen_1' }] })
  assert.equal(findShellFile(item, 'cfile_b'), undefined)
  assert.equal(findShellFile(shell({ files: [{ file_id: 'cfile_a', filename: 'outputs/a.png' }] }), 'cfile_a'), undefined)
  assert.equal(findShellFile(shell({}), 'cfile_a'), undefined)
})

test('findShellFile: outputs/ 外や紛らわしいパス、shell 以外の item は拒否', () => {
  const withFile = (filename?: string): Item => shell({ container_id: 'gen_1', files: [{ file_id: 'cfile_a', filename, container_id: 'gen_1' }] })
  assert.equal(findShellFile(withFile('tmp/a.png'), 'cfile_a'), undefined)
  assert.equal(findShellFile(withFile('outputs-old/a.png'), 'cfile_a'), undefined)
  assert.equal(findShellFile(withFile('outputs/../a.png'), 'cfile_a'), undefined)
  assert.equal(findShellFile(withFile(undefined), 'cfile_a'), undefined)
  const other: Item = { type: 'openrouter:web_search', container_id: 'gen_1', files: [{ file_id: 'cfile_a', filename: 'outputs/a.png', container_id: 'gen_1' }] }
  assert.equal(findShellFile(other, 'cfile_a'), undefined)
})

const stream = (...chunks: number[][]) => new ReadableStream<Uint8Array>({ start(c) { for (const ch of chunks) c.enqueue(new Uint8Array(ch)); c.close() } })
const collect = async (s: ReadableStream<Uint8Array>) => { const out: number[] = []; for await (const c of s) out.push(...c); return out }

test('truncateStream: 上限以下はそのまま流す', async () => {
  assert.deepEqual(await collect(truncateStream(stream([1, 2], [3, 4, 5]), 5)), [1, 2, 3, 4, 5])
})

test('truncateStream: 上限でチャンク途中に切って終了する', async () => {
  assert.deepEqual(await collect(truncateStream(stream([1, 2, 3], [4, 5, 6]), 4)), [1, 2, 3, 4])
})

test('truncateStream: 上限到達で上流を cancel する', async () => {
  let cancelled = false
  const upstream = new ReadableStream<Uint8Array>({
    start(c) { c.enqueue(new Uint8Array([1, 2, 3, 4])) },
    cancel() { cancelled = true },
  })
  assert.deepEqual(await collect(truncateStream(upstream, 2)), [1, 2])
  assert.equal(cancelled, true)
})
