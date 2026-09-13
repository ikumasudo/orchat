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
  const attached = useRef(new Set<string>()) // このタブで受信中の会話 (二重接続防止)

  // 別の会話へ移ったら編集状態は捨てる
  useEffect(() => {
    setEditing(null)
  }, [id])

  // 会話を開いたら保存済み設定を採用
  useEffect(() => {
    if (conv.data) setSettings(conv.data.conversation.settings)
  }, [conv.data?.conversation.id])

  // サーバー側で生成が進行中なら (リロード / 別タブ / 離脱からの復帰) 途中から接続する
  useEffect(() => {
    const active = conv.data?.active
    if (id && active) attach(id, active.parentId)
  }, [conv.data])

  const updateSettings = (s: ChatSettings) => {
    setSettings(s)
    saveSettings(s)
    if (id) client.conversations.updateSettings({ id, settings: s }).then(() => qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id } }) }))
  }

  // 進行中の生成に接続してイベントを畳み込む。バッファ済み分は一気に再生される
  async function attach(conversationId: string, parentId: string | null) {
    if (attached.current.has(conversationId)) return
    attached.current.add(conversationId)
    setStreaming({ conversationId, parentId, output: [] })
    let state = initialState()
    try {
      for await (const ev of await client.messages.stream({ conversationId })) {
        state = applyEvent(state, ev)
        const output = state.output.map((it) => ({ ...it })) // 新しい参照にして再描画させる
        setStreaming((s) => s && { ...s, output })
      }
    } catch (e) {
      setError({ conversationId, message: e instanceof Error ? e.message : String(e) })
    } finally {
      attached.current.delete(conversationId)
      await qc.invalidateQueries({ queryKey: orpc.conversations.get.key({ input: { id: conversationId } }) })
      qc.invalidateQueries({ queryKey: orpc.conversations.list.key() })
      setStreaming(null)
      setPending([])
    }
  }

  async function run(conversationId: string, parentId: string | null, content?: UserPart[]) {
    setError(undefined)
    setEditing(null)
    setStreaming({ conversationId, parentId, output: [] }) // send の往復中も busy 表示にする
    try {
      const r = await client.messages.send({ conversationId, parentId, content, settings })
      qc.invalidateQueries({ queryKey: orpc.conversations.list.key() }) // タイトルと updatedAt が確定した時点で一覧に出す (ストリーム終了を待たない)
      if (r.message) setPending((p) => [...p, r.message!])
      await attach(conversationId, r.parentId)
    } catch (e) {
      setError({ conversationId, message: e instanceof Error ? e.message : String(e) })
      setStreaming(null)
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
  // 空の会話では挨拶と入力欄を画面中央に置く (既存会話の読み込み中は出さない)。Composer は子要素の位置を固定して再マウントさせない
  const empty = !shown && !path.length && (!id || conv.isSuccess)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {empty ? (
        <div className="flex flex-1 flex-col items-center justify-end px-4 pb-6 text-center">
          <p className="max-w-md text-balance text-2xl font-medium leading-snug tracking-tight text-foreground/90">何でも聞いてください。</p>
        </div>
      ) : (
        <MessageList path={path} siblings={conv.data?.siblings ?? {}} streaming={shown} onRegenerate={regenerate} onEdit={edit} onSwitch={switchBranch} />
      )}
      {error && error.conversationId === id && (
        <div className="mx-auto mb-2 w-full max-w-3xl px-4 sm:px-6">
          <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
            応答を取得できませんでした: {error.message}
          </p>
        </div>
      )}
      <Composer
        settings={settings}
        onSettings={updateSettings}
        busy={!!shown}
        editing={editing}
        onCancelEdit={() => setEditing(null)}
        onSend={send}
        onStop={() => id && client.messages.stop({ conversationId: id })}
      />
      {empty && <div className="flex-[1.15]" />}
    </div>
  )
}
