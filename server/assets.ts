import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT_ID, type Asset, type AssetKind } from '../shared/types'
import { VIDEO_REF_MAX_SECONDS } from '../shared/models'
import { ai, sleep } from './genai'
import { probe, thumbnail, toM4a, toPng, trim, waveform } from './media'
import { DIRS, db, persist } from './store'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.webm', '.m4v', '.mkv', '.avi'])
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' }
export const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba', '.wma', '.aif', '.aiff', '.amr'])
/** formats kept as uploaded (every browser here plays them); the rest become .m4a */
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
}

function sha256File(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256')
    fs.createReadStream(file).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject)
  })
}

export interface IngestOptions {
  originalName: string
  mime: string
  source: Asset['source']
  trimStart?: number
  fromGenerationId?: string
  label?: string
  projectId?: string
}

/**
 * Takes a file already written to data/tmp and turns it into a library asset:
 * videos longer than the 3 s ref limit are cut, odd image formats become PNG,
 * identical content is stored once (sha256).
 */
export async function ingest(tmpFile: string, opts: IngestOptions): Promise<Asset> {
  let ext = path.extname(opts.originalName).toLowerCase()
  const kind: AssetKind =
    opts.mime.startsWith('audio/') || AUDIO_EXT.has(ext) ? 'audio' : opts.mime.startsWith('video/') || VIDEO_EXT.has(ext) ? 'video' : 'image'
  let work = tmpFile
  let mime = opts.mime
  let originalDurationS: number | undefined

  try {
    if (kind === 'audio') {
      // music / sound is kept whole - no 3 s cut, it is never sent to a model
      const p = await probe(work)
      if (!p.hasAudio) throw new Error(`${opts.originalName}: no audio in the file`)
      if (!AUDIO_MIME[ext]) {
        await toM4a(work, `${tmpFile}.m4a`)
        work = `${tmpFile}.m4a`
        ext = '.m4a'
      }
      mime = AUDIO_MIME[ext]
    } else if (kind === 'video') {
      const p = await probe(work)
      if (!p.hasVideo) throw new Error('The file has no video stream.')
      originalDurationS = p.durationS
      const cut = `${tmpFile}.trim.mp4`
      // Always re-encode: normalises codecs/containers and enforces the 3 s limit.
      await trim(work, opts.trimStart ?? 0, VIDEO_REF_MAX_SECONDS, cut)
      work = cut
      ext = '.mp4'
      mime = 'video/mp4'
    } else if (!IMAGE_MIME[ext]) {
      const png = `${tmpFile}.png`
      await toPng(work, png)
      work = png
      ext = '.png'
      mime = 'image/png'
    } else {
      mime = IMAGE_MIME[ext]
    }

    const sha256 = await sha256File(work)
    // identical file already in THIS project -> reuse it (another project's copy would stay invisible here)
    const existing = db.assets.find((a) => a.sha256 === sha256 && (a.projectId ?? DEFAULT_PROJECT_ID) === (opts.projectId ?? DEFAULT_PROJECT_ID))
    if (existing) return existing

    const id = crypto.randomUUID()
    const file = `${id}${ext}`
    await fs.promises.rename(work, path.join(DIRS.assets, file))
    const p = await probe(path.join(DIRS.assets, file))
    const thumb = `${id}.jpg`
    if (kind === 'audio') await waveform(path.join(DIRS.assets, file), path.join(DIRS.thumbs, thumb))
    else await thumbnail(path.join(DIRS.assets, file), path.join(DIRS.thumbs, thumb))
    const stat = await fs.promises.stat(path.join(DIRS.assets, file))

    const asset: Asset = {
      id,
      kind,
      sha256,
      file,
      thumb,
      mime,
      bytes: stat.size,
      width: p.width,
      height: p.height,
      durationS: kind === 'image' ? undefined : p.durationS,
      originalDurationS: kind === 'video' && originalDurationS && originalDurationS > VIDEO_REF_MAX_SECONDS + 0.05 ? originalDurationS : undefined,
      label: opts.label || path.basename(opts.originalName, path.extname(opts.originalName)) || kind,
      source: opts.source,
      projectId: opts.projectId ?? DEFAULT_PROJECT_ID,
      fromGenerationId: opts.fromGenerationId,
      createdAt: new Date().toISOString(),
    }
    db.assets.unshift(asset)
    await persist()
    return asset
  } finally {
    for (const f of [tmpFile, `${tmpFile}.trim.mp4`, `${tmpFile}.png`, `${tmpFile}.m4a`]) await fs.promises.rm(f, { force: true })
  }
}

/**
 * Copies a library file into another project as an independent asset (own file + thumbnail, so deleting
 * either copy never breaks the other). An identical file already in the target is returned instead.
 */
export async function copyAsset(a: Asset, projectId: string): Promise<{ asset: Asset; created: boolean }> {
  const there = db.assets.find((x) => x.sha256 === a.sha256 && (x.projectId ?? DEFAULT_PROJECT_ID) === projectId)
  if (there) return { asset: there, created: false }
  const id = crypto.randomUUID()
  const file = `${id}${path.extname(a.file)}`
  const thumb = `${id}.jpg`
  await fs.promises.copyFile(path.join(DIRS.assets, a.file), path.join(DIRS.assets, file))
  await fs.promises.copyFile(path.join(DIRS.thumbs, a.thumb), path.join(DIRS.thumbs, thumb))
  const copy: Asset = {
    ...a,
    id,
    file,
    thumb,
    projectId,
    tags: a.tags ? [...a.tags] : undefined,
    geminiFile: undefined,
    createdAt: new Date().toISOString(),
  }
  db.assets.unshift(copy)
  return { asset: copy, created: true }
}

export function assetPath(a: Asset): string {
  return path.join(DIRS.assets, a.file)
}

export async function assetBase64(a: Asset): Promise<string> {
  return (await fs.promises.readFile(assetPath(a))).toString('base64')
}

/** Inline images up to this size; larger ones go through the Files API. */
export const INLINE_MAX_BYTES = 3 * 1024 * 1024

/** Uploads to the Gemini Files API once and reuses the copy until it nears its 48 h expiry. */
export async function ensureGeminiFile(a: Asset): Promise<{ uri: string; mime: string }> {
  if (a.geminiFile && Date.parse(a.geminiFile.expiresAt) > Date.now() + 60 * 60 * 1000) {
    return { uri: a.geminiFile.uri, mime: a.mime }
  }
  let f = await ai().files.upload({ file: assetPath(a), config: { mimeType: a.mime, displayName: a.label } })
  const deadline = Date.now() + 5 * 60 * 1000
  while (String(f.state) === 'PROCESSING') {
    if (Date.now() > deadline) throw new Error(`Files API: ${a.label} still processing after 5 min`)
    await sleep(3000)
    f = await ai().files.get({ name: f.name! })
  }
  if (String(f.state) === 'FAILED' || !f.uri) throw new Error(`Files API could not process ${a.label}`)
  a.geminiFile = {
    name: f.name!,
    uri: f.uri,
    expiresAt: f.expirationTime ?? new Date(Date.now() + 47 * 3600 * 1000).toISOString(),
  }
  await persist()
  return { uri: f.uri, mime: a.mime }
}
