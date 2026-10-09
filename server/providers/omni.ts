import fs from 'node:fs'
import { compileOmniPrompt, type MediaLayout } from '../../shared/promptCompiler'
import type { Generation } from '../../shared/types'
import { assetBase64, ensureGeminiFile, INLINE_MAX_BYTES } from '../assets'
import { ai, apiKey, sleep } from '../genai'
import { findAsset, findGeneration } from '../store'

type CreateParams = Parameters<ReturnType<typeof ai>['interactions']['create']>[0]
type Interaction = Extract<Awaited<ReturnType<ReturnType<typeof ai>['interactions']['get']>>, { id: string }>

const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'incomplete', 'budget_exceeded', 'requires_action'])
const SYNC_TIMEOUT_MS = 20 * 60 * 1000
const POLL_MS = 5000

/** Flipped to false the first time the API refuses background mode (or reading it back) for Omni. */
let backgroundSupported = true

const MULTI_AUTH = /Multiple authentication credentials/i

/**
 * Background mode needs GET /interactions/{id}, which Google rejects for the newer "AQ." API keys
 * ("Multiple authentication credentials received", even with a single header). Those keys - or
 * OMNI_BACKGROUND=off - run Omni synchronously: create() blocks until the video is in the response.
 */
function useBackground(): boolean {
  return backgroundSupported && process.env.OMNI_BACKGROUND !== 'off' && !apiKey()?.startsWith('AQ.')
}

export function layoutOf(gen: Generation): MediaLayout {
  return {
    hasFirst: !!gen.refs.firstFrame,
    hasLast: !!gen.refs.lastFrame,
    imageRefs: gen.refs.images.length,
    videoRefs: gen.refs.videos.length,
  }
}

export function compileFor(gen: Generation, prompt: string): string {
  return compileOmniPrompt(prompt, layoutOf(gen), {
    mode: gen.mode,
    durationHint: gen.mode === 'create' ? gen.settings.duration : 0,
  })
}

async function buildInput(gen: Generation, text: string) {
  const parts: unknown[] = []
  const imageIds = [gen.refs.firstFrame, gen.refs.lastFrame, ...gen.refs.images].filter(Boolean) as string[]
  for (const id of imageIds) {
    const a = findAsset(id)
    if (!a) throw new Error(`Reference image ${id} is missing from the library`)
    if (a.bytes <= INLINE_MAX_BYTES) parts.push({ type: 'image', data: await assetBase64(a), mime_type: a.mime })
    else {
      const f = await ensureGeminiFile(a)
      parts.push({ type: 'image', uri: f.uri, mime_type: f.mime })
    }
  }
  for (const id of gen.refs.videos) {
    const a = findAsset(id)
    if (!a) throw new Error(`Reference video ${id} is missing from the library`)
    const f = await ensureGeminiFile(a)
    parts.push({ type: 'video', uri: f.uri, mime_type: f.mime })
  }
  if (!parts.length) return text
  parts.push({ type: 'text', text })
  return parts as CreateParams['input']
}

/** Starts the interaction. Returns the id to poll, or the finished interaction when it ran synchronously. */
export async function startOmni(
  gen: Generation,
  onPhase: (p: string) => Promise<void>,
): Promise<{ interactionId: string; interaction?: Interaction; sync: boolean }> {
  await onPhase(gen.refs.videos.length ? 'uploading refs' : 'sending')
  const input = await buildInput(gen, gen.sentPrompt ?? gen.prompt)
  const parent = gen.parentId ? findGeneration(gen.parentId) : undefined
  const s = gen.settings
  const big = s.resolution === '1080p' || s.resolution === '4k'

  const params = {
    model: gen.model,
    input,
    store: true,
    ...(parent?.provider.interactionId ? { previous_interaction_id: parent.provider.interactionId } : {}),
    response_format: {
      type: 'video',
      resolution: s.resolution,
      ...(gen.mode === 'create' ? { aspect_ratio: s.aspectRatio } : {}),
      ...(big ? { delivery: 'uri' } : {}),
    },
  } as CreateParams

  if (useBackground()) {
    try {
      const it = (await ai().interactions.create({ ...params, background: true } as CreateParams)) as Interaction
      return { interactionId: it.id, interaction: TERMINAL.has(it.status) ? it : undefined, sync: false }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e)
      if (!/background/i.test(msg)) throw e
      console.warn('[omni] background mode refused, falling back to synchronous calls:', msg.slice(0, 200))
      backgroundSupported = false
    }
  }
  await onPhase('generating')
  const it = (await ai().interactions.create(params, { timeout: SYNC_TIMEOUT_MS, maxRetries: 0 })) as Interaction
  return { interactionId: it.id, interaction: it, sync: true }
}

export async function pollOmni(id: string, alive: () => boolean): Promise<Interaction> {
  for (;;) {
    if (!alive()) throw new Error('cancelled')
    let it: Interaction
    try {
      it = (await ai().interactions.get(id)) as Interaction
    } catch (e) {
      if (!MULTI_AUTH.test(String((e as Error)?.message))) throw e
      backgroundSupported = false
      throw new Error(
        'Google cannot read back background interactions with this API key ("AQ." keys hit a known Google bug). ' +
          'Omni now runs synchronously - press Retry. An "AIza…" key from AI Studio avoids this.',
      )
    }
    if (TERMINAL.has(it.status)) return it
    await sleep(POLL_MS)
  }
}

interface VideoOut {
  data?: string
  uri?: string
  mime_type?: string
}

/** Video from `output_video` (SDK) or from the last model_output step (raw REST shape). */
export function extractVideo(it: { status?: string; output_video?: VideoOut; steps?: unknown[]; output_text?: string; errors?: unknown[] }): VideoOut {
  if (it.output_video?.data || it.output_video?.uri) return it.output_video
  const texts: string[] = []
  const steps = (it.steps ?? []) as { type?: string; content?: { type?: string; data?: string; uri?: string; mime_type?: string; text?: string }[]; error?: { message?: string } }[]
  for (const step of [...steps].reverse()) {
    if (step.type !== 'model_output') continue
    for (const c of step.content ?? []) {
      if (c.type === 'video' && (c.data || c.uri)) return { data: c.data, uri: c.uri, mime_type: c.mime_type }
      if (c.type === 'text' && c.text) texts.push(c.text)
    }
    if (step.error?.message) texts.push(step.error.message)
  }
  if (it.output_text) texts.push(it.output_text)
  for (const e of it.errors ?? []) texts.push(JSON.stringify(e))
  const reason = texts.join(' ').trim()
  throw new Error(
    it.status && it.status !== 'completed'
      ? `Interaction ${it.status}${reason ? `: ${reason}` : ''}`
      : `No video in the response${reason ? `: ${reason}` : ' (likely blocked by a safety filter)'}`,
  )
}

export async function writeVideo(v: VideoOut, out: string) {
  if (v.data) {
    await fs.promises.writeFile(out, Buffer.from(v.data, 'base64'))
    return
  }
  const id = /files\/([^/:?]+)/.exec(v.uri ?? '')?.[1]
  if (!id) throw new Error(`Unexpected video uri: ${v.uri}`)
  const deadline = Date.now() + 10 * 60 * 1000
  for (;;) {
    const f = await ai().files.get({ name: `files/${id}` })
    const state = String(f.state)
    if (state === 'ACTIVE') break
    if (state === 'FAILED') throw new Error('Google failed to finalise the video file')
    if (Date.now() > deadline) throw new Error('Video file still processing after 10 min')
    await sleep(POLL_MS)
  }
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/files/${id}:download?alt=media`, {
    headers: { 'x-goog-api-key': apiKey()! },
  })
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`)
  await fs.promises.writeFile(out, Buffer.from(await res.arrayBuffer()))
}

/** USD from reported usage: input $1.50/M, video output $17.50/M, other output (thoughts/text) $9/M. */
export function costFromUsage(usage: Interaction['usage']): number | undefined {
  if (!usage) return undefined
  const out = usage.output_tokens_by_modality ?? []
  const video = out.filter((m) => m.modality === 'video').reduce((n, m) => n + (m.tokens ?? 0), 0)
  const totalOut = (usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0)
  if (!video && !totalOut) return undefined
  const other = Math.max(0, totalOut - video)
  return ((usage.total_input_tokens ?? 0) * 1.5 + video * 17.5 + other * 9) / 1_000_000
}
