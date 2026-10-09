/**
 * Studio: timeline edits ("montaże") that combine generated clips, library media and audio into one video.
 * A clip shows `in..out` of its source, starting at `start` on the timeline (all in seconds).
 */

export type TrackKind = 'video' | 'audio'

export interface Track {
  id: string
  kind: TrackKind
  name: string
  muted?: boolean
}

/** generation = gallery output, asset = library ref, media = Studio import (full length: footage, music, voice-over) */
export type SourceType = 'generation' | 'asset' | 'media'

/** A file imported into Studio. Unlike library refs, videos are kept at full length and audio is allowed. */
export interface StudioMedia {
  id: string
  projectId: string
  kind: 'video' | 'image' | 'audio'
  label: string
  /** file name inside data/studio */
  file: string
  /** file name inside data/thumbs (video / image) */
  thumb?: string
  mime: string
  bytes: number
  durationS?: number
  width?: number
  height?: number
  hasAudio: boolean
  createdAt: string
}

export interface Clip {
  id: string
  trackId: string
  source: { type: SourceType; id: string }
  /** position on the timeline */
  start: number
  /** range of the source that is used */
  in: number
  out: number
  /** 0..2 (1 = as recorded) */
  volume: number
  /** video tracks only: mix the clip's own sound in */
  useAudio?: boolean
  /** video tracks only: transition on the clip's first / last seconds (see layerPlan) */
  transitionIn?: Transition
  transitionOut?: Transition
}

/** DaVinci's dissolves. cross = plain opacity, additive = images summed (brighter middle), blur = both blurred mid-way. */
export type TransitionType = 'cross' | 'additive' | 'blur'

export interface Transition {
  type: TransitionType
  /** seconds */
  duration: number
}

export const TRANSITIONS: { type: TransitionType; label: string; hint: string }[] = [
  { type: 'cross', label: 'Cross Dissolve', hint: 'One picture fades into the other' },
  { type: 'additive', label: 'Additive Dissolve', hint: 'Both pictures are added - the middle of the dissolve glows brighter' },
  { type: 'blur', label: 'Blur Dissolve', hint: 'Both pictures blur towards the middle while they dissolve' },
]
export const TRANSITION_LABEL = Object.fromEntries(TRANSITIONS.map((t) => [t.type, t.label])) as Record<TransitionType, string>
export const DEFAULT_TRANSITION_S = 1
export const MAX_TRANSITION_S = 10

export type EditAspect = '16:9' | '9:16' | '1:1'
export type EditResolution = '720p' | '1080p'

export interface Edit {
  id: string
  projectId: string
  name: string
  createdAt: string
  updatedAt: string
  aspect: EditAspect
  resolution: EditResolution
  fps: number
  /** top to bottom as shown: video tracks (highest first), then audio tracks */
  tracks: Track[]
  clips: Clip[]
}

/** What the timeline needs to know about a source. `duration` undefined = a still image (any length). */
export interface SourceInfo {
  media: 'video' | 'image' | 'audio'
  duration?: number
  hasAudio: boolean
}

/** Short random id for tracks/clips. Not crypto.randomUUID: the app is served over plain http on a LAN address,
 * which is not a secure context, so the browser does not offer it there. */
export const shortId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4)

export const IMAGE_DEFAULT_SECONDS = 3
export const MIN_CLIP_SECONDS = 0.1

export function canvasSize(aspect: EditAspect, resolution: EditResolution): { w: number; h: number } {
  const short = resolution === '1080p' ? 1080 : 720
  const long = resolution === '1080p' ? 1920 : 1280
  return aspect === '9:16' ? { w: short, h: long } : aspect === '1:1' ? { w: short, h: short } : { w: long, h: short }
}

export const clipLength = (c: Clip) => Math.max(0, c.out - c.in)
export const clipEnd = (c: Clip) => c.start + clipLength(c)

export function timelineEnd(edit: Pick<Edit, 'clips'>): number {
  return edit.clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

export function newEdit(id: string, projectId: string, name: string, now = new Date().toISOString()): Edit {
  return {
    id,
    projectId,
    name,
    createdAt: now,
    updatedAt: now,
    aspect: '9:16',
    resolution: '1080p',
    fps: 24,
    tracks: [
      { id: 'v2', kind: 'video', name: 'V2' },
      { id: 'v1', kind: 'video', name: 'V1' },
      { id: 'a1', kind: 'audio', name: 'A1' },
      { id: 'a2', kind: 'audio', name: 'A2' },
    ],
    clips: [],
  }
}

/** Video tracks in render order: the bottom one (last in the list) first, the top one last. */
export function videoTracksBottomUp(edit: Pick<Edit, 'tracks'>): Track[] {
  return edit.tracks.filter((t) => t.kind === 'video').reverse()
}

/** The clip that is visible at time t: the topmost unmuted video track wins. */
export function visibleClipAt(edit: Pick<Edit, 'tracks' | 'clips'>, t: number): Clip | undefined {
  for (const track of edit.tracks.filter((x) => x.kind === 'video' && !x.muted)) {
    const c = edit.clips.find((x) => x.trackId === track.id && x.start <= t && t < clipEnd(x))
    if (c) return c
  }
  return undefined
}

/** Clips whose sound plays at time t (audio tracks + video clips with their own audio switched on). */
export function audibleClipsAt(edit: Pick<Edit, 'tracks' | 'clips'>, t: number, info: (c: Clip) => SourceInfo | undefined): Clip[] {
  const muted = new Set(edit.tracks.filter((x) => x.muted).map((x) => x.id))
  const kind = new Map(edit.tracks.map((x) => [x.id, x.kind]))
  return edit.clips.filter((c) => {
    if (muted.has(c.trackId) || !(c.start <= t && t < clipEnd(c)) || c.volume <= 0) return false
    if (!info(c)?.hasAudio) return false
    return kind.get(c.trackId) === 'audio' || c.useAudio !== false
  })
}

/** Which track kinds a source may go on: audio sources only on audio tracks; a video on an audio track = its sound. */
export function fitsTrack(src: SourceInfo, track: Track): boolean {
  if (track.kind === 'video') return src.media !== 'audio'
  return src.hasAudio
}

/** A new clip for a source dropped at `start`. */
export function clipFor(id: string, trackId: string, source: Clip['source'], src: SourceInfo, start: number): Clip {
  const len = src.duration ?? IMAGE_DEFAULT_SECONDS
  return { id, trackId, source, start: Math.max(0, start), in: 0, out: len, volume: 1, useAudio: src.hasAudio }
}

/** Where `c` would overlap another clip on `trackId` (ignoring itself). */
export function overlaps(clips: Clip[], c: Pick<Clip, 'id' | 'trackId' | 'start' | 'in' | 'out'>): boolean {
  const end = c.start + (c.out - c.in)
  return clips.some((x) => x.id !== c.id && x.trackId === c.trackId && c.start < clipEnd(x) - 1e-6 && end > x.start + 1e-6)
}

/** Snap `t` to the nearest of `points` within `tolerance` seconds. */
export function snap(t: number, points: number[], tolerance: number): number {
  let best = t
  let dist = tolerance
  for (const p of points) {
    const d = Math.abs(p - t)
    if (d <= dist) {
      dist = d
      best = p
    }
  }
  return best
}

/** Edges of every clip (except `exceptId`) plus 0 and the playhead - what moves and trims snap to. */
export function snapPoints(clips: Clip[], exceptId: string | undefined, playhead: number): number[] {
  const pts = [0, playhead]
  for (const c of clips) if (c.id !== exceptId) pts.push(c.start, clipEnd(c))
  return pts
}

/** Split a clip at timeline time t into two; returns [left, right] or undefined when t is not inside it. */
export function splitClip(c: Clip, t: number, newId: string): [Clip, Clip] | undefined {
  if (t <= c.start + MIN_CLIP_SECONDS || t >= clipEnd(c) - MIN_CLIP_SECONDS) return undefined
  const cut = c.in + (t - c.start)
  // the left part keeps the start transition, the right part the end one
  const { transitionIn, transitionOut, ...rest } = c
  return [
    { ...rest, out: cut, ...(transitionIn ? { transitionIn } : {}) },
    { ...rest, id: newId, start: t, in: cut, ...(transitionOut ? { transitionOut } : {}) },
  ]
}

/**
 * Trim an edge: `edge` 'start' moves the left edge to timeline time t (in-point follows), 'end' moves the
 * right edge. Bounded by the source length (images have none) and a minimum clip length.
 */
export function trimClip(c: Clip, edge: 'start' | 'end', t: number, sourceDuration?: number): Clip {
  if (edge === 'end') {
    let out = c.in + (t - c.start)
    out = Math.max(c.in + MIN_CLIP_SECONDS, out)
    if (sourceDuration !== undefined) out = Math.min(sourceDuration, out)
    return { ...c, out }
  }
  let delta = t - c.start
  delta = Math.max(-c.in, delta) // cannot start before the source does
  delta = Math.min(c.out - MIN_CLIP_SECONDS - c.in, delta)
  if (c.start + delta < 0) delta = -c.start
  return { ...c, start: c.start + delta, in: c.in + delta }
}

export function formatTimecode(t: number, fps = 24): string {
  const s = Math.max(0, t)
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const f = Math.floor((s - Math.floor(s)) * fps)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(f).padStart(2, '0')}`
}

const ASPECTS: EditAspect[] = ['16:9', '9:16', '1:1']
const RESOLUTIONS: EditResolution[] = ['720p', '1080p']
export const EDIT_FPS = [24, 25, 30, 60]
const num = (v: unknown, min: number, max: number, fallback: number) => {
  const x = Number(v)
  return Number.isFinite(x) ? Math.min(max, Math.max(min, x)) : fallback
}

/**
 * Takes an edit as the browser sent it and keeps only what is valid: known tracks, clips on existing tracks with a
 * sane range. Ids, project and timestamps always come from `base` (the stored edit).
 */
export function normalizeEdit(input: Partial<Edit>, base: Edit): Edit {
  const tracks: Track[] = Array.isArray(input.tracks)
    ? input.tracks
        .filter((t) => t && typeof t.id === 'string' && (t.kind === 'video' || t.kind === 'audio'))
        .slice(0, 16)
        .map((t) => ({ id: t.id.slice(0, 40), kind: t.kind, name: String(t.name ?? t.id).slice(0, 30), ...(t.muted ? { muted: true } : {}) }))
    : base.tracks
  const trackIds = new Set(tracks.map((t) => t.id))
  const clips: Clip[] = Array.isArray(input.clips)
    ? input.clips
        .filter(
          (c) =>
            c && typeof c.id === 'string' && trackIds.has(c.trackId) && c.source && typeof c.source.id === 'string' &&
            (c.source.type === 'generation' || c.source.type === 'asset' || c.source.type === 'media'),
        )
        .slice(0, 500)
        .map((c) => {
          const inn = num(c.in, 0, 24 * 3600, 0)
          return {
            id: c.id.slice(0, 40),
            trackId: c.trackId,
            source: { type: c.source.type, id: c.source.id.slice(0, 80) },
            start: num(c.start, 0, 24 * 3600, 0),
            in: inn,
            out: num(c.out, inn + MIN_CLIP_SECONDS, 24 * 3600, inn + IMAGE_DEFAULT_SECONDS),
            volume: num(c.volume, 0, 2, 1),
            ...(c.useAudio === false ? { useAudio: false } : c.useAudio ? { useAudio: true } : {}),
            ...(normalizeTransition(c.transitionIn) ? { transitionIn: normalizeTransition(c.transitionIn) } : {}),
            ...(normalizeTransition(c.transitionOut) ? { transitionOut: normalizeTransition(c.transitionOut) } : {}),
          }
        })
    : base.clips
  return {
    ...base,
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim().slice(0, 80) : base.name,
    aspect: ASPECTS.includes(input.aspect as EditAspect) ? (input.aspect as EditAspect) : base.aspect,
    resolution: RESOLUTIONS.includes(input.resolution as EditResolution) ? (input.resolution as EditResolution) : base.resolution,
    fps: EDIT_FPS.includes(Number(input.fps)) ? Number(input.fps) : base.fps,
    tracks: tracks.length ? tracks : base.tracks,
    clips,
  }
}

/** First start >= `start` where a clip of `len` fits on the track without overlapping (pushes past blockers). */
export function freeStart(clips: Clip[], trackId: string, start: number, len: number): number {
  let s = Math.max(0, start)
  for (let guard = 0; guard < 1000; guard++) {
    const hit = clips.find((x) => x.trackId === trackId && s < clipEnd(x) - 1e-6 && s + len > x.start + 1e-6)
    if (!hit) return s
    s = clipEnd(hit)
  }
  return s
}

/** End of the last clip on a track (where "append" puts the next clip). */
export function trackEnd(clips: Clip[], trackId: string): number {
  return clips.filter((c) => c.trackId === trackId).reduce((m, c) => Math.max(m, clipEnd(c)), 0)
}

/** Name for a new track of `kind`: V3, A3... (one above the highest number in use). */
export function nextTrackName(tracks: Track[], kind: TrackKind): string {
  const p = kind === 'video' ? 'V' : 'A'
  const max = tracks.filter((t) => t.kind === kind).reduce((m, t) => Math.max(m, Number(/^[VA](\d+)$/.exec(t.name)?.[1] ?? 0)), 0)
  return `${p}${max + 1}`
}

function normalizeTransition(t: unknown): Transition | undefined {
  const x = t as Partial<Transition> | undefined
  if (!x || !TRANSITIONS.some((d) => d.type === x.type)) return undefined
  const duration = Number(x.duration)
  return { type: x.type as TransitionType, duration: Number.isFinite(duration) ? Math.min(MAX_TRANSITION_S, Math.max(0.1, duration)) : DEFAULT_TRANSITION_S }
}

// ---------- transitions: how every video clip is drawn ----------

/** This layer's presence going 0 -> 1 ('in') or 1 -> 0 ('out') between `from` and `to` (timeline seconds). */
export interface Ramp {
  from: number
  to: number
  dir: 'in' | 'out'
  type: TransitionType
}

/** How one video clip is drawn once transitions are applied. */
export interface Layer {
  clip: Clip
  /** seconds drawn before the clip's start (pre-roll under/over the clip before it) */
  pre: number
  /** seconds drawn after its end (it keeps playing under the clip after it) */
  post: number
  /** timeline span of the layer: start - pre .. end + post */
  start: number
  end: number
  /** opacity (cross / blur) or additive presence ramps of this layer */
  ramps: Ramp[]
  /** blur-only ramps: the outgoing clip of a Blur Dissolve blurs while the next one appears over it */
  blurs: { from: number; to: number; dir: 'in' | 'out' }[]
  /** fades of the clip's own sound - only where the picture fades from / to nothing (not at a cut) */
  audioIn?: number
  audioOut?: number
}

/** Two clips on one track meet when one ends where the next starts (within a frame-ish). */
export const CUT_TOLERANCE_S = 0.02
const meets = (a: Clip, b: Clip) => Math.abs(clipEnd(a) - b.start) < CUT_TOLERANCE_S

/** The clip right before / after `c` on its track, if they touch (a cut). */
export function neighbours(clips: Clip[], c: Clip): { prev?: Clip; next?: Clip } {
  const same = clips.filter((x) => x.trackId === c.trackId && x.id !== c.id)
  return { prev: same.find((x) => meets(x, c)), next: same.find((x) => meets(c, x)) }
}

/**
 * Turns transitions into layers, DaVinci style. A transition sits on a clip edge:
 * - at a CUT (another clip touches that edge on the same track) the later clip dissolves over the earlier one.
 *   On the later clip's START it plays after the cut (the earlier clip runs on under it); on the earlier clip's END
 *   it plays before the cut (the later clip starts early). Missing handle frames are frozen.
 * - at a free edge the clip dissolves from / to whatever is under it (a lower track, or black).
 * A cut with transitions on both sides uses the later clip's start transition.
 */
export function layerPlan(edit: Pick<Edit, 'tracks' | 'clips'>): Map<string, Layer> {
  const plan = new Map<string, Layer>()
  const videoTracks = new Set(edit.tracks.filter((t) => t.kind === 'video').map((t) => t.id))
  const layerOf = (c: Clip) => {
    let l = plan.get(c.id)
    if (!l) plan.set(c.id, (l = { clip: c, pre: 0, post: 0, start: c.start, end: clipEnd(c), ramps: [], blurs: [] }))
    return l
  }
  for (const c of edit.clips) if (videoTracks.has(c.trackId)) layerOf(c)

  for (const c of edit.clips) {
    if (!videoTracks.has(c.trackId)) continue
    const me = layerOf(c)
    const len = clipLength(c)
    const { prev, next } = neighbours(edit.clips, c)

    // start edge
    const atCut = prev ? (c.transitionIn ? { tr: c.transitionIn, after: true } : prev.transitionOut ? { tr: prev.transitionOut, after: false } : undefined) : undefined
    if (prev && atCut) {
      const d = Math.min(atCut.tr.duration, len, clipLength(prev))
      const before = layerOf(prev)
      const [from, to] = atCut.after ? [c.start, c.start + d] : [c.start - d, c.start]
      if (atCut.after) before.post = Math.max(before.post, d)
      else me.pre = Math.max(me.pre, d)
      me.ramps.push({ from, to, dir: 'in', type: atCut.tr.type })
      if (atCut.tr.type === 'blur') before.blurs.push({ from, to, dir: 'out' })
    } else if (!prev && c.transitionIn) {
      const d = Math.min(c.transitionIn.duration, len)
      me.ramps.push({ from: c.start, to: c.start + d, dir: 'in', type: c.transitionIn.type })
      me.audioIn = d
    }

    // end edge (a cut here is handled by the next clip's start)
    if (!next && c.transitionOut) {
      const d = Math.min(c.transitionOut.duration, len)
      me.ramps.push({ from: clipEnd(c) - d, to: clipEnd(c), dir: 'out', type: c.transitionOut.type })
      me.audioOut = d
    }
  }
  for (const l of plan.values()) {
    l.start = l.clip.start - l.pre
    l.end = clipEnd(l.clip) + l.post
  }
  return plan
}

/** 0..1 progress of a ramp at time t (clamped). */
export const rampProgress = (r: { from: number; to: number }, t: number) => (r.to <= r.from ? 1 : Math.min(1, Math.max(0, (t - r.from) / (r.to - r.from))))

/**
 * What a layer looks like at time t, for the browser preview: opacity, blur in px (at 1080 px height) and whether it
 * is added on top (additive). The export does the same maths in ffmpeg.
 */
export function layerLookAt(l: Layer, t: number): { opacity: number; blur: number; additive: boolean } {
  let opacity = 1
  let blur = 0
  let additive = false
  for (const r of l.ramps) {
    if (t < r.from || t > r.to) continue
    const p = rampProgress(r, t)
    const presence = r.dir === 'in' ? p : 1 - p
    if (r.type === 'additive') {
      additive = true
      opacity = Math.min(opacity, Math.min(1, 2 * presence))
    } else opacity = Math.min(opacity, presence)
    if (r.type === 'blur') blur = Math.max(blur, BLUR_PX * (1 - presence))
  }
  for (const b of l.blurs) {
    if (t < b.from || t > b.to) continue
    const p = rampProgress(b, t)
    blur = Math.max(blur, BLUR_PX * (b.dir === 'out' ? p : 1 - p))
  }
  return { opacity, blur, additive }
}

/** strongest blur of a Blur Dissolve (gaussian sigma at 1080 p) */
export const BLUR_PX = 24

/** Putting a transition on one side of a cut takes it off the other side (one transition per cut). */
export function setTransition(clips: Clip[], clipId: string, side: 'in' | 'out', tr: Transition | undefined): Clip[] {
  const c = clips.find((x) => x.id === clipId)
  if (!c) return clips
  const { prev, next } = neighbours(clips, c)
  const other = side === 'in' ? prev : next
  return clips.map((x) => {
    if (x.id === clipId) {
      const { transitionIn, transitionOut, ...rest } = x
      const keep = side === 'in' ? { ...(transitionOut ? { transitionOut } : {}) } : { ...(transitionIn ? { transitionIn } : {}) }
      return { ...rest, ...keep, ...(tr ? (side === 'in' ? { transitionIn: tr } : { transitionOut: tr }) : {}) }
    }
    if (tr && other && x.id === other.id) {
      const { transitionIn, transitionOut, ...rest } = x
      return side === 'in' ? { ...rest, ...(transitionIn ? { transitionIn } : {}) } : { ...rest, ...(transitionOut ? { transitionOut } : {}) }
    }
    return x
  })
}
