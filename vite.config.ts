import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

try { process.loadEnvFile('.env') } catch {}
const api = `http://localhost:${process.env.PORT ?? 3000}`

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src/client', import.meta.url)) } },
  build: { outDir: 'dist/client' },
  server: {
    host: true, // Tailscale 越しに開くため
    allowedHosts: ['.ts.net'],
    port: 5174,
    strictPort: true,
    proxy: Object.fromEntries(
      ['/rpc', '/login', '/logout', '/callback', '/attachments'].map((p) => [p, api]),
    ),
  },
})
