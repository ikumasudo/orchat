import { useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChartNoAxesColumnIcon, LogOutIcon, MoreHorizontalIcon, SquarePenIcon, Trash2Icon } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from '@/components/ui/sidebar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Separator } from '@/components/ui/separator'

type Conv = { id: string; title: string; updatedAt: Date }

// 更新日で 今日 / 昨日 / 過去7日 / それ以前 に分ける
function bucket(d: Date, now = new Date()) {
  const day = 86_400_000
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const t = new Date(d).getTime()
  if (t >= start) return '今日'
  if (t >= start - day) return '昨日'
  if (t >= start - 7 * day) return '過去7日間'
  return 'それ以前'
}

export function Layout({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const params = useParams({ strict: false }) as { id?: string }
  const me = useQuery(orpc.me.queryOptions())
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  const searching = debounced !== ''
  const listRes = useQuery(orpc.conversations.list.queryOptions())
  const searchRes = useQuery({ ...orpc.conversations.search.queryOptions({ input: { q: debounced } }), enabled: searching })
  const convs = searching ? searchRes : listRes
  const del = useMutation(
    orpc.conversations.delete.mutationOptions({
      onSuccess: (_, { id }) => {
        qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
        qc.invalidateQueries({ queryKey: orpc.conversations.search.key() })
        if (params.id === id) navigate({ to: '/' })
      },
    }),
  )
  const groups = Object.entries(Object.groupBy((convs.data ?? []) as Conv[], (c) => bucket(c.updatedAt)))
  const current = listRes.data?.find((c) => c.id === params.id)
  const title = pathname === '/usage' ? '利用状況' : current ? current.title || '無題のチャット' : '新しいチャット'

  return (
    <SidebarProvider>
      <Sidebar collapsible="offcanvas">
        <SidebarHeader className="gap-3 px-3 pt-3">
          <Link to="/" className="px-2 font-mono text-sm font-medium tracking-tight text-sidebar-foreground/80">
            orchat
          </Link>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/'} className="font-medium">
                <Link to="/">
                  <SquarePenIcon />
                  <span>新しいチャット</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="チャットを検索" aria-label="チャットを検索" />
        </SidebarHeader>
        <SidebarContent>
          {groups.map(([label, list]) => (
            <SidebarGroup key={label}>
              <SidebarGroupLabel>{label}</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {list!.map((c) => (
                    <SidebarMenuItem key={c.id}>
                      <SidebarMenuButton asChild isActive={params.id === c.id} title={c.title}>
                        <Link to="/c/$id" params={{ id: c.id }}>
                          <span className="truncate">{c.title || '無題のチャット'}</span>
                        </Link>
                      </SidebarMenuButton>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <SidebarMenuAction showOnHover aria-label="メニュー">
                            <MoreHorizontalIcon />
                          </SidebarMenuAction>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent side="right" align="start">
                          <DropdownMenuItem variant="destructive" onClick={() => confirm('このチャットを削除しますか？') && del.mutate({ id: c.id })}>
                            <Trash2Icon />
                            削除
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))}
          {convs.isSuccess && !convs.data.length && !searching && <p className="px-4 py-6 text-xs text-muted-foreground">まだチャットはありません。</p>}
        </SidebarContent>
        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton asChild isActive={pathname === '/usage'}>
                <Link to="/usage">
                  <ChartNoAxesColumnIcon />
                  <span>利用状況</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton asChild tooltip="ログアウト">
                <a href="/logout">
                  <LogOutIcon />
                  <span className="truncate" title={me.data?.email}>
                    {me.data?.name || me.data?.email || '…'}
                  </span>
                </a>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
      <SidebarInset className="h-svh min-h-0 overflow-hidden">
        <header className="flex h-12 shrink-0 items-center gap-2 px-3">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-1 data-[orientation=vertical]:h-4" />
          <h1 className="truncate text-sm font-medium">{title}</h1>
        </header>
        <div className="flex min-h-0 flex-1 flex-col">{children}</div>
      </SidebarInset>
    </SidebarProvider>
  )
}
