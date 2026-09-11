import type { Item } from '../../shared/types.js'
import { itemText } from '../../shared/responses.js'

// reasoning item をそのまま表示。streaming 中は開いておき、完了後は折りたたむ
export function Reasoning({ item, streaming }: { item: Item; streaming?: boolean }) {
  const text = itemText(item)
  const encryptedOnly = !text && !!item.encrypted_content
  return (
    <details className="reasoning" open={streaming && item.status !== 'completed'}>
      <summary>
        {streaming && item.status !== 'completed' ? '思考中…' : '思考'}
        {encryptedOnly && <span className="muted"> (暗号化された思考)</span>}
      </summary>
      {text && <pre className="reasoning-block">{text}</pre>}
    </details>
  )
}
