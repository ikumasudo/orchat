import './env.js'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { oidcAuthMiddleware, processOAuthCallback, revokeSession } from '@hono/oidc-auth'
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import { db, schema, migrateDb } from './db/index.js'
import { claimsHook, oidcServer, requireUser } from './auth.js'
import { containerFileBytes, containerFileContent, findShellFile, truncateStream } from './openrouter.js'
import { previewType } from '../shared/responses.js'
import { router } from './router.js'
import type { AssistantBody } from '../shared/types.js'

await migrateDb()

const app = new Hono()
app.use('*', async (c, next) => {
  c.set('oidcClaimsHook', claimsHook)
  await next()
})
app.use('*', oidcServer)

// 認証: /login で IdP へ、/callback で戻り、/rpc は未ログインなら 401 (クライアントが /login へ飛ばす)
app.get('/logout', async (c) => {
  // cookie 削除は revokeSession の冒頭で行われる。IdP 側の revocation が失敗しても (mock IdP 等) ログアウト自体は成立させる
  await revokeSession(c).catch((e) => console.warn('token revocation failed:', e instanceof Error ? e.message : e))
  return c.redirect('/')
})
app.get('/callback', (c) => processOAuthCallback(c))
app.use('/login', oidcAuthMiddleware())
app.get('/login', (c) => c.redirect('/'))

const rpc = new RPCHandler(router, { interceptors: [onError((e) => console.error(e))] })
app.use('/rpc/*', requireUser, async (c, next) => {
  const { matched, response } = await rpc.handle(c.req.raw, { prefix: '/rpc', context: { user: c.get('user') } })
  if (matched) return c.newResponse(response.body, response)
  await next()
})

// 画像プレビュー用。本人の添付だけ
app.get('/attachments/:id', requireUser, async (c) => {
  const att = await db.query.attachments.findFirst({
    where: and(eq(schema.attachments.id, c.req.param('id')), eq(schema.attachments.userId, c.get('user').id)),
  })
  if (!att) return c.notFound()
  return c.body(new Uint8Array(att.data), 200, { 'Content-Type': att.mime, 'Cache-Control': 'private, max-age=86400' })
})

// shell ツールがコンテナに作ったファイルのダウンロード (?preview=1 ならプレビュー)。本人の会話の shell item が引用した file_id だけを OpenRouter へ中継する
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_TEXT_BYTES = 256 * 1024
app.get('/messages/:messageId/files/:fileId', requireUser, async (c) => {
  const messageId = c.req.param('messageId')
  const fileId = c.req.param('fileId')
  if (!UUID_RE.test(messageId)) return c.notFound()
  const [row] = await db
    .select({ body: schema.messages.body })
    .from(schema.messages)
    .innerJoin(schema.conversations, eq(schema.messages.conversationId, schema.conversations.id))
    .where(and(eq(schema.messages.id, messageId), eq(schema.conversations.userId, c.get('user').id)))
  const found = (row?.body as AssistantBody | undefined)?.output?.map((it) => findShellFile(it, fileId)).find(Boolean)
  if (!found) return c.notFound()
  const preview = c.req.query('preview') != null ? previewType(found.filename) : undefined
  if (preview?.kind === 'image') {
    const bytes = await containerFileBytes(found.container_id, fileId)
    if (bytes == null || bytes > MAX_IMAGE_BYTES) return c.notFound() // 上限超過・メタデータ取得失敗はプレビューしない
  }
  const res = await containerFileContent(found.container_id, fileId)
  if (!res.ok || !res.body) return c.newResponse(null, res.status === 404 ? 404 : 502)
  if (preview) {
    const headers = { 'Content-Type': preview.mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'private, max-age=86400' }
    return c.body(preview.kind === 'text' ? truncateStream(res.body, MAX_TEXT_BYTES) : res.body, 200, headers)
  }
  const name = found.filename.split('/').pop() || fileId
  const ascii = name.replace(/[^\x20-\x7e]|["\\]/g, '_')
  return c.body(res.body, 200, {
    'Content-Type': res.headers.get('content-type') ?? 'application/octet-stream',
    'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, max-age=86400',
  })
})

app.use('*', serveStatic({ root: 'dist/client' }))
app.get('*', serveStatic({ path: 'dist/client/index.html' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`orchat listening on :${port}`))
