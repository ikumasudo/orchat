import { useEffect, useRef, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { client, orpc } from '../lib/orpc.js'
import { loadSettings, saveSettings } from '../lib/settings.js'
import { applyEvent, initialState } from '../../shared/responses.js'
import type { ChatSettings, DbMessage, Item, UserBody, UserPart } from '../../shared/types.js'
import { MessageList } from '../components/MessageList.js'
import { Composer } from '../components/Composer.js'

export type Streaming = { conversationId: string; parentId: string | null; output: Item[] }

export function Chat({ id }: { id?: string }) {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const conv = useQuery({ ...orpc.conversations.get.queryOptions({ input: { id: id! } }), enabled: !!id })
  const [settings, setSettings] = useState<ChatSettings>(loadSettings)
  const [streaming, setStreaming] = useState<Streaming | null>(null)
  const [pending, setPending] = useState<DbMessage[]>([]) // ストリーム中に追加された user message (再取得前の表示用)
  const [editing, setEditing] = useState<{ parentId: string | null; content: UserPart[] } | null>(null)
  const [error, setError] = useState<{ conversationId: string; message: string }>()
  const abort = useRef<AbortController>(null)

  // 別の会話へ移ったら編集状態は捨てる
  useEffect(() => {
    setEditing(null)
  }, [id])

  // 会話を開いたら保存済み設定を採用
  useEffect(() => {
    if (conv.data) setSettings(conv.data.conversation.settings)
  }, [conv.data?.conversation.id])

  const updateSettings = (s: ChatSettings) => {
    setSettings(s)
    saveSettings(s)
    if (id) client.conversations.updateSettings({ id, settings: s }).then(() => qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id } }) }))
  }

  async function run(conversationId: string, parentId: string | null, content?: UserPart[]) {
    setError(undefined)
    setEditing(null)
    abort.current = new AbortController()
    setStreaming({ conversationId, parentId, output: [] })
    let state = initialState()
    try {
      const events = await client.messages.send({ conversationId, parentId, content, settings }, { signal: abort.current.signal })
      for await (const ev of events) {
        if (ev.type === 'user') {
          setPending((p) => [...p, ev.message])
          setStreaming({ conversationId, parentId: ev.message.id, output: [] })
        } else if (ev.type === 'event') {
          state = applyEvent(state, ev.event)
          const output = state.output.map((it) => ({ ...it })) // 新しい参照にして再描画させる
          setStreaming((s) => s && { ...s, output })
        }
      }
    } catch (e) {
      if (!(e instanceof Error && e.name === 'AbortError')) setError({ conversationId, message: e instanceof Error ? e.message : String(e) })
    } finally {
      await qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id: conversationId } }) })
      qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
      setStreaming(null)
      setPending([])
    }
  }

  const send = async (content: UserPart[]) => {
    const parentId = editing ? editing.parentId : (conv.data?.conversation.leafId ?? null)
    if (id) return run(id, parentId, content)
    const created = await client.conversations.create({ settings })
    await navigate({ to: '/c/$id', params: { id: created.id }, replace: true })
    return run(created.id, null, content)
  }

  const regenerate = (m: DbMessage) => id && run(id, m.parentId)
  const edit = (m: DbMessage) => setEditing({ parentId: m.parentId, content: (m.body as UserBody).content })
  const switchBranch = async (messageId: string) => {
    if (!id) return
    await client.conversations.setLeaf({ id, messageId })
    qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id } }) })
  }

  // 表示は現在の会話のものだけ (別会話のストリームはバックグラウンドで続く)
  const path = [...(conv.data?.path ?? []), ...pending.filter((m) => m.conversationId === id)]
  const shown = streaming?.conversationId === id ? streaming : null
  return (
    <div className="chat">
      <MessageList
        path={path}
        siblings={conv.data?.siblings ?? {}}
        streaming={shown}
        onRegenerate={regenerate}
        onEdit={edit}
        onSwitch={switchBranch}
      />
      {error && error.conversationId === id && <div className="error">{error.message}</div>}
      <Composer
        settings={settings}
        onSettings={updateSettings}
        busy={!!shown}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSend={send}
        onStop={() => abort.current?.abort()}
      />
    </div>
  )
}
