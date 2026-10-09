import fs from 'node:fs'
import { compileMusicPrompt, readableLyrics } from '../../shared/promptCompiler'
import { getModel } from '../../shared/models'
import type { Generation } from '../../shared/types'
import { assetBase64, ensureGeminiFile, INLINE_MAX_BYTES } from '../assets'
import { ai, apiKey } from '../genai'
import { findAsset } from '../store'

type CreateParams = Parameters<ReturnType<typeof ai>['interactions']['create']>[0]
type Interaction = Extract<Awaited<ReturnType<ReturnType<typeof ai>['interactions']['get']>>, { id: string }>

/** A full song can take a while; one synchronous create() (GET polling is broken for "AQ." keys). */
const TIMEOUT_MS = 10 * 60 * 1000

export function compileFor(gen: Generation, prompt: string): string {
  return compileMusicPrompt(prompt, gen.settings, getModel(gen.model).durations.length === 1)
}

/** Music from text (+ inspiration images) - Lyria 3 Clip or Lyria 3.5. Output is MP3. */
export async function generateMusic(gen: Generation): Promise<Interaction> {
  const parts: unknown[] = []
  for (const id of gen.refs.images) {
    const a = findAsset(id)
    if (!a) throw new Error(`Image ${id} is missing from the library`)
    if (a.bytes <= INLINE_MAX_BYTES) parts.push({ type: 'image', data: await assetBase64(a), mime_type: a.mime })
    else {
      const f = await ensureGeminiFile(a)
      parts.push({ type: 'image', uri: f.uri, mime_type: f.mime })
    }
  }
  const text = gen.sentPrompt ?? gen.prompt
  const params = {
    model: gen.model,
    input: parts.length ? [{ type: 'text', text }, ...parts] : text,
    // no response_format: MP3 is the default, and the docs only describe it for Lyria 3.5 (to ask for WAV)
  } as CreateParams
  return (await ai().interactions.create(params, { timeout: TIMEOUT_MS, maxRetries: 0 })) as Interaction
}

interface AudioOut {
  data?: string
  uri?: string
  mime_type?: string
}

type Step = { type?: string; content?: { type?: string; data?: string; uri?: string; mime_type?: string; text?: string }[] }

/** The song (`output_audio`, else the last audio block) and the lyrics / structure text that comes with it. */
export function extractMusic(it: { output_audio?: AudioOut; output_text?: string; steps?: unknown[] }): { audio: AudioOut; lyrics?: string } {
  const steps = (it.steps ?? []) as Step[]
  const texts: string[] = []
  let audio: AudioOut | undefined = it.output_audio?.data || it.output_audio?.uri ? it.output_audio : undefined
  for (const step of steps) {
    if (step.type !== 'model_output') continue
    for (const c of step.content ?? []) {
      if (c.type === 'audio' && (c.data || c.uri) && !it.output_audio) audio = { data: c.data, uri: c.uri, mime_type: c.mime_type }
      if (c.type === 'text' && c.text) texts.push(c.text)
    }
  }
  const raw = (texts.join('\n\n') || it.output_text || '').trim()
  // an instrumental comes back with section markers only ([[A0]]...) - not lyrics
  const lyrics = readableLyrics(raw)
  if (!audio) throw new Error(`No music in the response${raw ? `: ${raw.slice(0, 400)}` : ' (likely blocked by a safety filter)'}`)
  return { audio, lyrics }
}

export function extensionFor(mime?: string): string {
  return mime?.includes('wav') ? '.wav' : mime?.includes('ogg') ? '.ogg' : '.mp3'
}

export async function writeAudio(a: AudioOut, out: string) {
  if (a.data) return fs.promises.writeFile(out, Buffer.from(a.data, 'base64'))
  if (!a.uri) throw new Error('Empty audio in the response')
  const res = await fetch(a.uri, { headers: { 'x-goog-api-key': apiKey() ?? '' } })
  if (!res.ok) throw new Error(`Downloading the music failed: HTTP ${res.status}`)
  await fs.promises.writeFile(out, Buffer.from(await res.arrayBuffer()))
}
