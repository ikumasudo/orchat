import { useEffect, useRef } from 'react'
import type { DbMessage } from '../../shared/types.js'
import type { Streaming } from '../routes/chat.js'
import { Message } from './Message.js'

type Props = {
  path: DbMessage[]
  siblings: Record<string, string[]>
  streaming: Streaming | null
  onRegenerate: (m: DbMessage) => void
  onEdit: (m: DbMessage) => void
  onSwitch: (messageId: string) => void
}

export function MessageList({ path, siblings, streaming, onRegenerate, onEdit, onSwitch }: Props) {
  const bottom = useRef<HTMLDivElement>(null)
  const streamedChars = streaming?.output.reduce((n, it) => n + (it.content?.reduce((m, p) => m + (p.text?.length ?? 0), 0) ?? 0), 0)
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [path.length, streamedChars])

  // 再生成中はその親までを表示 (再生成対象の古い応答は隠す)
  const visible = streaming ? path.slice(0, path.findIndex((m) => m.id === streaming.parentId) + 1 || path.length) : path

  if (!visible.length && !streaming) return <div className="empty">何でも聞いてください。</div>
  return (
    <div className="messages">
      {visible.map((m) => (
        <Message
          key={m.id}
          message={m}
          siblings={siblings[m.parentId ?? ''] ?? []}
          onRegenerate={() => onRegenerate(m)}
          onEdit={() => onEdit(m)}
          onSwitch={onSwitch}
        />
      ))}
      {streaming && <Message message={{ id: 'streaming', role: 'assistant', body: { output: streaming.output } }} streaming />}
      <div ref={bottom} />
    </div>
  )
}
