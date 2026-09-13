import { useState, type ReactNode } from 'react'
import type { Item } from '../../shared/types.js'
import { functionLabels, serverTools } from '../../shared/types.js'
import { client } from '../lib/orpc.js'
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Button } from '@/components/ui/button'

// server tool / function call の item を表示 (openrouter:web_search, web_fetch, shell, datetime, web_search_call, function_call …)
// function_call は対応する function_call_output を output で受け取る。conversationId はストリーミング中だけ渡され、承認ボタンを出す
export function ToolItem({ item, output, conversationId }: { item: Item; output?: Item; conversationId?: string }) {
  if (item.type === 'function_call') return <FunctionCallItem item={item} output={output} conversationId={conversationId} />
  const busy = !!item.status && item.status !== 'completed'
  const known = serverTools.find((t) => t.id === item.type)
  const search = /search/.test(item.type)
  const label = known?.label ?? (search ? 'Web検索' : item.type.replace(/^openrouter:/, ''))
  const detail = item.action?.query ?? item.url ?? ''
  const type = `tool-${item.type.replace(/^openrouter:/, '')}` as const

  if (item.type === 'openrouter:shell') return <ShellItem item={item} label={label} busy={busy} type={type} />

  const input: Record<string, unknown> = {}
  if (item.action?.query) input.query = item.action.query
  if (item.url) input.url = item.url
  const sources = item.action?.sources?.filter((s) => s.url) ?? []
  return (
    <Tool className="mb-2 bg-card/60">
      <ToolHeader type={type} state={busy ? 'input-available' : 'output-available'} title={detail ? `${label} — ${detail}` : label} />
      <ToolContent>
        {Object.keys(input).length > 0 && <ToolInput input={input} />}
        {sources.length > 0 && (
          <ToolOutput
            errorText={undefined}
            output={
              <ul className="space-y-1 p-3 text-xs">
                {sources.map((s, i) => (
                  <li key={i} className="truncate">
                    <a href={s.url} target="_blank" rel="noreferrer" className="text-primary underline-offset-2 hover:underline">
                      {s.url}
                    </a>
                  </li>
                ))}
              </ul>
            }
          />
        )}
      </ToolContent>
    </Tool>
  )
}

// コマンドと stdout/stderr/exit code。実行中は開いておく
function ShellItem({ item, label, busy, type }: { item: Item; label: string; busy: boolean; type: `tool-${string}` }) {
  const commands = item.action?.commands ?? []
  const results = Array.isArray(item.output) ? item.output : []
  const failed = results.some((r) => r.outcome?.type === 'timeout' || (r.outcome?.exit_code ?? 0) !== 0)
  const state = busy ? 'input-available' : failed ? 'output-error' : 'output-available'
  const title = `${label} — ${commands.length} コマンド${!commands.length && !busy ? ' (引数不正)' : ''}`
  const output: ReactNode = (
    <div className="space-y-2 p-3">
      {commands.map((cmd, i) => {
        const r = results[i]
        const bad = r?.outcome && (r.outcome.type === 'timeout' || r.outcome.exit_code)
        return (
          <pre key={i} className="overflow-x-auto whitespace-pre-wrap rounded-md bg-zinc-950 p-3 font-mono text-xs leading-relaxed text-zinc-200">
            <span className="text-teal-300">$ {cmd}</span>
            {r?.stdout ? `\n${r.stdout}` : ''}
            {r?.stderr ? <span className="text-rose-300">{`\n${r.stderr}`}</span> : ''}
            {bad ? <span className="text-rose-300">{`\n[${r.outcome!.type === 'timeout' ? 'timeout' : `exit ${r.outcome!.exit_code}`}]`}</span> : ''}
          </pre>
        )
      })}
    </div>
  )
  return (
    <Tool className="mb-2 bg-card/60" defaultOpen={busy}>
      <ToolHeader type={type} state={state} title={title} />
      <ToolContent>{commands.length > 0 && <ToolOutput output={output} errorText={undefined} />}</ToolContent>
    </Tool>
  )
}

// アプリ側 function tool: 名前・引数・結果。承認待ち (approval: 'pending') でストリーミング中なら「実行する」「拒否」ボタンを出す
function FunctionCallItem({ item, output, conversationId }: { item: Item; output?: Item; conversationId?: string }) {
  const [decided, setDecided] = useState(false)
  const pending = item.approval === 'pending'
  const result = typeof output?.output === 'string' ? output.output : undefined
  const failed = result?.startsWith('エラー:')
  const state = pending ? 'approval-requested' : item.approval === 'denied' ? 'output-denied' : result == null ? 'input-available' : failed ? 'output-error' : 'output-available'
  const decide = (approved: boolean) => {
    setDecided(true)
    if (conversationId && item.call_id) client.messages.decide({ conversationId, callId: item.call_id, approved }).catch(() => setDecided(false))
  }
  return (
    <Tool className="mb-2 bg-card/60" defaultOpen={pending}>
      <ToolHeader type={`tool-${item.name ?? 'function'}`} state={state} title={functionLabels[item.name ?? ''] ?? item.name ?? 'ツール'} />
      <ToolContent>
        <ToolInput input={parseArgs(item.arguments)} />
        {pending && conversationId && (
          <div className="flex gap-2 px-4 pb-4">
            <Button size="sm" disabled={decided} onClick={() => decide(true)}>
              実行する
            </Button>
            <Button size="sm" variant="outline" disabled={decided} onClick={() => decide(false)}>
              拒否
            </Button>
          </div>
        )}
        {result != null && (
          <ToolOutput
            errorText={failed ? result : undefined}
            output={failed ? undefined : <pre className="overflow-x-auto whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed">{result}</pre>}
          />
        )}
      </ToolContent>
    </Tool>
  )
}

const parseArgs = (args: unknown): unknown => {
  if (typeof args !== 'string') return args ?? {}
  try {
    return JSON.parse(args)
  } catch {
    return args
  }
}
