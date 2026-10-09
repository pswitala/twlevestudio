import path from 'node:path'
import express from 'express'
import { ROOT, DATA } from './store'

try {
  process.loadEnvFile(path.join(ROOT, '.env.local'))
} catch {
  /* no .env.local yet - /api/config reports hasKey: false */
}

const { api } = await import('./routes')
const { resume } = await import('./jobs')
const { apiKey } = await import('./genai')
const { openRouterKey } = await import('./providers/openrouter')

const PORT = Number(process.env.PORT) || 5181
// HOST in .env.local: 127.0.0.1 (this machine only) or the workstation's LAN address
const HOST = process.env.HOST || '127.0.0.1'
const app = express()

app.use(express.json({ limit: '2mb' }))
app.use('/api', api)
// express.static answers Range requests, so the player can seek.
app.use('/files', express.static(DATA, { fallthrough: false, dotfiles: 'deny', index: false }))

if (process.argv.includes('--prod')) {
  const dist = path.join(ROOT, 'dist')
  app.use(express.static(dist))
  app.get(/^(?!\/api|\/files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
}

app.listen(PORT, HOST, () => {
  console.log(`twelvestudio server on http://${HOST}:${PORT}${apiKey() ? '' : '  (GEMINI_API_KEY missing!)'}${openRouterKey() ? '' : '  (no OPENROUTER_API_KEY - OpenRouter video models off)'}`)
  resume()
})
