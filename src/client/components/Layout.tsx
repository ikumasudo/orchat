import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChartNoAxesColumnIcon, LogOutIcon, MoreHorizontalIcon, PencilIcon, SquarePenIcon, Trash2Icon } from 'lucide-react'
import { orpc } from '@/lib/orpc'
import { conversationTitle } from '../../shared/types.js'
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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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
  // 別タブ / 別デバイスでの変更も拾う (v5 の refetchOnWindowFocus は visibilitychange しか見ないので並べたウィンドウでは効かない)
  const listRes = useQuery({ ...orpc.conversations.list.queryOptions(), refetchInterval: 5_000 })
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
  const [renaming, setRenaming] = useState<{ id: string; value: string } | null>(null)
  const [renameError, setRenameError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  const rename = useMutation(
    orpc.conversations.rename.mutationOptions({
      onSuccess: async (_, { id }) => {
        setRenaming(null)
        setRenameError(null)
        setTouched(false)
        await qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
        await qc.invalidateQueries({ queryKey: orpc.conversations.search.key() })
        await qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id } }) })
      },
      onError: (e) => {
        const code = typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined
        if (code === 'NOT_FOUND') {
          setRenameError('チャットが見つかりません。削除された可能性があります。')
          qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
          qc.invalidateQueries({ queryKey: orpc.conversations.search.key() })
        } else {
          setRenameError('名前を変更できませんでした。もう一度お試しください。')
        }
      },
    }),
  )
  const openRename = (conv: Conv) => {
    rename.reset()
    setRenameError(null)
    setTouched(false)
    setRenaming({ id: conv.id, value: conv.title })
  }
  // id だけを依存にする。value を依存に入れると1文字入力ごとに select() が再実行され全選択になる
  const renamingId = renaming?.id
  useEffect(() => {
    if (!renamingId) return
    const t = setTimeout(() => {
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    })
    return () => clearTimeout(t)
  }, [renamingId])
  const parsedTitle = renaming ? conversationTitle.safeParse(renaming.value) : null
  const parsedIssue = parsedTitle && !parsedTitle.success ? parsedTitle.error.issues[0]?.message : undefined
  const fieldError = renaming && (touched || rename.isPending) && !parsedTitle?.success ? (parsedIssue ?? '名前を入力してください') : null
  const saveRename = (e: FormEvent) => {
    e.preventDefault()
    if (!renaming || rename.isPending) return
    setTouched(true)
    const parsed = conversationTitle.safeParse(renaming.value)
    if (!parsed.success) return
    setRenameError(null)
    rename.mutate({ id: renaming.id, title: parsed.data })
  }
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
                        <DropdownMenuContent side="right" align="start" onCloseAutoFocus={(e) => renaming && e.preventDefault()}>
                          <DropdownMenuItem onClick={() => openRename(c)}>
                            <PencilIcon />
                            名前を変更
                          </DropdownMenuItem>
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
      <Dialog
        open={renaming !== null}
        onOpenChange={(open) => {
          if (!open && !rename.isPending) {
            setRenaming(null)
            setRenameError(null)
            setTouched(false)
            rename.reset()
          }
        }}
      >
        <DialogContent showCloseButton={false} onEscapeKeyDown={(e) => rename.isPending && e.preventDefault()} onPointerDownOutside={(e) => rename.isPending && e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>名前を変更</DialogTitle>
            <DialogDescription>チャットの名前を変更します。</DialogDescription>
          </DialogHeader>
          <form onSubmit={saveRename} className="grid gap-4">
            <div className="grid gap-2">
              <label htmlFor="rename-chat-title" className="text-sm font-medium">
                名前
              </label>
              <Input
                id="rename-chat-title"
                ref={renameInputRef}
                value={renaming?.value ?? ''}
                onChange={(e) => {
                  setRenaming((prev) => (prev ? { ...prev, value: e.target.value } : prev))
                  setTouched(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
                }}
                placeholder="チャットの名前"
                maxLength={100}
                disabled={rename.isPending}
                aria-invalid={fieldError ? true : undefined}
                aria-describedby={fieldError ? 'rename-chat-title-error' : undefined}
              />
              {fieldError && (
                <p id="rename-chat-title-error" className="text-xs text-destructive">
                  {fieldError}
                </p>
              )}
            </div>
            {renameError && (
              <p role="alert" className="text-xs text-destructive">
                {renameError}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" disabled={rename.isPending} onClick={() => !rename.isPending && setRenaming(null)}>
                キャンセル
              </Button>
              <Button type="submit" disabled={!parsedTitle?.success || rename.isPending}>
                {rename.isPending ? '保存中…' : '保存'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
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
