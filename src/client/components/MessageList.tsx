import type { DbMessage } from '../../shared/types.js'
import type { Streaming } from '../routes/chat.js'
import { Conversation, ConversationContent, ConversationEmptyState, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message } from './Message.js'

type Props = {
  path: DbMessage[]
  siblings: Record<string, string[]>
  streaming: Streaming | null
  modelName?: string
  onRegenerate: (m: DbMessage) => void
  onEdit: (m: DbMessage) => void
  onSwitch: (messageId: string) => void
}

export function MessageList({ path, siblings, streaming, modelName, onRegenerate, onEdit, onSwitch }: Props) {
  // 再生成中はその親までを表示 (再生成対象の古い応答は隠す)
  const visible = streaming ? path.slice(0, path.findIndex((m) => m.id === streaming.parentId) + 1 || path.length) : path

  return (
    <Conversation className="flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl gap-6 px-4 pb-8 pt-2 sm:px-6">
        {!visible.length && !streaming ? (
          <ConversationEmptyState className="min-h-[50svh]">
            <p className="max-w-md text-balance text-2xl font-medium leading-snug tracking-tight text-foreground/90">何でも聞いてください。</p>
            {modelName && <p className="font-mono text-xs text-muted-foreground">{modelName}</p>}
          </ConversationEmptyState>
        ) : (
          visible.map((m) => (
            <Message
              key={m.id}
              message={m}
              siblings={siblings[m.parentId ?? ''] ?? []}
              conversationId={m.conversationId}
              onRegenerate={() => onRegenerate(m)}
              onEdit={() => onEdit(m)}
              onSwitch={onSwitch}
            />
          ))
        )}
        {streaming && <Message message={{ id: 'streaming', role: 'assistant', body: { output: streaming.output } }} streaming conversationId={streaming.conversationId} />}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
