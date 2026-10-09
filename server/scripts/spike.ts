/**
 * Phase 0 spike (~$0.35): one 360p Omni text-to-video, to confirm what the docs leave open.
 *   npm run spike            -> background mode + polling, dumps the response shape
 *   npm run spike -- --duration=4s   -> also sends response_format.duration (SDK field, undocumented format)
 * Writes data/spike.mp4 and data/spike-response.json (base64 truncated).
 */
import fs from 'node:fs'
import path from 'node:path'
import { ROOT, DATA } from '../store'

try {
  process.loadEnvFile(path.join(ROOT, '.env.local'))
} catch {
  /* env may come from the shell */
}
const { ai, sleep } = await import('../genai')
const { extractVideo, writeVideo, costFromUsage } = await import('../providers/omni')

const duration = process.argv.find((a) => a.startsWith('--duration='))?.split('=')[1]
const started = Date.now()

const params = {
  model: 'gemini-omni-1.1-flash',
  input: 'A paper boat drifting down a rain gutter, single continuous shot, rain ambience, no dialogue.',
  store: true,
  background: true,
  response_format: { type: 'video', resolution: '360p', aspect_ratio: '16:9', ...(duration ? { duration } : {}) },
} as Parameters<ReturnType<typeof ai>['interactions']['create']>[0]

let it
try {
  it = (await ai().interactions.create(params)) as { id: string; status: string }
  console.log('background accepted:', it.id, it.status)
} catch (e) {
  console.log('background create failed:', (e as Error).message)
  console.log('retrying synchronously…')
  it = (await ai().interactions.create({ ...params, background: false } as typeof params, { timeout: 20 * 60_000, maxRetries: 0 })) as {
    id: string
    status: string
  }
}

while (!['completed', 'failed', 'cancelled', 'incomplete', 'budget_exceeded'].includes(it.status)) {
  await sleep(5000)
  it = (await ai().interactions.get(it.id)) as typeof it
  process.stdout.write(`\r${it.status} ${Math.round((Date.now() - started) / 1000)}s   `)
}
console.log()

const dump = JSON.stringify(it, (_k, v) => (typeof v === 'string' && v.length > 200 ? `${v.slice(0, 60)}…(${v.length} chars)` : v), 2)
fs.writeFileSync(path.join(DATA, 'spike-response.json'), dump)
console.log(dump.slice(0, 3000))

const full = it as Parameters<typeof extractVideo>[0] & { usage?: Parameters<typeof costFromUsage>[0] }
const video = extractVideo(full)
await writeVideo(video, path.join(DATA, 'spike.mp4'))
console.log('saved data/spike.mp4 in', Math.round((Date.now() - started) / 1000), 's; cost from usage:', costFromUsage(full.usage))
