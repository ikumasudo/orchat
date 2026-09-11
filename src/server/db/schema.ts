import type { ChatSettings } from '../../shared/types.js'
import { pgTable, uuid, text, timestamp, jsonb, numeric, integer, customType, index } from 'drizzle-orm/pg-core'

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' })

export const users = pgTable('users', {
  id: uuid().primaryKey().defaultRandom(),
  sub: text().notNull().unique(),
  email: text().notNull(),
  name: text().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const conversations = pgTable(
  'conversations',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    title: text().notNull().default(''),
    leafId: uuid('leaf_id'),
    settings: jsonb().$type<ChatSettings>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('conversations_user_updated').on(t.userId, t.updatedAt)],
)

export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    conversationId: uuid('conversation_id').notNull().references(() => conversations.id, { onDelete: 'cascade' }),
    parentId: uuid('parent_id'),
    role: text().notNull(),
    // OpenRouter の message オブジェクトそのまま (content, reasoning, reasoning_details, tool_calls, annotations …)
    body: jsonb().$type<Record<string, unknown>>().notNull(),
    model: text(),
    usage: jsonb().$type<Record<string, unknown>>(),
    cost: numeric({ precision: 12, scale: 8 }),
    generationId: text('generation_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('messages_conversation').on(t.conversationId), index('messages_parent').on(t.parentId)],
)

export const attachments = pgTable('attachments', {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  filename: text().notNull(),
  mime: text().notNull(),
  size: integer().notNull(),
  // ponytail: bytea 保存。数 GB 超えたら S3/MinIO に
  data: bytea().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export type { ChatSettings } from '../../shared/types.js'
