import type { Context, MiddlewareHandler } from 'hono'
import { getAuth, type OidcClaimsHook } from '@hono/oidc-auth'
import { db, schema } from './db/index.js'

export type User = { id: string; email: string; name: string; admin: boolean }

// Entra ID は email が無いことがあるので preferred_username にフォールバック
export const claimsHook: OidcClaimsHook = async (orig, claims) => ({
  sub: claims?.sub ?? orig?.sub,
  email: ((claims?.email ?? claims?.preferred_username ?? orig?.email) as string | undefined)?.toLowerCase(),
  name: (claims?.name as string | undefined) ?? orig?.name ?? '',
})

const admins = new Set((process.env.ADMIN_EMAILS ?? '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean))

async function upsertUser(sub: string, email: string, name: string): Promise<User> {
  const [row] = await db
    .insert(schema.users)
    .values({ sub, email, name })
    .onConflictDoUpdate({ target: schema.users.sub, set: { email, name } })
    .returning()
  return { id: row.id, email: row.email, name: row.name, admin: admins.has(row.email) }
}

export async function currentUser(c: Context): Promise<User | null> {
  // dev 専用バイパス。production では常に無効
  const dev = process.env.NODE_ENV !== 'production' && process.env.DEV_USER
  if (dev) return upsertUser(`dev:${dev}`, dev.toLowerCase(), dev.split('@')[0])
  const auth = await getAuth(c)
  if (!auth?.sub) return null
  return upsertUser(auth.sub, auth.email ?? auth.sub, (auth.name as string | undefined) ?? auth.email ?? '')
}

declare module 'hono' {
  interface ContextVariableMap {
    user: User
  }
}

export const requireUser: MiddlewareHandler = async (c, next) => {
  const user = await currentUser(c)
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  c.set('user', user)
  await next()
}
