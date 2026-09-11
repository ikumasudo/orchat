import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Annotation, AssistantBody, DbMessage, Item, UserBody, UserPart } from '../../shared/types.js'
import { isToolItem } from '../../shared/responses.js'
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
  return (
    <article className={`msg ${m.role}`}>
      {m.role === 'user' ? <UserContent content={(m.body as UserBody).content} /> : <AssistantContent body={m.body as AssistantBody} streaming={streaming} />}
      <footer className="msg-footer">
        {siblings.length > 1 && onSwitch && (
          <span className="branches">
            <button className="icon" disabled={idx <= 0} onClick={() => onSwitch(siblings[idx - 1])}>‹</button>
            {idx + 1}/{siblings.length}
            <button className="icon" disabled={idx >= siblings.length - 1} onClick={() => onSwitch(siblings[idx + 1])}>›</button>
          </span>
        )}
        {m.role === 'user' && onEdit && <button className="link" onClick={onEdit}>編集</button>}
        {m.role === 'assistant' && !streaming && onRegenerate && <button className="link" onClick={onRegenerate}>再生成</button>}
        {m.model && <span className="muted">{m.model}</span>}
        {m.cost != null && <span className="muted">${Number(m.cost).toFixed(5)}</span>}
        {m.usage && <span className="muted">{tokens(m.usage)}</span>}
      </footer>
    </article>
  )
}

function tokens(u: NonNullable<DbMessage['usage']>) {
  const r = u.output_tokens_details?.reasoning_tokens
  const w = u.server_tool_use_details?.web_search_requests
  return `${u.input_tokens ?? 0}→${u.output_tokens ?? 0}${r ? ` (思考 ${r})` : ''} tok${w ? ` · 検索 ${w}` : ''}`
}

function UserContent({ content }: { content: UserPart[] }) {
  return (
    <div className="user-content">
      {content.map((p, i) =>
        p.type === 'input_text' ? (
          <p key={i}>{p.text}</p>
        ) : p.type === 'input_image' ? (
          <img key={i} src={attachmentUrl(p.image_url)} alt="" className="thumb" />
        ) : (
          <span key={i} className="chip">📄 {p.filename}</span>
        ),
      )}
    </div>
  )
}
const attachmentUrl = (ref: string) => (ref.startsWith('attachment:') ? `/attachments/${ref.slice('attachment:'.length)}` : ref)

// output items を順に描く: reasoning → tool → message … の順がそのまま「活動のタイムライン」になる
function AssistantContent({ body, streaming }: { body: AssistantBody; streaming?: boolean }) {
  const items = body.output.filter(Boolean)
  const citations = new Map<string, Annotation>()
  for (const it of items) for (const p of it.content ?? []) for (const a of p.annotations ?? []) if (a.type === 'url_citation' && a.url) citations.set(a.url, a)
  return (
    <div className="assistant-content">
      {items.map((item, i) => (
        <ItemView key={item.id ?? i} item={item} streaming={streaming} />
      ))}
      {streaming && !items.length && <span className="muted">…</span>}
      {body.error && <div className="error">{body.error}</div>}
      {citations.size > 0 && (
        <ol className="citations">
          {[...citations.values()].map((c) => (
            <li key={c.url}>
              <a href={c.url} target="_blank" rel="noreferrer">{c.title || c.url}</a>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function ItemView({ item, streaming }: { item: Item; streaming?: boolean }) {
  if (item.type === 'reasoning') return <Reasoning item={item} streaming={streaming} />
  if (isToolItem(item)) return <ToolItem item={item} />
  if (item.type === 'message') {
    const text = (item.content ?? []).map((p) => p.text ?? '').join('')
    return text ? <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown> : null
  }
  return null // 未知の item type は描かない (DB には残っている)
}
