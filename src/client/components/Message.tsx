import { cloneElement, createContext, isValidElement, useContext, useEffect, useRef, useState, type JSX, type ReactElement, type ReactNode } from 'react'
import { BrainIcon, CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, DownloadIcon, FileTextIcon, PencilIcon, RefreshCwIcon } from 'lucide-react'
import type { Annotation, AssistantBody, DbMessage, Item, UserBody, UserPart } from '../../shared/types.js'
import { functionLabels, serverTools } from '../../shared/types.js'
import { isToolItem, itemText, previewType, shellFiles, splitStepsAnswer } from '../../shared/responses.js'
import {
  Message as AiMessage,
  MessageAction,
  MessageActions,
  MessageAttachment,
  MessageAttachments,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import { Source, Sources, SourcesContent, SourcesTrigger } from '@/components/ai-elements/sources'
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import { JSXPreview, JSXPreviewContent, JSXPreviewError } from '@/components/ai-elements/jsx-preview'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import type { Components, ExtraProps } from 'streamdown'
import { Reasoning } from './Reasoning.js'
import { ToolItem, functionDetail } from './ToolItem.js'

type Props = {
  message: Pick<DbMessage, 'id' | 'role' | 'body'> & Partial<DbMessage>
  siblings?: string[]
  streaming?: boolean
  last?: boolean // 最後のメッセージは操作ボタンを常時表示 (それ以外はホバーで)
  onRegenerate?: () => void
  onEdit?: () => void
  onSwitch?: (id: string) => void
}

export function Message({ message: m, siblings = [], streaming, last, onRegenerate, onEdit, onSwitch }: Props) {
  const idx = siblings.indexOf(m.id)
  const isUser = m.role === 'user'
  const text = isUser ? '' : assistantText(m.body as AssistantBody)
  return (
    <AiMessage from={isUser ? 'user' : 'assistant'} className={isUser ? 'max-w-[85%]' : 'max-w-full'}>
      {isUser ? <UserContent content={(m.body as UserBody).content} /> : <AssistantContent body={m.body as AssistantBody} streaming={streaming} conversationId={m.conversationId} messageId={streaming ? undefined : m.id} />}
      {!streaming && (
        <footer className={`flex min-h-7 items-center gap-1 text-muted-foreground ${isUser ? 'justify-end' : ''}`}>
          {siblings.length > 1 && onSwitch && (
            <span className="mr-1 inline-flex items-center font-mono text-xs tabular-nums">
              <MessageAction tooltip="前の分岐" disabled={idx <= 0} onClick={() => onSwitch(siblings[idx - 1])}>
                <ChevronLeftIcon />
              </MessageAction>
              {idx + 1}/{siblings.length}
              <MessageAction tooltip="次の分岐" disabled={idx >= siblings.length - 1} onClick={() => onSwitch(siblings[idx + 1])}>
                <ChevronRightIcon />
              </MessageAction>
            </span>
          )}
          <div className={cn('flex min-w-0 items-center gap-1 transition-opacity', !last && 'opacity-0 group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100')}>
            <MessageActions>
              {isUser && onEdit && (
                <MessageAction tooltip="編集して送り直す" onClick={onEdit}>
                  <PencilIcon />
                </MessageAction>
              )}
              {!isUser && text && <CopyAction text={text} />}
              {!isUser && onRegenerate && (
                <MessageAction tooltip="再生成" onClick={onRegenerate}>
                  <RefreshCwIcon />
                </MessageAction>
              )}
            </MessageActions>
            {!isUser && (m.model || m.cost != null || m.usage) && (
              <span className="ml-2 truncate font-mono text-[11px] tabular-nums">
                {[m.model, m.usage && tokens(m.usage), m.cost != null && `$${Number(m.cost).toFixed(5)}`].filter(Boolean).join('  ·  ')}
              </span>
            )}
          </div>
        </footer>
      )}
    </AiMessage>
  )
}

function CopyAction({ text }: { text: string }) {
  const [done, setDone] = useState(false)
  return (
    <MessageAction
      tooltip={done ? 'コピーしました' : 'コピー'}
      onClick={() => navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500) })}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </MessageAction>
  )
}

const assistantText = (b: AssistantBody) =>
  b.output.filter((it) => it?.type === 'message').map((it) => (it.content ?? []).map((p) => p.text ?? '').join('')).join('\n\n')

function tokens(u: NonNullable<DbMessage['usage']>) {
  const r = u.output_tokens_details?.reasoning_tokens
  const w = u.server_tool_use_details?.web_search_requests
  return `${u.input_tokens ?? 0}→${u.output_tokens ?? 0}${r ? ` (思考 ${r})` : ''} tok${w ? ` · 検索 ${w}` : ''}`
}

function UserContent({ content }: { content: UserPart[] }) {
  const files = content.filter((p) => p.type !== 'input_text')
  const text = content.filter((p) => p.type === 'input_text').map((p) => p.text).join('\n')
  return (
    <>
      {files.length > 0 && (
        <MessageAttachments>
          {files.map((p, i) =>
            p.type === 'input_image' ? (
              <MessageAttachment key={i} data={{ type: 'file', url: attachmentUrl(p.image_url), mediaType: 'image/*' }} className="size-32" />
            ) : p.type === 'input_file' ? (
              <Badge key={i} variant="secondary" className="max-w-60 gap-1.5 py-1">
                <FileTextIcon className="size-3.5" />
                <span className="truncate">{p.filename}</span>
              </Badge>
            ) : null,
          )}
        </MessageAttachments>
      )}
      {text && <MessageContent className="whitespace-pre-wrap text-[15px] leading-relaxed group-[.is-user]:rounded-2xl group-[.is-user]:py-2.5">{text}</MessageContent>}
    </>
  )
}
const attachmentUrl = (ref: string) => (ref.startsWith('attachment:') ? `/attachments/${ref.slice('attachment:'.length)}` : ref)

// output を「活動ブロック (ステップ)」と「回答」に分けて描く。
// 末尾に連続する message が回答、それより前 (reasoning・ツール・途中 message) は折りたたみ 1 つに集約する
function AssistantContent({ body, streaming, conversationId, messageId }: { body: AssistantBody; streaming?: boolean; conversationId?: string; messageId?: string }) {
  const items = body.output.filter(Boolean)
  const { steps, answer } = splitStepsAnswer(items)
  const files = shellFiles(items)
  const citations = new Map<string, Annotation>()
  for (const it of items) for (const p of it.content ?? []) for (const a of p.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.set(a.url, a)
  return (
    <MessageContent className="w-full text-[15px] leading-relaxed">
      {steps.length > 0 && <ActivityBlock steps={steps} streaming={streaming} conversationId={conversationId} />}
      {answer.map((item, i) => (
        <ItemView key={item.id ?? `a${i}`} item={item} streaming={streaming} />
      ))}
      {files.length > 0 && (
        <div className="mt-3 flex flex-col items-start gap-3">
          {files.map((f) => {
            const url = messageId ? `/messages/${messageId}/files/${f.file_id}` : undefined
            return (
              <div key={f.file_id} className="flex min-w-0 max-w-full flex-col items-start gap-2">
                {url && <FilePreview url={url} name={f.filename} />}
                {url ? (
                  <Button asChild variant="outline" size="sm">
                    <a href={url} download>
                      <DownloadIcon />
                      {f.filename}
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled>
                    <DownloadIcon />
                    {f.filename}
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {streaming && !items.length && <span aria-label="生成中" className="my-1.5 block size-3 animate-pulse rounded-full bg-foreground/50" />}
      {body.error && <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{body.error}</p>}
      {citations.size > 0 && (
        <Sources className="mb-0 mt-2">
          <SourcesTrigger count={citations.size}>
            <span className="font-medium">参照元 {citations.size} 件</span>
            <ChevronDownIcon className="size-3.5" />
          </SourcesTrigger>
          <SourcesContent>
            {[...citations.values()].map((c) => (
              <Source key={c.url} href={c.url} title={c.title || c.url} />
            ))}
          </SourcesContent>
        </Sources>
      )}
    </MessageContent>
  )
}

// 生成物のプレビュー。許可した形式だけ表示し、取得失敗・サイズ超過・不明形式は何も出さない (ダウンロードボタンは残る)
function FilePreview({ url, name }: { url: string; name: string }) {
  const preview = previewType(name)
  if (!preview) return null
  return preview.kind === 'image' ? <ImagePreview src={`${url}?preview=1`} alt={name} /> : <TextPreview src={`${url}?preview=1`} />
}

function ImagePreview({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return <img src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} className="max-h-96 max-w-full rounded-md border object-contain" />
}

function TextPreview({ src }: { src: string }) {
  const [text, setText] = useState<string>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let alive = true
    fetch(src)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
      .then((t) => alive && setText(t))
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [src])
  if (failed || text == null) return null
  return <pre className="max-h-96 w-full overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-xs break-words whitespace-pre-wrap">{text}</pre>
}

// 思考・ツール利用・途中テキストを 1 つの折りたたみブロックに集約する。
// 既定は閉じ、開くと各ステップを既存の表示 (Reasoning / ToolItem / MessageResponse) で並べる。開閉は state のみ
function ActivityBlock({ steps, streaming, conversationId }: { steps: Item[]; streaming?: boolean; conversationId?: string }) {
  const [open, setOpen] = useState(false)
  // function_call の結果 (function_call_output) は call_id で引いて ToolItem に渡す (単体では描かない)
  const outputs = new Map(steps.filter((it) => it.type === 'function_call_output' && it.call_id).map((it) => [it.call_id!, it]))
  const running = (it: Item) => (it.type === 'function_call' ? !outputs.has(it.call_id ?? '') : it.status !== 'completed')
  const active = streaming ? [...steps].reverse().find((it) => (it.type === 'reasoning' || isToolItem(it)) && running(it)) : undefined
  const seconds = useActiveSeconds(active != null)
  // 承認待ちの間は承認ボタンを見せるため開いておく
  const awaiting = !!streaming && steps.some((it) => it.approval === 'pending')
  return (
    <Collapsible open={open || awaiting} onOpenChange={setOpen} className="mb-2 rounded-md border bg-muted/40">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:text-foreground">
        <BrainIcon className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{active ? <ActiveStep item={active} /> : summarizeSteps(steps, seconds)}</span>
        <ChevronDownIcon className={cn('size-4 shrink-0 transition-transform', open && 'rotate-180')} />
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-1">
        {steps.map((item, i) => (
          <ItemView key={item.id ?? `s${i}`} item={item} streaming={streaming} output={item.call_id ? outputs.get(item.call_id) : undefined} conversationId={conversationId} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ストリーミング中は閉じたまま現在進行中の 1 ステップだけを 1 行で見せる
function ActiveStep({ item }: { item: Item }) {
  if (item.type === 'reasoning') return <Shimmer duration={1}>思考中…</Shimmer>
  if (item.type === 'function_call' && item.approval === 'pending') return <>承認待ち: {toolLabel(item)}</>
  const detail = item.action?.query ?? item.url ?? functionDetail(item)
  return <>{detail ? `${toolLabel(item)}: ${detail}` : `${toolLabel(item)}: 実行中`}</>
}

// 進行中のステップがあった時間を測る (リロード後は分からないので undefined のまま)
function useActiveSeconds(active: boolean) {
  const [seconds, setSeconds] = useState<number | undefined>(undefined)
  const start = useRef<number | null>(null)
  useEffect(() => {
    if (active) {
      if (start.current == null) {
        start.current = Date.now()
        setSeconds(undefined)
      }
    } else if (start.current != null) {
      setSeconds(Math.max(1, Math.ceil((Date.now() - start.current) / 1000)))
      start.current = null
    }
  }, [active])
  return seconds
}

// 閉じたブロックの 1 行サマリー。Reasoning.tsx の「N 秒思考」「思考 (内容は非公開)」の表現に合わせる
function summarizeSteps(steps: Item[], seconds?: number) {
  const parts: string[] = []
  const reasonings = steps.filter((s) => s.type === 'reasoning')
  if (reasonings.length > 0) {
    const hidden = reasonings.every((r) => !itemText(r) && !!r.encrypted_content)
    parts.push(hidden && seconds == null ? '思考 (内容は非公開)' : seconds != null ? `${seconds} 秒思考` : '思考')
  }
  const counts = new Map<string, number>()
  for (const t of steps.filter(isToolItem)) counts.set(toolLabel(t), (counts.get(toolLabel(t)) ?? 0) + 1)
  for (const [label, n] of counts) parts.push(n > 1 ? `${label} ${n} 件` : label)
  if (parts.length === 0) {
    const text = steps.map((s) => (s.content ?? []).map((p) => p.text ?? '').join('')).join(' ').trim().replace(/\s+/g, ' ')
    if (text) return text.length > 40 ? `${text.slice(0, 40)}…` : text
    return `${steps.length} ステップ`
  }
  return steps.length > 1 ? `${steps.length} ステップ · ${parts.join(' · ')}` : parts.join(' · ')
}

const toolLabel = (item: Item) =>
  serverTools.find((t) => t.id === item.type)?.label ?? (item.type === 'function_call' ? (functionLabels[item.name ?? ''] ?? item.name ?? 'ツール') : /search/.test(item.type) ? 'Web検索' : item.type.replace(/^openrouter:/, ''))

function ItemView({ item, streaming, output, conversationId }: { item: Item; streaming?: boolean; output?: Item; conversationId?: string }) {
  if (item.type === 'reasoning') return <Reasoning item={item} streaming={streaming} />
  if (isToolItem(item)) return <ToolItem item={item} output={output} conversationId={streaming ? conversationId : undefined} />
  if (item.type === 'message') {
    const text = (item.content ?? []).map((p) => p.text ?? '').join('')
    if (!text) return null
    return (
      <JsxPreviewStreamingContext.Provider value={streaming ?? false}>
        <MessageResponse mode={streaming ? 'streaming' : 'static'} components={streamdownComponents}>{text}</MessageResponse>
      </JsxPreviewStreamingContext.Provider>
    )
  }
  return null // 未知の item type は描かない (DB には残っている)
}

// jsx/tsx のコードフェンスだけプレビュー付きタブに差し替える。それ以外は Streamdown 既定のまま。
// pre を差し替えるのでインラインコード (`code`) には触れない。モジュールスコープに置いて identity を安定させる。
const streamdownComponents: Components = { pre: JsxFencePre }

const JsxPreviewStreamingContext = createContext(false)

const jsxFenceLanguage = (className?: string) => /language-(jsx|tsx)\b/.exec(className ?? '')?.[1] as 'jsx' | 'tsx' | undefined

const codeText = (node: ReactNode): string =>
  Array.isArray(node) ? node.map(codeText).join('') : typeof node === 'string' || typeof node === 'number' ? String(node) : ''

function JsxFencePre({ children }: JSX.IntrinsicElements['pre'] & ExtraProps) {
  const child = Array.isArray(children) ? children[0] : children
  if (isValidElement<{ className?: string; children?: ReactNode }>(child)) {
    const language = jsxFenceLanguage(child.props.className)
    if (language) return <JsxPreviewBlock code={codeText(child.props.children)} language={language} />
  }
  // Streamdown の既定の pre と同じ振る舞い (code に data-block を付けてそのまま返す)
  return isValidElement(children) ? cloneElement(children as ReactElement<Record<string, unknown>>, { 'data-block': 'true' }) : children
}

// import/export や関数宣言で始まるものは「コード例」であってそのまま描けないので、コードタブを既定にする
const looksRenderable = (code: string) => !/^\s*(import|export|function|const|let|var|class|type|interface)\b/m.test(code)

function JsxPreviewBlock({ code, language }: { code: string; language: 'jsx' | 'tsx' }) {
  const streaming = useContext(JsxPreviewStreamingContext)
  const [tab, setTab] = useState(looksRenderable(code) ? 'preview' : 'code')
  return (
    <Tabs value={tab} onValueChange={setTab} className="my-4 gap-0 overflow-hidden rounded-xl border-0 bg-muted p-2">
      <div className="flex items-center gap-2 px-2 py-1">
        <TabsList className="h-8">
          <TabsTrigger value="preview">プレビュー</TabsTrigger>
          <TabsTrigger value="code">コード</TabsTrigger>
        </TabsList>
        <span className="ml-auto font-mono text-xs lowercase text-muted-foreground">{language}</span>
      </div>
      <TabsContent value="preview" className="mt-0 p-4">
        <JSXPreview jsx={code} isStreaming={streaming} onError={() => setTab('code')}>
          <JSXPreviewContent />
          <JSXPreviewError />
        </JSXPreview>
      </TabsContent>
      <TabsContent value="code" className="mt-0">
        <CodeBlock code={code} language={language} className="rounded-none border-0">
          <CodeBlockCopyButton />
        </CodeBlock>
      </TabsContent>
    </Tabs>
  )
}
