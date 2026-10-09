import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseScript, type Voice, type VoiceSnapshot } from '../../shared/voices'
import type { Generation } from '../../shared/types'
import { ai } from '../genai'
import { concatAudio } from '../media'
import { DIRS } from '../store'

type CreateParams = Parameters<ReturnType<typeof ai>['interactions']['create']>[0]
type Interaction = Extract<Awaited<ReturnType<ReturnType<typeof ai>['interactions']['get']>>, { id: string }>
type VoiceCreate = Parameters<ReturnType<typeof ai>['voices']['create']>[0]

const TIMEOUT_MS = 3 * 60 * 1000

/**
 * Voice design: description -> persistent `voice_...` (1-year TTL from last use, 200 per Google project)
 * plus a WAV preview, saved to data/voices.
 */
export async function designVoice(v: Voice): Promise<{ googleVoiceId: string; sampleFile?: string }> {
  const created = await ai().voices.create({
    store: true,
    voice: {
      model: v.model,
      type: 'prompted',
      display_name: v.name.slice(0, 60),
      language_code: v.language,
      ...(v.gender ? { gender: v.gender } : {}),
      prompted: { input: v.description },
    },
  } as VoiceCreate)
  if (!created.id) throw new Error('Voice design returned no voice id')
  let sampleFile: string | undefined
  const data = (created as { sample_audio?: { data?: string } }).sample_audio?.data
  if (data) {
    sampleFile = `${v.id}-${Date.now()}.wav`
    await fs.promises.writeFile(path.join(DIRS.voices, sampleFile), Buffer.from(data, 'base64'))
  }
  return { googleVoiceId: created.id, sampleFile }
}

/** Best effort - a voice left on Google's side simply expires after a year unused. */
export async function deleteGoogleVoice(id: string) {
  try {
    await ai().voices.delete(id)
  } catch (e) {
    console.warn('[voices] could not delete', id, (e as Error).message)
  }
}

async function speakTurn(model: string, voice: string, text: string, style?: string): Promise<{ wav: Buffer; it: Interaction }> {
  const params = {
    model,
    input: [
      {
        type: 'user_input',
        content: [{ type: 'text', text, ...(style ? { annotations: [{ type: 'speech_metadata', style }] } : {}) }],
      },
    ],
    response_format: { type: 'audio' },
    generation_config: { speech_config: [{ voice }] },
  } as unknown as CreateParams
  const it = (await ai().interactions.create(params, { timeout: TIMEOUT_MS, maxRetries: 1 })) as Interaction
  const data = it.output_audio?.data ?? findAudio(it)
  if (!data) throw new Error(`No audio for "${text.slice(0, 40)}…" - ${it.output_text ?? 'the request may have been blocked'}`)
  return { wav: Buffer.from(data, 'base64'), it }
}

function findAudio(it: Interaction): string | undefined {
  for (const step of [...((it.steps ?? []) as { type?: string; content?: { type?: string; data?: string }[] }[])].reverse()) {
    if (step.type !== 'model_output') continue
    const a = step.content?.find((c) => c.type === 'audio' && c.data)
    if (a) return a.data
  }
  return undefined
}

/**
 * Speaks the script turn by turn (custom voices cannot share one multi-speaker request) and joins the
 * turns into one .m4a. Returns the total cost from reported usage when Google sends it.
 */
export async function synthesize(gen: Generation, out: string, onTurn: (i: number, n: number) => Promise<void>): Promise<number | undefined> {
  const voices = gen.voices ?? []
  const turns = parseScript(gen.prompt, gen.settings.voice ?? 1)
  if (!turns.length) throw new Error('The script is empty')
  const tmpDir = path.join(DIRS.tmp, crypto.randomUUID())
  await fs.promises.mkdir(tmpDir, { recursive: true })
  let usd = 0
  let reported = false
  try {
    const files: string[] = []
    for (const [i, t] of turns.entries()) {
      await onTurn(i + 1, turns.length)
      const v = voices.find((x) => x.index === t.voice)
      if (!v?.voice) throw new Error(`@voice${t.voice} has no speaking voice - design it or pick a prebuilt voice`)
      const { wav, it } = await speakTurn(gen.model, v.voice, t.text, t.style)
      const f = path.join(tmpDir, `${String(i).padStart(3, '0')}.wav`)
      await fs.promises.writeFile(f, wav)
      files.push(f)
      const c = costFromUsage(gen.model, it.usage)
      if (c !== undefined) {
        usd += c
        reported = true
      }
    }
    await concatAudio(files, out)
    return reported ? usd : undefined
  } finally {
    await fs.promises.rm(tmpDir, { recursive: true, force: true })
  }
}

export function costFromUsage(model: string, usage: Interaction['usage']): number | undefined {
  if (!usage?.total_output_tokens) return undefined
  const out = model === 'gemini-3.8-flash-lite-tts' ? 6 : 9
  return ((usage.total_input_tokens ?? 0) * 0.5 + usage.total_output_tokens * out) / 1_000_000
}

export type { VoiceSnapshot }
