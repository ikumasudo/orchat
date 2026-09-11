import './env.js'
import { Hono } from 'hono'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { oidcAuthMiddleware, processOAuthCallback, revokeSession } from '@hono/oidc-auth'
import { RPCHandler } from '@orpc/server/fetch'
import { onError } from '@orpc/server'
import { and, eq } from 'drizzle-orm'
import { db, schema, migrateDb } from './db/index.js'
import { claimsHook, requireUser } from './auth.js'
import { router } from './router.js'

await migrateDb()

const app = new Hono()
app.use('*', async (c, next) => {
  c.set('oidcClaimsHook', claimsHook)
  await next()
})

// 認証: /login で IdP へ、/callback で戻り、/rpc は未ログインなら 401 (クライアントが /login へ飛ばす)
app.get('/logout', async (c) => {
  await revokeSession(c)
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

app.use('*', serveStatic({ root: 'dist/client' }))
app.get('*', serveStatic({ path: 'dist/client/index.html' }))

const port = Number(process.env.PORT ?? 3000)
serve({ fetch: app.fetch, port }, () => console.log(`orchat listening on :${port}`))
