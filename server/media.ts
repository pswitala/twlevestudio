import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import ffmpegPath from 'ffmpeg-static'
import ffprobe from 'ffprobe-static'

const run = promisify(execFile)
export const FFMPEG = ffmpegPath as unknown as string
const FFPROBE = ffprobe.path

export async function ffmpeg(args: string[]) {
  try {
    await run(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { maxBuffer: 16 * 1024 * 1024 })
  } catch (e) {
    const err = e as { stderr?: string; message: string }
    throw new Error(`ffmpeg failed: ${(err.stderr || err.message).trim().slice(0, 500)}`)
  }
}

export interface Probe {
  durationS?: number
  videoCodec?: string
  width?: number
  height?: number
  hasAudio: boolean
  hasVideo: boolean
}

export async function probe(file: string): Promise<Probe> {
  const { stdout } = await run(FFPROBE, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file])
  const j = JSON.parse(stdout) as {
    streams?: { codec_type: string; codec_name?: string; width?: number; height?: number; duration?: string; disposition?: { attached_pic?: number } }[]
    format?: { duration?: string }
  }
  // cover art in an mp3/m4a is a 'video' stream too - not a picture track
  const v = j.streams?.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic)
  const d = Number(j.format?.duration ?? v?.duration)
  return {
    durationS: Number.isFinite(d) ? d : undefined,
    videoCodec: v?.codec_name,
    width: v?.width,
    height: v?.height,
    hasAudio: !!j.streams?.some((s) => s.codec_type === 'audio'),
    hasVideo: !!v,
  }
}

/** Small JPEG for the gallery. Works for images and videos. */
export async function thumbnail(input: string, out: string, atS = 0) {
  const seek = atS > 0 ? ['-ss', String(atS)] : []
  await ffmpeg([...seek, '-i', input, '-frames:v', '1', '-vf', 'scale=640:-2', '-q:v', '4', out])
}

/** Size an image must be scaled to so it fits `maxSide` and `maxPixels` (even numbers), or undefined if it already fits. */
export function fitSize(w: number, h: number, maxSide: number, maxPixels: number): { w: number; h: number } | undefined {
  const k = Math.min(1, maxSide / Math.max(w, h), Math.sqrt(maxPixels / (w * h)))
  if (k >= 1) return undefined
  const even = (x: number) => Math.max(2, Math.floor((x * k) / 2) * 2)
  return { w: even(w), h: even(h) }
}

/** High-quality JPEG copy of an image at exactly w x h. */
export async function scaleImage(input: string, out: string, w: number, h: number) {
  await ffmpeg(['-i', input, '-vf', `scale=${w}:${h}:flags=lanczos`, '-frames:v', '1', '-q:v', '2', out])
}

/** Full-resolution PNG of the frame at `at` seconds, or the very last frame. */
export async function extractFrame(video: string, at: number | 'last', out: string) {
  if (at === 'last') {
    // Decode the final second and keep overwriting the output: the last write is the last frame.
    await ffmpeg(['-sseof', '-1', '-i', video, '-update', '1', '-vsync', '0', out])
  } else {
    await ffmpeg(['-ss', String(Math.max(0, at)), '-i', video, '-frames:v', '1', out])
  }
}

/** Re-encoded cut (frame accurate), audio dropped - Omni ignores ref audio anyway. */
export async function trim(input: string, startS: number, lengthS: number, out: string) {
  await ffmpeg([
    '-ss', String(Math.max(0, startS)), '-i', input, '-t', String(lengthS),
    '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ])
}

export async function stripAudio(input: string, out: string) {
  await ffmpeg(['-i', input, '-c:v', 'copy', '-an', '-movflags', '+faststart', out])
}

/** Picture of an audio file's waveform - the library thumbnail of music / sound. */
export async function waveform(input: string, out: string) {
  await ffmpeg(['-i', input, '-filter_complex', 'aformat=channel_layouts=mono,showwavespic=s=640x360:colors=0x6ee7b7:scale=sqrt', '-frames:v', '1', '-q:v', '4', out])
}

/** Re-encodes audio a browser may not play (wma, aiff, amr...) to AAC. */
export async function toM4a(input: string, out: string) {
  await ffmpeg(['-i', input, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
}

/** Normalises odd image formats (gif, bmp, avif...) to PNG. */
export async function toPng(input: string, out: string) {
  await ffmpeg(['-i', input, '-frames:v', '1', out])
}

/** Joins speech turns into one AAC file, with a short pause between turns. */
export async function concatAudio(inputs: string[], out: string, gapS = 0.3) {
  const args: string[] = []
  for (const f of inputs) args.push('-i', f)
  const pads = inputs.map((_, i) => `[${i}:a]aresample=24000,apad=pad_dur=${i < inputs.length - 1 ? gapS : 0}[a${i}]`).join(';')
  const join = `${inputs.map((_, i) => `[a${i}]`).join('')}concat=n=${inputs.length}:v=0:a=1[out]`
  await ffmpeg([...args, '-filter_complex', `${pads};${join}`, '-map', '[out]', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out])
}
