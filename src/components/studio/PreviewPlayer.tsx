import { useEffect, useMemo, useRef, useState } from 'react'
import { canvasSize, clipEnd, layerLookAt, layerPlan, type Clip, type Edit, type Layer } from '../../../shared/studio'
import { type SourceItem, sourceKey, usePlayback } from './sources'

/** How far ahead clips are mounted, so the next one has loaded before the playhead reaches it. */
const PRELOAD_S = 3

/**
 * Browser preview of the timeline. Every video clip under the playhead is stacked like the export does it
 * (upper track on top, letterbox transparent); sound plays from audio tracks and from video clips with audio on.
 * Transitions come from the same layerPlan() as the export: CSS opacity (Cross), opacity + blur (Blur) and
 * plus-lighter blending (Additive) - a close approximation, the export is exact.
 * The media elements follow the playhead clock - they never drive it.
 */
export function PreviewPlayer({ edit, sources }: { edit: Edit; sources: Map<string, SourceItem> }) {
  const t = usePlayback((s) => s.t)
  const playing = usePlayback((s) => s.playing)
  const { w, h } = canvasSize(edit.aspect, edit.resolution)
  const muted = new Set(edit.tracks.filter((x) => x.muted).map((x) => x.id))
  const order = new Map(edit.tracks.map((x, i) => [x.id, i]))
  const kindOf = new Map(edit.tracks.map((x) => [x.id, x.kind]))
  const plan = useMemo(() => layerPlan(edit), [edit])
  // within a track the later clip is drawn over the earlier one (it dissolves over it)
  const rank = useMemo(() => {
    const m = new Map<string, number>()
    for (const tr of edit.tracks) edit.clips.filter((c) => c.trackId === tr.id).sort((a, b) => a.start - b.start).forEach((c, i) => m.set(c.id, i))
    return m
  }, [edit])

  // fit the canvas into the space available (CSS aspect-ratio cannot be bound by both width and height)
  const box = useRef<HTMLDivElement>(null)
  const [fit, setFit] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect
      const scale = Math.min(width / w, height / h)
      setFit({ w: Math.floor(w * scale), h: Math.floor(h * scale) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [w, h])
  const blurScale = Math.min(fit.w, fit.h) / 1080

  const spanOf = (c: Clip): [number, number] => {
    const l = plan.get(c.id)
    return l ? [l.start, l.end] : [c.start, clipEnd(c)]
  }
  const near = edit.clips.filter((c) => {
    const [s, e] = spanOf(c)
    return s - PRELOAD_S <= t && t < e + 0.25 && !muted.has(c.trackId)
  })

  return (
    <div ref={box} className="flex h-full min-h-0 w-full items-center justify-center">
      <div className="relative isolate overflow-hidden bg-black shadow-2xl ring-1 ring-white/10" style={{ width: fit.w, height: fit.h }}>
        {near.map((c) => {
          const src = sources.get(sourceKey(c.source))
          if (!src) return null
          const [s, e] = spanOf(c)
          const visible = s <= t && t < e
          const own = c.start <= t && t < clipEnd(c)
          const onVideoTrack = kindOf.get(c.trackId) === 'video'
          const z = (100 - (order.get(c.trackId) ?? 0)) * 100 + (rank.get(c.id) ?? 0)
          const L = plan.get(c.id)
          const look = L && visible ? layerLookAt(L, t) : { opacity: 1, blur: 0, additive: false }
          const style: React.CSSProperties = {
            zIndex: z,
            opacity: visible ? look.opacity : 0,
            filter: look.blur > 0.3 ? `blur(${(look.blur * blurScale).toFixed(1)}px)` : undefined,
            mixBlendMode: look.additive ? 'plus-lighter' : undefined,
          }
          if (onVideoTrack && src.media === 'image') {
            return visible ? <img key={c.id} src={src.url} alt="" className="absolute inset-0 size-full object-contain" style={style} /> : null
          }
          if (onVideoTrack && src.media === 'video') {
            return (
              <Synced
                key={c.id}
                kind="video"
                url={src.url}
                clip={c}
                t={t}
                playing={playing}
                active={visible}
                audible={own && src.hasAudio && c.useAudio !== false}
                gain={L ? audioGain(L, t) : 1}
                style={style}
              />
            )
          }
          if (!onVideoTrack && src.hasAudio) {
            return <Synced key={c.id} kind="audio" url={src.url} clip={c} t={t} playing={playing} active={own} audible gain={1} />
          }
          return null
        })}
      </div>
    </div>
  )
}

/** sound fade where the picture fades from / to nothing */
function audioGain(L: Layer, t: number): number {
  const c = L.clip
  let g = 1
  if (L.audioIn) g = Math.min(g, Math.max(0, (t - c.start) / L.audioIn))
  if (L.audioOut) g = Math.min(g, Math.max(0, (clipEnd(c) - t) / L.audioOut))
  return g
}

function Synced({
  kind,
  url,
  clip,
  t,
  playing,
  active,
  audible,
  gain,
  style,
}: {
  kind: 'video' | 'audio'
  url: string
  clip: Clip
  t: number
  playing: boolean
  /** drawn / heard now (a layer with handles is active before / after the clip itself) */
  active: boolean
  audible: boolean
  gain: number
  style?: React.CSSProperties
}) {
  const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (!active) {
      if (!el.paused) el.pause()
      // parked on its first frame, ready for the playhead
      if (el.readyState > 0 && Math.abs(el.currentTime - clip.in) > 0.05) el.currentTime = clip.in
      return
    }
    // handles: before the source starts / after it ends the frame is held (the export freezes it the same way)
    const raw = clip.in + (t - clip.start)
    const dur = Number.isFinite(el.duration) ? el.duration : Infinity
    const local = Math.min(Math.max(0, raw), Math.max(0, dur - 0.04))
    const frozen = raw < 0 || raw > dur
    el.muted = !audible || clip.volume <= 0
    el.volume = Math.min(1, Math.max(0, clip.volume * gain))
    if (playing && !frozen) {
      if (Math.abs(el.currentTime - local) > 0.3) el.currentTime = local
      if (el.paused) void el.play().catch(() => {})
    } else {
      if (!el.paused) el.pause()
      if (Math.abs(el.currentTime - local) > 0.02) el.currentTime = local
    }
  }, [t, playing, active, audible, gain, clip.in, clip.start, clip.volume])

  if (kind === 'audio') return <audio ref={ref} src={url} preload="auto" />
  return <video ref={ref} src={url} preload="auto" playsInline className="absolute inset-0 size-full object-contain" style={style} />
}
