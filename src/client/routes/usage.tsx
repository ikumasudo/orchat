import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export function Usage() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7))
  const q = useQuery(orpc.usage.summary.queryOptions({ input: { month } }))
  const total = q.data?.reduce((a, r) => a + Number(r.cost), 0) ?? 0
  return (
    <div className="mx-auto w-full max-w-3xl overflow-y-auto px-4 py-6 sm:px-6">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-medium tracking-tight">利用状況</h2>
          <p className="mt-1 text-sm text-muted-foreground">OpenRouter の請求額 (USD) を月ごと、ユーザーごとに集計しています。</p>
        </div>
        <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="w-44" aria-label="対象月" />
      </div>
      <div className="rounded-xl border bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ユーザー</TableHead>
              <TableHead className="text-right">応答数</TableHead>
              <TableHead className="text-right">コスト (USD)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {q.data?.map((r) => (
              <TableRow key={r.email}>
                <TableCell>
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-muted-foreground">{r.email}</div>
                </TableCell>
                <TableCell className="text-right font-mono tabular-nums">{r.count}</TableCell>
                <TableCell className="text-right font-mono tabular-nums">${Number(r.cost).toFixed(4)}</TableCell>
              </TableRow>
            ))}
            {q.isSuccess && !q.data.length && (
              <TableRow>
                <TableCell colSpan={3} className="py-10 text-center text-muted-foreground">
                  この月の利用はありません。
                </TableCell>
              </TableRow>
            )}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell className="font-medium">合計</TableCell>
              <TableCell />
              <TableCell className="text-right font-mono tabular-nums">${total.toFixed(4)}</TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </div>
  )
}
