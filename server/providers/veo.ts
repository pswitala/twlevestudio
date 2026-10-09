import fs from 'node:fs'
import { GenerateVideosOperation, type GenerateVideosParameters, type Image } from '@google/genai'
import { compileVeoPrompt } from '../../shared/promptCompiler'
import type { Generation } from '../../shared/types'
import { assetBase64 } from '../assets'
import { ai, apiKey, sleep } from '../genai'
import { findAsset, findGeneration } from '../store'

const POLL_MS = 8000

export function compileFor(prompt: string): string {
  return compileVeoPrompt(prompt)
}

async function image(id: string): Promise<Image> {
  const a = findAsset(id)
  if (!a) throw new Error(`Reference image ${id} is missing from the library`)
  return { imageBytes: await assetBase64(a), mimeType: a.mime }
}

export async function startVeo(gen: Generation): Promise<string> {
  const s = gen.settings
  const params: GenerateVideosParameters = {
    model: gen.model,
    prompt: gen.sentPrompt ?? gen.prompt,
    config: {
      numberOfVideos: 1,
      aspectRatio: s.aspectRatio,
      resolution: s.resolution,
      durationSeconds: s.duration,
    },
  }
  if (gen.mode === 'extend') {
    const parent = gen.parentId ? findGeneration(gen.parentId) : undefined
    if (!parent?.provider.veoVideoUri) throw new Error('The Veo video to extend is no longer available on Google’s side')
    params.video = { uri: parent.provider.veoVideoUri, mimeType: 'video/mp4' }
    delete params.config!.aspectRatio
  } else {
    if (gen.refs.firstFrame) params.image = await image(gen.refs.firstFrame)
    if (gen.refs.lastFrame) params.config!.lastFrame = await image(gen.refs.lastFrame)
    if (gen.refs.images.length) {
      params.config!.referenceImages = await Promise.all(
        gen.refs.images.map(async (id) => ({ image: await image(id), referenceType: 'asset' as never })),
      )
    }
  }
  // NEGATIVE always travels in the prompt text (STYLE/CAMERA/NEGATIVE sections). The negativePrompt
  // parameter is extra, and Veo refuses it for reference images and extension
  // ("Negative prompt is not supported in your use case") - so only send it for plain text/frame-to-video,
  // and drop it on that refusal for any other case Google adds.
  const negative = gen.directives?.negative
  if (negative && gen.mode !== 'extend' && !gen.refs.images.length) params.config!.negativePrompt = negative
  let op
  try {
    op = await ai().models.generateVideos(params)
  } catch (e) {
    if (!params.config?.negativePrompt || !/negative prompt is not supported/i.test(String((e as Error)?.message))) throw e
    delete params.config.negativePrompt
    op = await ai().models.generateVideos(params)
  }
  if (!op.name) throw new Error('Veo returned no operation name')
  return op.name
}

export interface VeoResult {
  uri: string
  video: NonNullable<NonNullable<GenerateVideosOperation['response']>['generatedVideos']>[number]['video']
}

export async function pollVeo(name: string, alive: () => boolean): Promise<VeoResult> {
  let op = new GenerateVideosOperation()
  op.name = name
  for (;;) {
    if (!alive()) throw new Error('cancelled')
    op = await ai().operations.getVideosOperation({ operation: op })
    if (op.done) break
    await sleep(POLL_MS)
  }
  if (op.error) throw new Error(`Veo: ${String((op.error as { message?: string }).message ?? JSON.stringify(op.error))}`)
  const video = op.response?.generatedVideos?.[0]?.video
  if (!video?.uri && !video?.videoBytes) {
    const reasons = op.response?.raiMediaFilteredReasons?.join(' ')
    throw new Error(reasons ? `Blocked by safety filter: ${reasons}` : 'Veo returned no video')
  }
  return { uri: video.uri ?? '', video }
}

export async function downloadVeo(r: VeoResult, out: string) {
  if (r.video?.videoBytes) {
    await fs.promises.writeFile(out, Buffer.from(r.video.videoBytes, 'base64'))
    return
  }
  const res = await fetch(r.uri, { headers: { 'x-goog-api-key': apiKey()! }, redirect: 'follow' })
  if (!res.ok) throw new Error(`Veo download failed: HTTP ${res.status}`)
  await fs.promises.writeFile(out, Buffer.from(await res.arrayBuffer()))
}
