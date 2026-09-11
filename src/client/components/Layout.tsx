import type { ReactNode } from 'react'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { orpc } from '../lib/orpc.js'

export function Layout({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { id?: string }
  const me = useQuery(orpc.me.queryOptions())
  const convs = useQuery(orpc.conversations.list.queryOptions())
  const del = useMutation(
    orpc.conversations.delete.mutationOptions({
      onSuccess: (_, { id }) => {
        qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
        if (params.id === id) navigate({ to: '/' })
      },
    }),
  )

  return (
    <div className="layout">
      <aside className="sidebar">
        <Link to="/" className="btn new-chat">
          ＋ 新しいチャット
        </Link>
        <nav className="conv-list">
          {convs.data?.map((c) => (
            <div key={c.id} className={`conv-item ${params.id === c.id ? 'active' : ''}`}>
              <Link to="/c/$id" params={{ id: c.id }} title={c.title}>
                {c.title || '(無題)'}
              </Link>
              <button className="icon" title="削除" onClick={() => confirm('削除しますか？') && del.mutate({ id: c.id })}>
                ×
              </button>
            </div>
          ))}
        </nav>
        <footer className="sidebar-footer">
          <Link to="/usage">利用状況</Link>
          <span className="muted" title={me.data?.email}>
            {me.data?.name || me.data?.email}
          </span>
          <a href="/logout">ログアウト</a>
        </footer>
      </aside>
      <main className="main">{children}</main>
    </div>
  )
}
