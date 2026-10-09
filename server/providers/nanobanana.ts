import fs from 'node:fs'
import { compileImagePrompt } from '../../shared/promptCompiler'
import { getModel } from '../../shared/models'
import type { Generation } from '../../shared/types'
import { assetBase64, ensureGeminiFile, INLINE_MAX_BYTES } from '../assets'
import { ai } from '../genai'
import { findAsset, findGeneration } from '../store'

type CreateParams = Parameters<ReturnType<typeof ai>['interactions']['create']>[0]
type Interaction = Extract<Awaited<ReturnType<ReturnType<typeof ai>['interactions']['get']>>, { id: string }>

const TIMEOUT_MS = 5 * 60 * 1000

export function compileFor(prompt: string): string {
  return compileImagePrompt(prompt)
}

/**
 * Photo generation is fast, so it always runs synchronously: one create() returns the image.
 * (That also sidesteps the GET /interactions bug for "AQ." keys.)
 */
export async function generateImage(gen: Generation): Promise<Interaction> {
  const parts: unknown[] = []
  for (const id of gen.refs.images) {
    const a = findAsset(id)
    if (!a) throw new Error(`Reference image ${id} is missing from the library`)
    if (a.bytes <= INLINE_MAX_BYTES) parts.push({ type: 'image', data: await assetBase64(a), mime_type: a.mime })
    else {
      const f = await ensureGeminiFile(a)
      parts.push({ type: 'image', uri: f.uri, mime_type: f.mime })
    }
  }
  const text = gen.sentPrompt ?? gen.prompt
  const parent = gen.parentId ? findGeneration(gen.parentId) : undefined
  const sizes = getModel(gen.model).imageSizes ?? []

  const params = {
    model: gen.model,
    input: parts.length ? [...parts, { type: 'text', text }] : text,
    store: true,
    ...(parent?.provider.interactionId ? { previous_interaction_id: parent.provider.interactionId } : {}),
    response_format: {
      type: 'image',
      aspect_ratio: gen.settings.aspectRatio,
      // Lite only makes 1K and takes no size
      ...(sizes.length > 1 && gen.settings.imageSize ? { image_size: gen.settings.imageSize } : {}),
    },
  } as CreateParams
  return (await ai().interactions.create(params, { timeout: TIMEOUT_MS, maxRetries: 0 })) as Interaction
}

interface ImageOut {
  data?: string
  uri?: string
  mime_type?: string
}

/** The final image: `output_image`, else the last image of the last model_output step (thought images are skipped). */
export function extractImage(it: { status?: string; output_image?: ImageOut; steps?: unknown[]; output_text?: string }): ImageOut {
  if (it.output_image?.data || it.output_image?.uri) return it.output_image
  const texts: string[] = []
  const steps = (it.steps ?? []) as { type?: string; content?: { type?: string; data?: string; uri?: string; mime_type?: string; text?: string }[] }[]
  for (const step of [...steps].reverse()) {
    if (step.type !== 'model_output') continue
    for (const c of [...(step.content ?? [])].reverse()) {
      if (c.type === 'image' && (c.data || c.uri)) return { data: c.data, uri: c.uri, mime_type: c.mime_type }
      if (c.type === 'text' && c.text) texts.push(c.text)
    }
  }
  if (it.output_text) texts.push(it.output_text)
  const reason = texts.join(' ').trim()
  throw new Error(`No image in the response${reason ? `: ${reason.slice(0, 400)}` : ' (likely blocked by a safety filter)'}`)
}

export function extensionFor(mime?: string): string {
  return mime === 'image/jpeg' ? '.jpg' : mime === 'image/webp' ? '.webp' : '.png'
}

export async function writeImage(img: ImageOut, out: string) {
  if (!img.data) throw new Error('The image came back as a URI - not supported yet')
  await fs.promises.writeFile(out, Buffer.from(img.data, 'base64'))
}

/** USD from usage: image tokens at the model's image rate, the rest (text + thinking) at the text rate. */
export function costFromUsage(modelId: string, usage: Interaction['usage']): number | undefined {
  if (!usage) return undefined
  const rates: Record<string, { input: number; image: number; text: number }> = {
    'gemini-3.1-flash-image': { input: 0.5, image: 60, text: 3 },
    'gemini-3-pro-image': { input: 2, image: 120, text: 12 },
    'gemini-3.1-flash-lite-image': { input: 0.25, image: 30, text: 1.5 },
  }
  const r = rates[modelId]
  if (!r) return undefined
  const image = (usage.output_tokens_by_modality ?? []).filter((m) => m.modality === 'image').reduce((n, m) => n + (m.tokens ?? 0), 0)
  const totalOut = (usage.total_output_tokens ?? 0) + (usage.total_thought_tokens ?? 0)
  if (!image && !totalOut) return undefined
  return ((usage.total_input_tokens ?? 0) * r.input + image * r.image + Math.max(0, totalOut - image) * r.text) / 1_000_000
}
