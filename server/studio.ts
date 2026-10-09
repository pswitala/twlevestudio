import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import {
  BLUR_PX,
  canvasSize,
  clipLength,
  layerPlan,
  timelineEnd,
  videoTracksBottomUp,
  type Clip,
  type Edit,
  type SourceInfo,
  type StudioMedia,
} from '../shared/studio'
import { DEFAULT_PROJECT_ID } from '../shared/types'
import { FFMPEG, ffmpeg, probe, thumbnail, toPng } from './media'
import { DIRS, db, findAsset, findGeneration, outputDir, persist } from './store'

/** Codecs every browser here plays inside mp4/webm - anything else is transcoded on import. */
const PLAYABLE_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1'])
const VIDEO_KEEP_EXT = new Set(['.mp4', '.m4v', '.webm'])
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba'])
const AUDIO_KEEP_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.opus', '.flac'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.avif', '.tif', '.tiff', '.heic'])
const IMAGE_KEEP_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp'])

// ---------- sources ----------

export interface ResolvedSource extends SourceInfo {
  file: string
  label: string
}

/** File + shape of whatever a clip points at, or undefined when it was deleted / is not ready. */
export function resolveSource(src: Clip['source']): ResolvedSource | undefined {
  if (src.type === 'generation') {
    const g = findGeneration(src.id)
    if (!g?.file || g.status !== 'completed') return undefined
    // speech and music are both just sound on the timeline
    const media = g.kind === 'music' ? 'audio' : (g.kind ?? 'video')
    return {
      file: path.join(outputDir(g), g.file),
      label: g.title || g.prompt.slice(0, 40) || media,
      media,
      duration: media === 'image' ? undefined : g.durationS,
      hasAudio: media === 'audio' ? true : media === 'video' ? !!g.hasAudio : false,
    }
  }
  if (src.type === 'asset') {
    const a = findAsset(src.id)
    if (!a) return undefined
    // library video refs are stored without sound (Omni ignores it); library audio is music / sound
    return { file: path.join(DIRS.assets, a.file), label: a.label, media: a.kind, duration: a.kind === 'image' ? undefined : a.durationS, hasAudio: a.kind === 'audio' }
  }
  const m = db.media.find((x) => x.id === src.id)
  if (!m) return undefined
  return { file: path.join(DIRS.studio, m.file), label: m.label, media: m.kind, duration: m.kind === 'image' ? undefined : m.durationS, hasAudio: m.hasAudio }
}

// ---------- import ----------

/**
 * Turns an upload into Studio media. Unlike library refs nothing is cut: footage, music and voice-over keep their full
 * length. Files a browser cannot play (HEVC .mov, .mkv, odd audio) are transcoded so the preview works.
 */
export async function importMedia(tmp: string, originalName: string, mime: string, projectId = DEFAULT_PROJECT_ID): Promise<StudioMedia> {
  const ext = path.extname(originalName).toLowerCase()
  const id = crypto.randomUUID()
  const made: string[] = []
  try {
    const p = await probe(tmp)
    const kind: StudioMedia['kind'] =
      mime.startsWith('audio/') || AUDIO_EXT.has(ext) || (!p.hasVideo && p.hasAudio)
        ? 'audio'
        : mime.startsWith('image/') || IMAGE_EXT.has(ext) || !p.durationS || p.durationS < 0.05
          ? 'image'
          : 'video'
    if (kind === 'audio' && !p.hasAudio) throw new Error(`${originalName}: no audio in the file`)
    if (kind !== 'audio' && !p.hasVideo) throw new Error(`${originalName}: not a picture or a video`)

    let file: string
    if (kind === 'video') {
      const keep = VIDEO_KEEP_EXT.has(ext) && PLAYABLE_VIDEO.has(p.videoCodec ?? '')
      file = `${id}${keep ? ext : '.mp4'}`
      const out = path.join(DIRS.studio, file)
      made.push(out)
      if (keep) await fs.promises.copyFile(tmp, out)
      else {
        await ffmpeg([
          '-i', tmp, '-map', '0:v:0', '-map', '0:a:0?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
        ])
      }
    } else if (kind === 'audio') {
      const keep = AUDIO_KEEP_EXT.has(ext)
      file = `${id}${keep ? ext : '.m4a'}`
      const out = path.join(DIRS.studio, file)
      made.push(out)
      if (keep) await fs.promises.copyFile(tmp, out)
      else await ffmpeg(['-i', tmp, '-vn', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out])
    } else {
      const keep = IMAGE_KEEP_EXT.has(ext)
      file = `${id}${keep ? ext : '.png'}`
      const out = path.join(DIRS.studio, file)
      made.push(out)
      if (keep) await fs.promises.copyFile(tmp, out)
      else await toPng(tmp, out)
    }

    const full = path.join(DIRS.studio, file)
    const q = await probe(full)
    let thumb: string | undefined
    if (kind !== 'audio') {
      thumb = `${id}.jpg`
      made.push(path.join(DIRS.thumbs, thumb))
      await thumbnail(full, path.join(DIRS.thumbs, thumb), kind === 'video' ? Math.min(1, (q.durationS ?? 0) / 2) : 0)
    }
    const m: StudioMedia = {
      id,
      projectId,
      kind,
      label: path.basename(originalName, ext).slice(0, 80) || kind,
      file,
      thumb,
      mime: kind === 'image' ? mimeOfImage(file) : kind === 'audio' ? `audio/${path.extname(file).slice(1)}` : `video/${path.extname(file).slice(1)}`,
      bytes: (await fs.promises.stat(full)).size,
      durationS: kind === 'image' ? undefined : q.durationS,
      width: q.width,
      height: q.height,
      hasAudio: kind === 'audio' || q.hasAudio,
      createdAt: new Date().toISOString(),
    }
    db.media.unshift(m)
    await persist()
    return m
  } catch (e) {
    for (const f of made) await fs.promises.rm(f, { force: true })
    throw e
  } finally {
    await fs.promises.rm(tmp, { force: true })
  }
}

function mimeOfImage(file: string) {
  const ext = path.extname(file).slice(1)
  return ext === 'jpg' ? 'image/jpeg' : `image/${ext}`
}

// ---------- render ----------

const n = (x: number) => Number(x.toFixed(3))

/**
 * Builds the ffmpeg command for a timeline: a black canvas, every video clip scaled into it (letterbox transparent, so
 * a smaller clip on V2 shows V1 underneath) and overlaid bottom track first; every audible clip delayed to its place
 * and mixed over a silent bed (so the mix always lasts the whole timeline). Exported for tests.
 *
 * Transitions follow layerPlan(): a layer may start early / end late (handles, frozen when the source has none),
 * fades its alpha (Cross / Blur Dissolve), mixes in a blurred copy of itself (Blur Dissolve) or is ADDED onto the
 * picture under it while its ramp runs (Additive Dissolve: blend in RGB, then a normal overlay for the rest).
 */
export function buildRender(edit: Edit, resolve: (c: Clip) => ResolvedSource | undefined) {
  const total = timelineEnd(edit)
  if (total <= 0) throw new Error('The timeline is empty - put some clips on it first.')
  const { w, h } = canvasSize(edit.aspect, edit.resolution)
  const fps = edit.fps || 24
  const args: string[] = ['-f', 'lavfi', '-i', `color=c=black:s=${w}x${h}:r=${fps}:d=${n(total)}`, '-f', 'lavfi', '-t', String(n(total)), '-i', 'anullsrc=r=48000:cl=stereo']
  // RGB all the way: Additive Dissolve adds colour values, which only means "brighter" in RGB
  const graph: string[] = ['[0:v]format=gbrp[base]']
  const sounds: string[] = []
  let input = 2
  let last = 'base'
  const muted = new Set(edit.tracks.filter((t) => t.muted).map((t) => t.id))
  const kindOf = new Map(edit.tracks.map((t) => [t.id, t.kind]))
  const plan = layerPlan(edit)
  const sigma = n((BLUR_PX * Math.min(w, h)) / 1080)

  const missing = edit.clips.filter((c) => !resolve(c))
  if (missing.length) throw new Error(`${missing.length} clip${missing.length > 1 ? 's point' : ' points'} at a deleted or unfinished source - remove ${missing.length > 1 ? 'them' : 'it'} from the timeline.`)

  const addSound = (c: Clip, idx: number, o: { skip?: number; fadeIn?: number; fadeOut?: number } = {}) => {
    const ms = Math.round(c.start * 1000)
    const label = `a${sounds.length}`
    const len = clipLength(c)
    // a layer with handles reads more of the file than the clip uses - its sound keeps to the clip
    const trim = o.skip !== undefined ? `atrim=start=${n(Math.max(0, o.skip))}:duration=${n(len)},` : ''
    const fades = [
      o.fadeIn ? `afade=t=in:st=0:d=${n(o.fadeIn)}` : '',
      o.fadeOut ? `afade=t=out:st=${n(Math.max(0, len - o.fadeOut))}:d=${n(o.fadeOut)}` : '',
    ].filter(Boolean)
    graph.push(
      `[${idx}:a]${trim}asetpts=PTS-STARTPTS,aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
        `${fades.length ? `${fades.join(',')},` : ''}volume=${n(c.volume)},adelay=${ms}|${ms}[${label}]`,
    )
    sounds.push(`[${label}]`)
  }

  for (const track of videoTracksBottomUp(edit)) {
    if (muted.has(track.id)) continue
    for (const c of edit.clips.filter((x) => x.trackId === track.id).sort((a, b) => a.start - b.start)) {
      const src = resolve(c)!
      if (src.media === 'audio') continue
      const L = plan.get(c.id)!
      const span = L.end - L.start
      // source range incl. handles; what the source does not have is frozen (first / last frame)
      const wantIn = c.in - L.pre
      const wantOut = c.out + L.post
      let freezeHead = 0
      let freezeTail = 0
      let realIn = 0
      if (src.media === 'image') args.push('-loop', '1', '-framerate', String(fps), '-t', String(n(span)), '-i', src.file)
      else {
        realIn = Math.max(0, wantIn)
        const realOut = Math.min(src.duration ?? Infinity, wantOut)
        freezeHead = realIn - wantIn
        freezeTail = Math.max(0, wantOut - realOut)
        args.push('-ss', String(n(realIn)), '-t', String(n(realOut - realIn)), '-i', src.file)
      }
      const idx = input++
      const v = `v${idx}`
      const chain = [
        `scale=w=${w}:h=${h}:force_original_aspect_ratio=decrease`,
        'setsar=1',
        `fps=${fps}`,
        'format=rgba',
        `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black@0`,
      ]
      if (freezeHead > 0.001 || freezeTail > 0.001) {
        chain.push(`tpad=start_duration=${n(freezeHead)}:start_mode=clone:stop_duration=${n(freezeTail)}:stop_mode=clone`)
      }
      chain.push(`setpts=PTS-STARTPTS+${n(L.start)}/TB`)
      // Cross / Blur Dissolve: the layer's alpha follows its ramps
      for (const r of L.ramps.filter((x) => x.type !== 'additive')) {
        chain.push(`fade=t=${r.dir}:st=${n(r.from)}:d=${n(Math.max(0.001, r.to - r.from))}:alpha=1`)
      }
      // Blur Dissolve: mix in a blurred copy, strongest where the layer is least present
      const blurTerms = [
        ...L.ramps.filter((r) => r.type === 'blur').map((r) => (r.dir === 'in' ? fall(r.from, r.to) : rise(r.from, r.to))),
        ...L.blurs.map((b) => (b.dir === 'out' ? rise(b.from, b.to) : fall(b.from, b.to))),
      ]
      if (blurTerms.length) {
        const k = blurTerms.reduce((acc, t) => `max(${acc},${t})`)
        graph.push(`[${idx}:v]${chain.join(',')},format=gbrap,split[${v}s][${v}b]`)
        graph.push(`[${v}b]gblur=sigma=${sigma}[${v}g]`)
        graph.push(`[${v}s][${v}g]blend=all_expr='A*(1-(${k}))+B*(${k})'[${v}]`)
      } else {
        graph.push(`[${idx}:v]${chain.join(',')}[${v}]`)
      }

      // Additive Dissolve: while its ramp runs the layer is ADDED to the picture under it; a plain overlay the rest of the time
      const adds = L.ramps.filter((r) => r.type === 'additive')
      if (!adds.length) {
        graph.push(`[${last}][${v}]overlay=eof_action=pass:format=gbrp[o${idx}]`)
      } else {
        graph.push(`[${v}]split=${adds.length + 1}${[...adds.keys(), adds.length].map((i) => `[${v}_${i}]`).join('')}`)
        let cur = last
        adds.forEach((r, i) => {
          const pres = r.dir === 'in' ? rise(r.from, r.to) : fall(r.from, r.to)
          graph.push(`[${v}_${i}]format=gbrp[${v}_g${i}]`)
          graph.push(
            `[${cur}][${v}_g${i}]blend=all_expr='min(255,A*min(1,2*(1-(${pres})))+B*min(1,2*(${pres})))':enable='between(t,${n(r.from)},${n(r.to)})'[${v}_x${i}]`,
          )
          cur = `${v}_x${i}`
        })
        const off = adds.map((r) => `between(t,${n(r.from)},${n(r.to)})`).join('+')
        graph.push(`[${cur}][${v}_${adds.length}]overlay=eof_action=pass:format=gbrp:enable='not(${off})'[o${idx}]`)
      }
      last = `o${idx}`
      if (src.media === 'video' && src.hasAudio && c.useAudio !== false && c.volume > 0) {
        addSound(c, idx, { skip: c.in - realIn, fadeIn: L.audioIn, fadeOut: L.audioOut })
      }
    }
  }

  for (const c of edit.clips) {
    if (kindOf.get(c.trackId) !== 'audio' || muted.has(c.trackId) || c.volume <= 0) continue
    const src = resolve(c)!
    if (!src.hasAudio) continue
    args.push('-ss', String(n(c.in)), '-t', String(n(clipLength(c))), '-i', src.file)
    addSound(c, input++)
  }

  graph.push(`[${last}]format=yuv420p[vout]`)
  graph.push(
    sounds.length
      ? `[1:a]${sounds.join('')}amix=inputs=${sounds.length + 1}:duration=first:normalize=0,alimiter=limit=0.97[aout]`
      : `[1:a]anull[aout]`,
  )
  return { args, filter: graph.join(';\n'), total, size: { w, h }, fps }
}

/** ffmpeg expression in T: 0 at `from` -> 1 at `to` (clamped) */
const rise = (from: number, to: number) => `clip((T-${n(from)})/${n(Math.max(0.001, to - from))},0,1)`
/** 1 at `from` -> 0 at `to` (clamped) */
const fall = (from: number, to: number) => `clip((${n(to)}-T)/${n(Math.max(0.001, to - from))},0,1)`

/** Renders the timeline to an mp4. `onProgress` gets 0..1; `alive` false (generation deleted) kills ffmpeg. */
export async function renderEdit(edit: Edit, out: string, onProgress: (p: number) => void, alive: () => boolean): Promise<void> {
  const r = buildRender(edit, (c) => resolveSource(c.source))
  const script = path.join(DIRS.tmp, `${crypto.randomUUID()}.filter`)
  await fs.promises.writeFile(script, r.filter)
  const args = [
    '-hide_banner', '-loglevel', 'error', '-y', '-nostats', '-progress', 'pipe:1',
    ...r.args,
    '-filter_complex_script', script,
    '-map', '[vout]', '-map', '[aout]', '-t', String(n(r.total)), '-r', String(r.fps),
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out,
  ]
  try {
    await new Promise<void>((resolve, reject) => {
      const p = spawn(FFMPEG, args, { windowsHide: true })
      let err = ''
      let lastReport = 0
      const watchdog = setInterval(() => {
        if (!alive()) p.kill()
      }, 1000)
      p.stdout.on('data', (d: Buffer) => {
        const m = /out_time_us=(\d+)/.exec(d.toString())
        if (m && Date.now() - lastReport > 1000) {
          lastReport = Date.now()
          onProgress(Math.min(0.99, Number(m[1]) / 1e6 / r.total))
        }
      })
      p.stderr.on('data', (d: Buffer) => {
        err = (err + d.toString()).slice(-2000)
      })
      p.on('error', reject)
      p.on('close', (code) => {
        clearInterval(watchdog)
        if (code === 0) resolve()
        else reject(new Error(alive() ? `Render failed: ${err.trim().slice(-500) || `ffmpeg exit ${code}`}` : 'Render cancelled'))
      })
    })
  } finally {
    await fs.promises.rm(script, { force: true })
  }
}
