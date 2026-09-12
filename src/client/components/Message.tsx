import { cloneElement, createContext, isValidElement, useContext, useState, type JSX, type ReactElement, type ReactNode } from 'react'
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, CopyIcon, FileTextIcon, PencilIcon, RefreshCwIcon } from 'lucide-react'
import type { Annotation, AssistantBody, DbMessage, Item, UserBody, UserPart } from '../../shared/types.js'
import { isToolItem } from '../../shared/responses.js'
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
import { Loader } from '@/components/ai-elements/loader'
import { CodeBlock, CodeBlockCopyButton } from '@/components/ai-elements/code-block'
import { JSXPreview, JSXPreviewContent, JSXPreviewError } from '@/components/ai-elements/jsx-preview'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import type { Components, ExtraProps } from 'streamdown'
import { Reasoning } from './Reasoning.js'
import { ToolItem } from './ToolItem.js'

type Props = {
  message: Pick<DbMessage, 'id' | 'role' | 'body'> & Partial<DbMessage>
  siblings?: string[]
  streaming?: boolean
  onRegenerate?: () => void
  onEdit?: () => void
  onSwitch?: (id: string) => void
}

export function Message({ message: m, siblings = [], streaming, onRegenerate, onEdit, onSwitch }: Props) {
  const idx = siblings.indexOf(m.id)
  const isUser = m.role === 'user'
  const text = isUser ? '' : assistantText(m.body as AssistantBody)
  return (
    <AiMessage from={isUser ? 'user' : 'assistant'} className={isUser ? 'max-w-[85%]' : 'max-w-full'}>
      {isUser ? <UserContent content={(m.body as UserBody).content} /> : <AssistantContent body={m.body as AssistantBody} streaming={streaming} />}
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
          <MessageActions className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:opacity-100">
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
      {text && <MessageContent className="whitespace-pre-wrap text-[15px] leading-relaxed">{text}</MessageContent>}
    </>
  )
}
const attachmentUrl = (ref: string) => (ref.startsWith('attachment:') ? `/attachments/${ref.slice('attachment:'.length)}` : ref)

// output items を順に描く: reasoning → tool → message … の順がそのまま「活動のタイムライン」になる
function AssistantContent({ body, streaming }: { body: AssistantBody; streaming?: boolean }) {
  const items = body.output.filter(Boolean)
  const citations = new Map<string, Annotation>()
  for (const it of items) for (const p of it.content ?? []) for (const a of p.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.set(a.url, a)
  return (
    <MessageContent className="w-full text-[15px] leading-relaxed">
      {items.map((item, i) => (
        <ItemView key={item.id ?? i} item={item} streaming={streaming} />
      ))}
      {streaming && !items.length && <Loader className="text-muted-foreground" />}
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

function ItemView({ item, streaming }: { item: Item; streaming?: boolean }) {
  if (item.type === 'reasoning') return <Reasoning item={item} streaming={streaming} />
  if (isToolItem(item)) return <ToolItem item={item} />
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

function JsxPreviewBlock({ code, language }: { code: string; language: 'jsx' | 'tsx' }) {
  const streaming = useContext(JsxPreviewStreamingContext)
  return (
    <Tabs defaultValue="preview" className="my-4 gap-0 overflow-hidden rounded-lg border">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-2 py-1">
        <TabsList className="h-8">
          <TabsTrigger value="preview">プレビュー</TabsTrigger>
          <TabsTrigger value="code">コード</TabsTrigger>
        </TabsList>
        <span className="ml-auto font-mono text-xs lowercase text-muted-foreground">{language}</span>
      </div>
      <TabsContent value="preview" className="mt-0 p-4">
        <JSXPreview jsx={code} isStreaming={streaming}>
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
