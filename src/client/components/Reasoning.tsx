import type { Item } from '../../shared/types.js'
import { itemText } from '../../shared/responses.js'
import { Reasoning as AiReasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'

// reasoning item を表示。streaming 中は開いて流し、完了後は自動で折りたたむ
export function Reasoning({ item, streaming }: { item: Item; streaming?: boolean }) {
  const text = itemText(item)
  const active = !!streaming && item.status !== 'completed'
  const encryptedOnly = !text && !!item.encrypted_content
  return (
    <AiReasoning isStreaming={active} defaultOpen={active} className="mb-2">
      <ReasoningTrigger
        getThinkingMessage={(s, d) =>
          s ? <Shimmer duration={1}>思考中…</Shimmer> : <span>{encryptedOnly ? '思考 (内容は非公開)' : d ? `${d} 秒思考` : '思考'}</span>
        }
      />
      {text && <ReasoningContent className="border-l-2 pl-3">{text}</ReasoningContent>}
    </AiReasoning>
  )
}
