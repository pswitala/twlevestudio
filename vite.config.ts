/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  // HOST / PORT come from .env.local, same as the API server reads them.
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const host = env.HOST || '127.0.0.1'
  const api = `http://${host}:${Number(env.PORT) || 5181}`
  return {
    plugins: [react(), tailwindcss()],
    server: {
      host,
      port: 5180,
      strictPort: true,
      proxy: { '/api': api, '/files': api },
    },
    test: { include: ['tests/**/*.test.ts'] },
  }
})
