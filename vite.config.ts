import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

try { process.loadEnvFile('.env') } catch {}
const api = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [react()],
  build: { outDir: 'dist/client' },
  server: {
    proxy: Object.fromEntries(
      ['/rpc', '/login', '/logout', '/callback', '/attachments'].map((p) => [p, api]),
    ),
  },
})
