import type { Item } from '../../shared/types.js'
import { serverTools } from '../../shared/types.js'

// server tool / function call の item を表示 (openrouter:web_search, web_fetch, shell, datetime, web_search_call, function_call …)
export function ToolItem({ item }: { item: Item }) {
  const busy = !!item.status && item.status !== 'completed'
  const known = serverTools.find((t) => t.id === item.type)
  const search = /search/.test(item.type)
  const icon = known?.icon ?? (search ? '🔍' : '🔧')
  const label = known?.label ?? (search ? 'Web検索' : item.type.replace(/^openrouter:/, ''))

  if (item.type === 'openrouter:shell') return <ShellItem item={item} icon={icon} label={label} busy={busy} />

  const detail = item.action?.query ?? item.url ?? (typeof item.arguments === 'string' ? item.arguments.slice(0, 120) : '')
  const sources = item.action?.sources?.length
  return (
    <div className="tool-item">
      <span className="chip">{icon} {label}{busy ? '…' : ''}</span> <span>{detail}</span>
      {sources ? <span className="muted"> · {sources} 件</span> : null}
    </div>
  )
}

// コマンドと stdout/stderr/exit code。実行中は開いておく
function ShellItem({ item, icon, label, busy }: { item: Item; icon: string; label: string; busy: boolean }) {
  const commands = item.action?.commands ?? []
  const results = item.output ?? []
  const failed = results.some((r) => r.outcome?.type === 'timeout' || (r.outcome?.exit_code ?? 0) !== 0)
  return (
    <details className="tool-item shell" open={busy}>
      <summary>
        <span className="chip">{icon} {label}{busy ? '…' : ''}</span>{' '}
        <span className="muted">{commands.length} コマンド{failed ? ' · エラー' : ''}{!commands.length && !busy ? ' · 引数不正' : ''}</span>
      </summary>
      {commands.map((cmd, i) => {
        const r = results[i]
        return (
          <pre key={i} className="shell-block">
            <span className="shell-cmd">$ {cmd}</span>
            {r?.stdout ? `\n${r.stdout}` : ''}
            {r?.stderr ? <span className="shell-err">{`\n${r.stderr}`}</span> : ''}
            {r?.outcome && (r.outcome.type === 'timeout' || r.outcome.exit_code) ? <span className="shell-err">{`\n[${r.outcome.type === 'timeout' ? 'timeout' : `exit ${r.outcome.exit_code}`}]`}</span> : ''}
          </pre>
        )
      })}
    </details>
  )
}
