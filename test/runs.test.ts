import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRun } from '../src/server/runs.ts'

test('late subscriber replays buffer then receives live events; abort stops waiting', async () => {
  const run = createRun<number>(null)
  run.push(1)
  run.push(2)
  const got: number[] = []
  const late = (async () => {
    for await (const ev of run.subscribe()) got.push(ev)
  })()
  await new Promise((r) => setTimeout(r, 0))
  run.push(3)
  run.end()
  await late
  assert.deepEqual(got, [1, 2, 3])

  const run2 = createRun<number>(null)
  const ac = new AbortController()
  const p = (async () => {
    const out: number[] = []
    for await (const ev of run2.subscribe(ac.signal)) out.push(ev)
    return out
  })()
  await new Promise((r) => setTimeout(r, 0))
  ac.abort()
  assert.deepEqual(await p, [])
  assert.equal(run2.done, false)
})
