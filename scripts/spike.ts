// OpenRouter Responses API の生ストリームを取得してフィクスチャに保存する (仕様確認用)
//   pnpm spike [model]
import { writeFileSync, mkdirSync } from 'node:fs'

try { process.loadEnvFile('.env') } catch {}
const model = process.argv[2] ?? 'anthropic/claude-sonnet-4.5'
mkdirSync('test/fixtures', { recursive: true })

async function run(name: string, body: Record<string, unknown>) {
  const res = await fetch('https://openrouter.ai/api/v1/responses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, stream: true }),
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  const text = await res.text()
  const events = text.split('\n\n').flatMap((e) => e.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim())).filter((d) => d && d !== '[DONE]').map((d) => JSON.parse(d))
  writeFileSync(`test/fixtures/${name}.jsonl`, events.map((e) => JSON.stringify(e)).join('\n') + '\n')
  console.log(`\n=== ${name}: ${events.length} events`)
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
  console.log(counts)
  const done = events.find((e) => e.type === 'response.completed' || e.type === 'response.done')
  const out = done?.response?.output ?? []
  console.log('final output item types:', out.map((o: any) => o.type))
  for (const o of out) console.log(JSON.stringify(o).slice(0, 700))
  console.log('usage:', JSON.stringify(done?.response?.usage))
  // 代表イベントの形
  for (const t of ['response.output_item.added', 'response.output_text.delta', 'response.content_part.delta', 'response.reasoning.delta', 'response.reasoning_text.delta', 'response.reasoning_summary_text.delta', 'response.web_search_call.searching', 'response.output_text.annotation.added', 'response.output_item.done']) {
    const e = events.find((x) => x.type === t)
    if (e) console.log(`  ${t}:`, JSON.stringify(e).slice(0, 400))
  }
  return out
}

const q1 = { type: 'message', role: 'user', content: [{ type: 'input_text', text: '17 × 23 は？暗算の途中も含めて簡潔に。' }] }
const out1 = await run('resp-reasoning', { model, input: [q1], reasoning: { effort: 'low' } })
await run('resp-reasoning-turn2', { model, input: [q1, ...out1, { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'その答えに 5 を足すと？' }] }], reasoning: { effort: 'low' } })
await run('resp-web', {
  model,
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '今日の東京の天気を調べて、出典 URL 付きで 1 行で教えて。' }] }],
  tools: [{ type: 'openrouter:web_search', parameters: { max_uses: 2 } }, { type: 'openrouter:web_fetch' }],
})
await run('resp-web-gpt', {
  model: 'openai/gpt-5-mini',
  reasoning: { effort: 'low' },
  input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: '今日の東京の天気を調べて、出典 URL 付きで 1 行で教えて。' }] }],
  tools: [{ type: 'openrouter:web_search', parameters: { max_uses: 2 } }],
})
