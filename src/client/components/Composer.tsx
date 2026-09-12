import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { BrainIcon, CheckIcon, ChevronDownIcon, ClockIcon, FileTextIcon, GlobeIcon, ImageIcon, LinkIcon, PaperclipIcon, PlusIcon, TerminalIcon, XIcon } from 'lucide-react'
import { client, orpc } from '@/lib/orpc'
import { reasoningEfforts, serverTools, type ChatSettings, type ORModel, type UserPart } from '../../shared/types.js'
import {
  PromptInput,
  PromptInputAttachment,
  PromptInputAttachments,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  type PromptInputMessage,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputAttachments,
} from '@/components/ai-elements/prompt-input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Badge } from '@/components/ui/badge'

type Attached = { ref: string; name: string; mime: string }
type Props = {
  settings: ChatSettings
  onSettings: (s: ChatSettings) => void
  busy: boolean
  editing: { content: UserPart[] } | null
  onCancelEdit: () => void
  onSend: (content: UserPart[]) => void
  onStop: () => void
}

const toolIcons: Record<string, typeof GlobeIcon> = {
  'openrouter:web_search': GlobeIcon,
  'openrouter:web_fetch': LinkIcon,
  'openrouter:shell': TerminalIcon,
  'openrouter:datetime': ClockIcon,
}
const perM = (v?: string) => (v == null ? '' : `$${(Number(v) * 1e6).toFixed(2)}`)

export function Composer({ settings, onSettings, busy, editing, onCancelEdit, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [kept, setKept] = useState<Attached[]>([]) // 編集時に引き継ぐ既存の添付 (attachment:<uuid>)
  const [error, setError] = useState<string>()
  const models = useQuery(orpc.models.list.queryOptions())
  const model = models.data?.find((m) => m.id === settings.model)
  const supports = (p: string) => model?.supported_parameters?.includes(p) ?? true
  const inputs = model?.architecture?.input_modalities ?? ['text', 'image', 'file']
  const accept = [inputs.includes('image') && 'image/*', inputs.includes('file') && 'application/pdf'].filter(Boolean).join(',')

  useEffect(() => {
    if (!editing) return
    setText(editing.content.filter((p) => p.type === 'input_text').map((p) => p.text).join('\n'))
    setKept(
      editing.content.flatMap((p) =>
        p.type === 'input_image' ? [{ ref: p.image_url, name: '画像', mime: 'image/*' }] : p.type === 'input_file' ? [{ ref: p.file_data, name: p.filename, mime: 'application/pdf' }] : [],
      ),
    )
  }, [editing])

  const cancelEdit = () => {
    onCancelEdit()
    setText('')
    setKept([])
  }

  const submit = async (msg: PromptInputMessage) => {
    if (busy || (!msg.text.trim() && !msg.files.length && !kept.length)) return
    setError(undefined)
    try {
      const uploaded: Attached[] = []
      for (const f of msg.files) {
        const blob = await (await fetch(f.url)).blob()
        const file = new File([blob], f.filename ?? 'file', { type: f.mediaType || blob.type })
        const { ref } = await client.attachments.upload({ file })
        uploaded.push({ ref, name: file.name, mime: file.type })
      }
      const parts: UserPart[] = [...kept, ...uploaded].map((f) =>
        f.mime.startsWith('image/') ? { type: 'input_image', image_url: f.ref } : { type: 'input_file', filename: f.name, file_data: f.ref },
      )
      if (msg.text.trim()) parts.push({ type: 'input_text', text: msg.text })
      onSend(parts)
      setText('')
      setKept([])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      throw e // PromptInput 側で添付を保持させる
    }
  }

  const set = (patch: Partial<ChatSettings>) => onSettings({ ...settings, ...patch })
  const showHeader = !!editing || kept.length > 0

  return (
    <div className="shrink-0 px-3 pb-3 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-3xl">
        {error && <p className="mb-2 px-1 text-xs text-destructive">添付のアップロードに失敗しました: {error}</p>}
        <PromptInput
          onSubmit={submit}
          accept={accept || undefined}
          multiple
          globalDrop
          maxFileSize={20 * 1024 * 1024}
          onError={(e) => setError(e.message)}
          className="rounded-2xl bg-card shadow-lg shadow-black/[0.04] dark:shadow-black/40 [&>[data-slot=input-group]]:rounded-2xl"
        >
          <AttachmentsHeader show={showHeader} editing={!!editing} onCancelEdit={cancelEdit} kept={kept} onRemoveKept={(a) => setKept(kept.filter((x) => x !== a))} />
          <PromptInputBody>
            <PromptInputTextarea
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              placeholder={editing ? 'メッセージを編集して送り直す' : 'メッセージを入力'}
              className="min-h-14 px-4 pt-3.5 text-[15px] leading-relaxed"
            />
          </PromptInputBody>
          <PromptInputFooter className="px-2.5 pb-2.5">
            <PromptInputTools className="min-w-0 flex-wrap">
              <PlusMenu settings={settings} set={set} canAttach={!!accept} canReason={supports('reasoning')} canTool={supports('tools')} />
              {supports('tools') &&
                serverTools
                  .filter((t) => settings.tools?.includes(t.id))
                  .map((t) => {
                    const Icon = toolIcons[t.id] ?? GlobeIcon
                    return (
                      <PromptInputButton
                        key={t.id}
                        size="sm"
                        variant="secondary"
                        className="h-7 rounded-full px-2.5 text-xs text-primary"
                        title="クリックでオフ"
                        onClick={() => set({ tools: (settings.tools ?? []).filter((x) => x !== t.id) })}
                      >
                        <Icon className="size-3.5" />
                        {t.label}
                        <XIcon className="size-3 opacity-60" />
                      </PromptInputButton>
                    )
                  })}
            </PromptInputTools>
            <div className="flex min-w-0 shrink-0 items-center gap-1 self-end">
              <ModelPicker models={models.data ?? []} value={settings.model} onChange={(m) => set({ model: m })} />
              {busy ? (
                <PromptInputSubmit type="button" status="streaming" onClick={onStop} aria-label="停止" className="rounded-full" />
              ) : (
                <SubmitButton disabled={!text.trim() && !kept.length} />
              )}
            </div>
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
}

// 以下は PromptInput のコンテキスト内でしか使えないので分離
function PlusMenu({ settings, set, canAttach, canReason, canTool }: { settings: ChatSettings; set: (p: Partial<ChatSettings>) => void; canAttach: boolean; canReason: boolean; canTool: boolean }) {
  const a = usePromptInputAttachments()
  const effort = settings.reasoning?.effort ?? 'default'
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PromptInputButton aria-label="添付とオプション" className="rounded-full">
          <PlusIcon className="size-4" />
        </PromptInputButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem onSelect={a.openFileDialog} disabled={!canAttach}>
          <PaperclipIcon />
          ファイルを添付
        </DropdownMenuItem>
        {canTool && (
          <>
            <DropdownMenuSeparator />
            {serverTools.map((t) => {
              const Icon = toolIcons[t.id] ?? GlobeIcon
              const on = settings.tools?.includes(t.id) ?? false
              return (
                <DropdownMenuCheckboxItem
                  key={t.id}
                  checked={on}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(v) => set({ tools: v ? [...(settings.tools ?? []), t.id] : (settings.tools ?? []).filter((x) => x !== t.id) })}
                >
                  <Icon className="size-4 text-muted-foreground" />
                  {t.label}
                </DropdownMenuCheckboxItem>
              )
            })}
          </>
        )}
        {canReason && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <BrainIcon className="size-4 text-muted-foreground" />
                思考の深さ
                <span className="ml-auto text-xs text-muted-foreground">{effort === 'default' ? '標準' : effort}</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup value={effort} onValueChange={(v) => set({ reasoning: v === 'default' ? undefined : { effort: v as (typeof reasoningEfforts)[number] } })}>
                  <DropdownMenuRadioItem value="default">標準</DropdownMenuRadioItem>
                  {reasoningEfforts.map((e) => (
                    <DropdownMenuRadioItem key={e} value={e}>
                      {e}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function SubmitButton({ disabled }: { disabled: boolean }) {
  const a = usePromptInputAttachments()
  return <PromptInputSubmit status="ready" disabled={disabled && !a.files.length} aria-label="送信" className="rounded-full" />
}

function AttachmentsHeader({ show, editing, onCancelEdit, kept, onRemoveKept }: { show: boolean; editing: boolean; onCancelEdit: () => void; kept: Attached[]; onRemoveKept: (a: Attached) => void }) {
  const a = usePromptInputAttachments()
  if (!show && !a.files.length) return null
  return (
    <PromptInputHeader className="px-3 pt-3">
      {editing && (
        <Badge variant="outline" className="gap-1 border-primary/40 text-primary">
          編集中
          <button type="button" onClick={onCancelEdit} className="-mr-1 rounded-full p-0.5 hover:bg-primary/10" aria-label="編集をやめる">
            <XIcon className="size-3" />
          </button>
        </Badge>
      )}
      {kept.map((f) => (
        <Badge key={f.ref} variant="secondary" className="max-w-56 gap-1.5 py-1">
          {f.mime.startsWith('image/') ? <ImageIcon className="size-3.5" /> : <FileTextIcon className="size-3.5" />}
          <span className="truncate">{f.name}</span>
          <button type="button" onClick={() => onRemoveKept(f)} className="-mr-1 rounded-full p-0.5 hover:bg-foreground/10" aria-label="添付を外す">
            <XIcon className="size-3" />
          </button>
        </Badge>
      ))}
      <PromptInputAttachments>{(f) => <PromptInputAttachment key={f.id} data={f} />}</PromptInputAttachments>
    </PromptInputHeader>
  )
}

function ModelPicker({ models, value, onChange }: { models: ORModel[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const current = models.find((m) => m.id === value)
  const groups = Object.entries(Object.groupBy(models, (m) => m.id.split('/')[0]))
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <PromptInputButton size="sm" className="h-8 max-w-40 px-2 text-xs text-muted-foreground hover:text-foreground sm:max-w-56" aria-label="モデルを選ぶ" title={current?.name ?? value}>
          <span className="truncate">{current?.name ?? value}</span>
          <ChevronDownIcon className="size-3.5 shrink-0 opacity-60" />
        </PromptInputButton>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <Command filter={(value, search) => (value.toLowerCase().includes(search.toLowerCase()) ? 1 : 0)}>
          <CommandInput placeholder="モデルを検索" />
          <CommandList className="max-h-80">
            <CommandEmpty>見つかりません</CommandEmpty>
            {groups.map(([g, ms]) => (
              <CommandGroup key={g} heading={g}>
                {ms!.map((m) => (
                  <CommandItem
                    key={m.id}
                    value={`${m.name} ${m.id}`}
                    onSelect={() => {
                      onChange(m.id)
                      setOpen(false)
                    }}
                  >
                    <span className="truncate">{m.name}</span>
                    {m.pricing && (
                      <span className="ml-auto shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {perM(m.pricing.prompt)}/{perM(m.pricing.completion)}
                      </span>
                    )}
                    {m.id === value && <CheckIcon className="size-4 shrink-0 text-primary" />}
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
