import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { getModel, type Resolution } from '../../shared/models'
import { compileOpenRouterImagePrompt, compileVeoPrompt } from '../../shared/promptCompiler'
import type { Generation } from '../../shared/types'
import { assetBase64, assetPath } from '../assets'
import { sleep } from '../genai'
import { fitSize, scaleImage } from '../media'
import { DIRS, findAsset, findGeneration, outputDir } from '../store'

/**
 * OpenRouter video generation (docs: openrouter.ai/docs/guides/overview/multimodal/video-generation):
 * POST /videos -> job id, GET /videos/{id} until a terminal status, then GET /videos/{id}/content.
 * The job id is stored on the generation, so a restart resumes polling like Veo.
 */
const BASE = 'https://openrouter.ai/api/v1'
// OpenRouter suggests ~30 s; jobs take 30 s to several minutes
const POLL_MS = 15_000
const FAILED = new Set(['failed', 'cancelled', 'expired'])

export function openRouterKey(): string | undefined {
  return process.env.OPENROUTER_API_KEY || undefined
}

function headers(): Record<string, string> {
  const key = openRouterKey()
  if (!key) throw new Error('OPENROUTER_API_KEY is not set - add it to twelvestudio/.env.local and restart.')
  return { Authorization: `Bearer ${key}`, 'X-Title': 'twelvestudio' }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string>) } })
  const text = await res.text()
  if (!res.ok) {
    let msg = text
    try {
      const body = JSON.parse(text) as { error?: { message?: string } | string }
      msg = (typeof body.error === 'string' ? body.error : body.error?.message) ?? text
    } catch {
      /* not JSON */
    }
    throw Object.assign(new Error(`OpenRouter: ${explainError(msg || `HTTP ${res.status}`)}`), { status: res.status })
  }
  return JSON.parse(text) as T
}

/**
 * The provider's own error often arrives wrapped ("HTTP 400: {"error":{"code":...,"message":...}}"): unwrap it,
 * and say what to do about the refusals people actually hit.
 */
export function explainError(msg: string): string {
  let text = msg
  const start = msg.indexOf('{')
  if (start >= 0) {
    try {
      const e = (JSON.parse(msg.slice(start)) as { error?: { code?: string; message?: string } }).error
      if (e?.message) text = e.code ? `${e.message} [${e.code}]` : e.message
    } catch {
      /* not JSON */
    }
  }
  if (/PrivacyInformation|real person/i.test(text)) {
    return (
      'Refused: an input image may show a real person, and ByteDance (Seedream / Seedance) does not accept those. ' +
      `Use pictures without real people, or Nano Banana / GPT Image / FLUX / Kling for this one. (${text})`
    )
  }
  return text
}

export function compileFor(prompt: string): string {
  return compileVeoPrompt(prompt)
}

export function compileImageFor(gen: Generation, prompt: string): string {
  return compileOpenRouterImagePrompt(prompt, { mode: gen.mode, imageRefs: gen.refs.images.length })
}

/** OpenRouter writes 2K / 4K with a capital K; the rest match. */
export function resolutionParam(r: Resolution): string {
  return r === '2k' ? '2K' : r === '4k' ? '4K' : r
}

/**
 * Images sent as refs / frames / the photo being edited are capped: providers refuse big inputs (Seedream: 36 MP -
 * "Image exceeds the maximum allowed total pixels"), and no model gains anything from more than 4K.
 */
export const MAX_INPUT_SIDE = 4096
export const MAX_INPUT_PIXELS = 4096 * 4096

/** A file as a data URL; an image larger than the cap goes as a scaled JPEG copy (the library file is untouched). */
async function imageDataUrl(file: string, width?: number, height?: number): Promise<string | undefined> {
  const fit = width && height ? fitSize(width, height, MAX_INPUT_SIDE, MAX_INPUT_PIXELS) : undefined
  if (!fit) return undefined
  const tmp = path.join(DIRS.tmp, `${crypto.randomUUID()}.jpg`)
  try {
    await scaleImage(file, tmp, fit.w, fit.h)
    return `data:image/jpeg;base64,${(await fs.promises.readFile(tmp)).toString('base64')}`
  } finally {
    await fs.promises.rm(tmp, { force: true })
  }
}

/** Library files travel inline as data URLs - the server is local, there is no public URL to hand over. */
async function dataUrl(id: string, what: string): Promise<string> {
  const a = findAsset(id)
  if (!a) throw new Error(`${what} ${id} is missing from the library`)
  if (a.kind === 'image') {
    const scaled = await imageDataUrl(assetPath(a), a.width, a.height)
    if (scaled) return scaled
  }
  return `data:${a.mime};base64,${await assetBase64(a)}`
}

export async function buildRequest(gen: Generation): Promise<Record<string, unknown>> {
  const m = getModel(gen.model)
  const s = gen.settings
  const body: Record<string, unknown> = {
    model: gen.model,
    prompt: gen.sentPrompt ?? gen.prompt,
    aspect_ratio: s.aspectRatio,
    duration: s.duration,
    resolution: resolutionParam(s.resolution),
  }
  // only models with optional sound get the switch (and the cheaper silent rate); the rest are stripped after download
  if (m.audio === true) body.generate_audio = s.audio
  const frames: unknown[] = []
  if (gen.refs.firstFrame) {
    frames.push({ type: 'image_url', image_url: { url: await dataUrl(gen.refs.firstFrame, 'Start frame') }, frame_type: 'first_frame' })
  }
  if (gen.refs.lastFrame) {
    frames.push({ type: 'image_url', image_url: { url: await dataUrl(gen.refs.lastFrame, 'End frame') }, frame_type: 'last_frame' })
  }
  if (frames.length) body.frame_images = frames
  const refs: unknown[] = []
  for (const id of gen.refs.images) refs.push({ type: 'image_url', image_url: { url: await dataUrl(id, 'Reference image') } })
  for (const id of gen.refs.videos) refs.push({ type: 'video_url', video_url: { url: await dataUrl(id, 'Reference video') } })
  if (refs.length) body.input_references = refs
  return body
}

interface Job {
  id: string
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled' | 'expired'
  error?: string
  unsigned_urls?: string[]
  usage?: { cost?: number | null }
}

export async function startOpenRouter(gen: Generation): Promise<string> {
  const job = await call<Job>('/videos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(await buildRequest(gen)) })
  if (!job.id) throw new Error('OpenRouter returned no job id')
  return job.id
}

export async function pollOpenRouter(id: string, alive: () => boolean): Promise<Job> {
  for (;;) {
    if (!alive()) throw new Error('cancelled')
    const job = await call<Job>(`/videos/${encodeURIComponent(id)}`)
    if (job.status === 'completed') return job
    if (FAILED.has(job.status)) throw new Error(`OpenRouter job ${job.status}${job.error ? `: ${explainError(job.error)}` : ''}`)
    await sleep(POLL_MS)
  }
}

export async function downloadOpenRouter(job: Job, out: string) {
  // the content endpoint proxies the provider's file; an unsigned URL elsewhere gets no key (it would leak it)
  const url = job.unsigned_urls?.[0] ?? `${BASE}/videos/${encodeURIComponent(job.id)}/content?index=0`
  const ours = new URL(url).hostname === 'openrouter.ai'
  const res = await fetch(url, { headers: ours ? headers() : {}, redirect: 'follow' })
  if (!res.ok) throw new Error(`OpenRouter download failed: HTTP ${res.status}`)
  await fs.promises.writeFile(out, Buffer.from(await res.arrayBuffer()))
}

/** USD OpenRouter charged for the job, when it says. */
export function costOf(job: Job): number | undefined {
  return typeof job.usage?.cost === 'number' ? job.usage.cost : undefined
}

// ---------- photos: POST /images answers with the image (seconds), nothing to poll ----------

const IMAGE_TIMEOUT_MS = 5 * 60 * 1000
const MIME_BY_EXT: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }

/** The finished photo an Edit changes, as a data URL. */
async function parentImage(gen: Generation): Promise<string> {
  const parent = gen.parentId ? findGeneration(gen.parentId) : undefined
  if (!parent?.file) throw new Error('The photo to edit is missing')
  const file = path.join(outputDir(parent), parent.file)
  const mime = MIME_BY_EXT[path.extname(file).toLowerCase()] ?? 'image/png'
  const scaled = await imageDataUrl(file, parent.width, parent.height)
  if (scaled) return scaled
  return `data:${mime};base64,${(await fs.promises.readFile(file)).toString('base64')}`
}

export async function buildImageRequest(gen: Generation): Promise<Record<string, unknown>> {
  const m = getModel(gen.model)
  const body: Record<string, unknown> = {
    model: gen.model,
    prompt: gen.sentPrompt ?? gen.prompt,
    aspect_ratio: gen.settings.aspectRatio,
    n: 1,
  }
  if (m.imageParams?.resolution && gen.settings.imageSize) body.resolution = gen.settings.imageSize
  if (m.imageParams?.quality) body.quality = m.imageParams.quality
  const refs: unknown[] = []
  for (const id of gen.refs.images) refs.push({ type: 'image_url', image_url: { url: await dataUrl(id, 'Reference image') } })
  // after the refs: compileOpenRouterImagePrompt calls it "image N+1 (the last image)"
  if (gen.mode === 'edit') refs.push({ type: 'image_url', image_url: { url: await parentImage(gen) } })
  if (refs.length) body.input_references = refs
  return body
}

interface ImageResponse {
  data?: { b64_json?: string; url?: string; media_type?: string }[]
  usage?: { cost?: number | null }
}

export async function generateImage(gen: Generation): Promise<{ data: string; mime_type: string; costUsd?: number }> {
  const r = await call<ImageResponse>('/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(await buildImageRequest(gen)),
    signal: AbortSignal.timeout(IMAGE_TIMEOUT_MS),
  })
  const img = r.data?.[0]
  if (!img?.b64_json && !img?.url) throw new Error('OpenRouter returned no image (likely blocked by a safety filter)')
  let data = img.b64_json
  let mime = img.media_type
  if (!data) {
    const res = await fetch(img.url!)
    if (!res.ok) throw new Error(`OpenRouter image download failed: HTTP ${res.status}`)
    data = Buffer.from(await res.arrayBuffer()).toString('base64')
    mime ??= res.headers.get('content-type') ?? undefined
  }
  return { data, mime_type: mime ?? 'image/png', costUsd: typeof r.usage?.cost === 'number' ? r.usage.cost : undefined }
}
