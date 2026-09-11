import path from 'node:path'
import { drizzle } from 'drizzle-orm/postgres-js'
import { migrate } from 'drizzle-orm/postgres-js/migrator'
import * as schema from './schema.js'

export const db = drizzle({ connection: { url: process.env.DATABASE_URL!, onnotice: () => {} }, schema })
export { schema }

// サーバーは常にプロジェクトルートから起動する前提 (Dockerfile の WORKDIR も同じ)
export const migrateDb = () => migrate(db, { migrationsFolder: path.resolve('drizzle') })
