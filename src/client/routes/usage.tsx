import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { orpc } from '../lib/orpc.js'

export function Usage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const q = useQuery(orpc.usage.summary.queryOptions({ input: { month } }))
  const total = q.data?.reduce((a, r) => a + Number(r.cost), 0) ?? 0
  return (
    <div className="page">
      <h1>利用状況</h1>
      <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
      <table className="table">
        <thead>
          <tr>
            <th>ユーザー</th>
            <th>応答数</th>
            <th>コスト (USD)</th>
          </tr>
        </thead>
        <tbody>
          {q.data?.map((r) => (
            <tr key={r.email}>
              <td>
                {r.name} <span className="muted">{r.email}</span>
              </td>
              <td>{r.count}</td>
              <td>${Number(r.cost).toFixed(4)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <th>合計</th>
            <td />
            <th>${total.toFixed(4)}</th>
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
