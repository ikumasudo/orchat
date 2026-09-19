import { z } from 'zod'

export const reasoningEfforts = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const

// UI で選べる server tools。Responses API で使えるものだけ (openrouter:bash は Messages API 専用なので shell を使う)
export const serverTools = [
  { id: 'openrouter:web_search', label: 'Web検索', icon: '🔍' },
  { id: 'openrouter:web_fetch', label: 'Web取得', icon: '🌐' },
  { id: 'openrouter:shell', label: 'シェル', icon: '💻', parameters: { engine: 'openrouter' } },
  { id: 'openrouter:datetime', label: '日時', icon: '🕒' },
] as const
export type ServerToolId = (typeof serverTools)[number]['id']
// アプリ側で実行する function tool のトグル (server tools と同じ ChatSettings.tools に入る)
export const appTools = [{ id: 'app:history', label: '過去のチャット', icon: '🗂️' }] as const
export const toolOptions = [...serverTools, ...appTools]
// function tool 名 → 表示名 (ステップ見出し / ToolItem)
export const functionLabels: Record<string, string> = { search_past_chats: '過去のチャットを検索', read_past_chat: '過去のチャットを読む', read_skill_file: 'スキル読み取り' }
export type ToolId = (typeof toolOptions)[number]['id']

export const chatSettings = z.object({
  model: z.string().min(1),
  reasoning: z.object({ effort: z.enum(reasoningEfforts) }).optional(),
  tools: z.array(z.enum(toolOptions.map((t) => t.id) as [ToolId, ...ToolId[]])).optional(),
})
export type ChatSettings = z.infer<typeof chatSettings>

// 手動改名の入力契約。サーバー・クライアントで共有する
export const conversationTitle = z.string().trim().min(1, '名前を入力してください').max(100, '名前は100文字以内で入力してください').regex(/^[^\r\n]*$/, '名前は1行で入力してください')

// ユーザー入力の content parts (Responses API の input_*)。添付は attachment:<uuid> 参照で保存し送信時に data URL へ解決する
export const userPart = z.union([
  z.object({ type: z.literal('input_text'), text: z.string() }),
  z.object({ type: z.literal('input_image'), image_url: z.string() }),
  z.object({ type: z.literal('input_file'), filename: z.string(), file_data: z.string() }),
])
export type UserPart = z.infer<typeof userPart>

// Responses API の item / part。既知のキーだけ型付けし、残りは透過
export type Annotation = { type: string; url?: string; title?: string; start_index?: number; end_index?: number; [k: string]: unknown }
export type Part = { type: string; text?: string; annotations?: Annotation[]; [k: string]: unknown }
export type Item = {
  type: string // message | reasoning | openrouter:web_search | openrouter:web_fetch | web_search_call | function_call …
  id?: string
  status?: string
  role?: string
  content?: Part[]
  summary?: Part[]
  encrypted_content?: string
  signature?: string
  action?: { type?: string; query?: string; sources?: Array<{ type?: string; url?: string }>; commands?: string[]; [k: string]: unknown }
  url?: string
  // openrouter:shell の実行結果 (配列) / function_call_output の結果 (文字列)
  output?: Array<{ stdout?: string; stderr?: string; outcome?: { type?: string; exit_code?: number } }> | string
  // function_call / function_call_output
  call_id?: string
  name?: string
  arguments?: string
  approval?: 'pending' | 'approved' | 'denied' // アプリが付ける承認状態 (返送時に落とす)
  [k: string]: unknown
}

export type UserBody = { type: 'message'; role: 'user'; content: UserPart[] }
export type AssistantBody = { output: Item[]; error?: string }

// ストリームイベント。type 以外は透過
export type ResponseEvent = {
  type: string
  output_index?: number
  content_index?: number
  summary_index?: number
  annotation_index?: number
  item?: Item
  part?: Part
  delta?: string
  annotation?: Annotation
  response?: { id?: string; model?: string; output?: Item[]; usage?: Usage; status?: string; error?: unknown }
  error?: { message?: string; code?: unknown }
  [k: string]: unknown
}

export type Usage = {
  input_tokens?: number
  output_tokens?: number
  output_tokens_details?: { reasoning_tokens?: number }
  cost?: number
  server_tool_use_details?: { web_search_requests?: number; tool_calls_executed?: number }
  [k: string]: unknown
}

export type ORModel = {
  id: string
  name: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string; web_search?: string }
  architecture?: { input_modalities?: string[]; output_modalities?: string[] }
  supported_parameters?: string[]
}

export type DbMessage = {
  id: string
  conversationId: string
  parentId: string | null
  role: string
  body: UserBody | AssistantBody
  model: string | null
  usage: Usage | null
  cost: string | null
  generationId: string | null
  createdAt: Date
}
