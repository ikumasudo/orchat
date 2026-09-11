import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { client, orpc } from '../lib/orpc.js'
import { reasoningEfforts, serverTools, type ChatSettings, type UserPart } from '../../shared/types.js'

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

export function Composer({ settings, onSettings, busy, editing, onCancelEdit, onSend, onStop }: Props) {
  const [text, setText] = useState('')
  const [files, setFiles] = useState<Attached[]>([])
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const models = useQuery(orpc.models.list.queryOptions())
  const model = models.data?.find((m) => m.id === settings.model)
  const supports = (p: string) => model?.supported_parameters?.includes(p) ?? true
  const inputs = model?.architecture?.input_modalities ?? ['text', 'image', 'file']

  useEffect(() => {
    if (!editing) return
    setText(editing.content.filter((p) => p.type === 'input_text').map((p) => p.text).join('\n'))
    setFiles(
      editing.content.flatMap((p) =>
        p.type === 'input_image' ? [{ ref: p.image_url, name: '画像', mime: 'image/*' }] : p.type === 'input_file' ? [{ ref: p.file_data, name: p.filename, mime: 'application/pdf' }] : [],
      ),
    )
  }, [editing])

  const submit = () => {
    if (busy || (!text.trim() && !files.length)) return
    const parts: UserPart[] = files.map((f) =>
      f.mime.startsWith('image/') ? { type: 'input_image', image_url: f.ref } : { type: 'input_file', filename: f.name, file_data: f.ref },
    )
    if (text.trim()) parts.push({ type: 'input_text', text })
    onSend(parts)
    setText('')
    setFiles([])
  }

  const upload = async (list: FileList | null) => {
    if (!list?.length) return
    setUploading(true)
    try {
      for (const file of list) {
        const { ref } = await client.attachments.upload({ file })
        setFiles((f) => [...f, { ref, name: file.name, mime: file.type }])
      }
    } finally {
      setUploading(false)
      if (fileInput.current) fileInput.current.value = ''
    }
  }

  const set = (patch: Partial<ChatSettings>) => onSettings({ ...settings, ...patch })
  const groups = Object.entries(Object.groupBy(models.data ?? [], (m) => m.id.split('/')[0]))

  return (
    <div className="composer">
      <div className="toolbar">
        <select value={settings.model} onChange={(e) => set({ model: e.target.value })} title={model?.name}>
          {!model && <option value={settings.model}>{settings.model}</option>}
          {groups.map(([g, ms]) => (
            <optgroup key={g} label={g}>
              {ms!.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {supports('reasoning') && (
          <select value={settings.reasoning?.effort ?? ''} onChange={(e) => set({ reasoning: e.target.value ? { effort: e.target.value as (typeof reasoningEfforts)[number] } : undefined })}>
            <option value="">思考: デフォルト</option>
            {reasoningEfforts.map((e) => (
              <option key={e} value={e}>
                思考: {e}
              </option>
            ))}
          </select>
        )}
        {supports('tools') &&
          serverTools.map((t) => (
            <label key={t.id} title={t.id}>
              <input
                type="checkbox"
                checked={settings.tools?.includes(t.id) ?? false}
                onChange={(e) => set({ tools: e.target.checked ? [...(settings.tools ?? []), t.id] : (settings.tools ?? []).filter((x) => x !== t.id) })}
              />{' '}
              {t.icon} {t.label}
            </label>
          ))}
        {model?.pricing && (
          <span className="muted price">
            ${(Number(model.pricing.prompt) * 1e6).toFixed(2)} / ${(Number(model.pricing.completion) * 1e6).toFixed(2)} per 1M
          </span>
        )}
      </div>
      {(files.length > 0 || editing) && (
        <div className="attachments">
          {editing && (
            <span className="chip">
              編集中 <button className="icon" onClick={() => { onCancelEdit(); setText(''); setFiles([]) }}>×</button>
            </span>
          )}
          {files.map((f) => (
            <span key={f.ref} className="chip">
              {f.mime.startsWith('image/') ? '🖼' : '📄'} {f.name} <button className="icon" onClick={() => setFiles(files.filter((x) => x !== f))}>×</button>
            </span>
          ))}
        </div>
      )}
      <div className="input-row">
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept={[inputs.includes('image') && 'image/*', inputs.includes('file') && 'application/pdf'].filter(Boolean).join(',')}
          onChange={(e) => upload(e.target.files)}
        />
        <button className="icon" title="添付" disabled={uploading || (!inputs.includes('image') && !inputs.includes('file'))} onClick={() => fileInput.current?.click()}>
          {uploading ? '…' : '📎'}
        </button>
        <textarea
          value={text}
          rows={Math.min(8, text.split('\n').length)}
          placeholder="メッセージ (Enter で送信 / Shift+Enter で改行)"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              submit()
            }
          }}
        />
        {busy ? (
          <button className="btn" onClick={onStop}>停止</button>
        ) : (
          <button className="btn primary" onClick={submit} disabled={!text.trim() && !files.length}>送信</button>
        )}
      </div>
    </div>
  )
}
