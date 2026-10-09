import { useEffect, useRef, useState } from 'react'
import { Eye, EyeOff, Film, Image as ImageIcon, Music, Plus, Trash2, Volume2, VolumeX } from 'lucide-react'
import {
  clipEnd,
  clipFor,
  clipLength,
  DEFAULT_TRANSITION_S,
  fitsTrack,
  MAX_TRANSITION_S,
  setTransition,
  TRANSITION_LABEL,
  formatTimecode,
  freeStart,
  nextTrackName,
  overlaps,
  shortId,
  snap,
  snapPoints,
  timelineEnd,
  trimClip,
  type Clip,
  type Track,
  type Transition,
  type TransitionType,
} from '../../../shared/studio'
import { cn } from '../../lib/utils'
import { confirmAction } from '../ConfirmDialog'
import { DND_TRANSITION, DND_TYPE, type SourceItem, sourceKey, usePlayback } from './sources'
import type { Editor } from './useEditor'

export const HEADER_W = 104
const ROW_H: Record<Track['kind'], number> = { video: 58, audio: 44 }
const SNAP_PX = 8
const TICK_STEPS = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]

const newId = shortId

interface Drag {
  id: string
  mode: 'move' | 'start' | 'end'
  x0: number
  y0: number
  orig: Clip
  others: Clip[]
  started: boolean
  invalid: boolean
}

/** Adds a source to the timeline: on `trackId` if it fits there, else the first track that takes it; never on top of a clip. */
export function placeSource(editor: Editor, src: SourceItem, at: number, trackId?: string): string | undefined {
  const e = editor.edit
  if (!e) return
  const wanted = e.tracks.find((t) => t.id === trackId)
  const bottomUpVideo = e.tracks.filter((t) => t.kind === 'video').reverse()
  const audio = e.tracks.filter((t) => t.kind === 'audio')
  const track =
    wanted && fitsTrack(src, wanted) ? wanted : src.media === 'audio' ? audio[0] : (bottomUpVideo.find((t) => fitsTrack(src, t)) ?? audio[0])
  if (!track) return
  const c = clipFor(newId(), track.id, src.source, src, at)
  c.start = freeStart(e.clips, track.id, c.start, clipLength(c))
  // a video on an audio track is there for its sound
  if (track.kind === 'audio') delete c.useAudio
  editor.update((x) => ({ ...x, clips: [...x.clips, c] }))
  return c.id
}

export function Timeline({
  editor,
  sources,
  selected,
  onSelect,
  selectedEdge,
  onSelectEdge,
  pps,
  setPps,
  snapOn,
}: {
  editor: Editor
  sources: Map<string, SourceItem>
  selected?: string
  onSelect: (id?: string) => void
  /** a transition of the selected clip is selected (Delete removes it) */
  selectedEdge?: 'in' | 'out'
  onSelectEdge: (clipId: string, side?: 'in' | 'out') => void
  pps: number
  setPps: (v: number) => void
  snapOn: boolean
}) {
  const edit = editor.edit!
  const seek = usePlayback((s) => s.seek)
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<Drag>(undefined)
  const [invalidId, setInvalidId] = useState<string>()
  const [dropTrack, setDropTrack] = useState<string>()
  const width = Math.max(timelineEnd(edit) + 30, 60) * pps
  const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 600

  // Ctrl/⌘ + wheel zooms around the pointer (non-passive listener, so the page does not zoom)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left - HEADER_W + el.scrollLeft
      const at = x / pps
      const next = Math.min(400, Math.max(4, pps * (e.deltaY < 0 ? 1.2 : 1 / 1.2)))
      setPps(next)
      requestAnimationFrame(() => (el.scrollLeft = at * next - (e.clientX - rect.left - HEADER_W)))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [pps, setPps])

  // keep the playhead in view while playing
  useEffect(
    () =>
      usePlayback.subscribe((s) => {
        const el = scroller.current
        if (!el || !s.playing) return
        const x = s.t * pps
        const view = el.clientWidth - HEADER_W
        if (x < el.scrollLeft || x > el.scrollLeft + view - 40) el.scrollLeft = Math.max(0, x - view * 0.2)
      }),
    [pps],
  )

  // ---------- transitions ----------
  const putTransition = (clipId: string, side: 'in' | 'out', tr: Transition | undefined, history = true) =>
    editor.update((x) => ({ ...x, clips: setTransition(x.clips, clipId, side, tr) }), history)

  function dropTransition(c: Clip, side: 'in' | 'out', type: TransitionType) {
    const len = clipLength(c)
    putTransition(c.id, side, { type, duration: Math.min(DEFAULT_TRANSITION_S, Math.max(0.1, len / 2)) })
    onSelectEdge(c.id, side)
  }

  const timeAt = (clientX: number, lane: Element) => Math.max(0, (clientX - lane.getBoundingClientRect().left) / pps)

  // ---------- clips: move / trim ----------
  function onClipDown(e: React.PointerEvent, c: Clip) {
    if (e.button !== 0) return
    e.stopPropagation()
    onSelect(c.id)
    const edge = (e.target as HTMLElement).dataset.edge as 'start' | 'end' | undefined
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { id: c.id, mode: edge ?? 'move', x0: e.clientX, y0: e.clientY, orig: c, others: edit.clips.filter((x) => x.id !== c.id), started: false, invalid: false }
  }

  function onClipMove(e: React.PointerEvent) {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x0
    if (!d.started) {
      if (Math.abs(dx) < 3 && Math.abs(e.clientY - d.y0) < 4) return
      d.started = true
      editor.checkpoint()
    }
    const src = sources.get(sourceKey(d.orig.source))
    const dt = dx / pps
    const pts = snapOn ? snapPoints(d.others, undefined, usePlayback.getState().t) : []
    const tol = SNAP_PX / pps
    let next: Clip
    if (d.mode === 'move') {
      const len = clipLength(d.orig)
      let start = Math.max(0, d.orig.start + dt)
      if (snapOn) {
        // snap whichever edge is closer to something (compare the edges, not start vs end-len: floats)
        const a = snap(start, pts, tol)
        const endAt = start + len
        const b = snap(endAt, pts, tol)
        const da = a !== start ? Math.abs(a - start) : Infinity
        const db = b !== endAt ? Math.abs(b - endAt) : Infinity
        if (da <= db && da !== Infinity) start = a
        else if (db !== Infinity) start = Math.max(0, b - len)
      }
      let trackId = d.orig.trackId
      const lane = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-track]')
      const over = edit.tracks.find((t) => t.id === lane?.dataset.track)
      const from = edit.tracks.find((t) => t.id === d.orig.trackId)
      if (over && (src ? fitsTrack(src, over) : over.kind === from?.kind)) trackId = over.id
      next = { ...d.orig, start, trackId }
      // moving a video onto an audio track keeps only its sound, and back
      if (from && over && from.kind !== over.kind && trackId === over.id) next.useAudio = over.kind === 'video' ? !!src?.hasAudio : undefined
    } else {
      const edgeAt = (d.mode === 'start' ? d.orig.start : clipEnd(d.orig)) + dt
      next = trimClip(d.orig, d.mode, snapOn ? snap(edgeAt, pts, tol) : edgeAt, src?.duration)
    }
    d.invalid = overlaps(d.others, next)
    setInvalidId(d.invalid ? d.id : undefined)
    editor.update((x) => ({ ...x, clips: x.clips.map((c) => (c.id === d.id ? next : c)) }), false)
  }

  function onClipUp() {
    const d = drag.current
    drag.current = undefined
    setInvalidId(undefined)
    if (d?.started && d.invalid) editor.revert()
  }

  // ---------- ruler / lanes: seek, drop ----------
  function scrub(e: React.PointerEvent) {
    if (e.button !== 0) return
    const lane = e.currentTarget as HTMLElement
    lane.setPointerCapture(e.pointerId)
    seek(timeAt(e.clientX, lane))
    const move = (ev: PointerEvent) => seek(timeAt(ev.clientX, lane))
    const up = () => {
      lane.removeEventListener('pointermove', move)
      lane.removeEventListener('pointerup', up)
    }
    lane.addEventListener('pointermove', move)
    lane.addEventListener('pointerup', up)
  }

  function onDrop(e: React.DragEvent, track: Track) {
    setDropTrack(undefined)
    const key = e.dataTransfer.getData(DND_TYPE)
    const src = sources.get(key)
    if (!src) return
    e.preventDefault()
    let at = timeAt(e.clientX, e.currentTarget)
    if (snapOn) at = snap(at, snapPoints(edit.clips, undefined, usePlayback.getState().t), SNAP_PX / pps)
    const id = placeSource(editor, src, at, track.id)
    if (id) onSelect(id)
  }

  // ---------- tracks ----------
  const toggleMute = (id: string) => editor.update((x) => ({ ...x, tracks: x.tracks.map((t) => (t.id === id ? { ...t, muted: !t.muted || undefined } : t)) }))
  async function removeTrack(t: Track) {
    const n = edit.clips.filter((c) => c.trackId === t.id).length
    if (n && !(await confirmAction({ title: `Remove track ${t.name}?`, message: `Its ${n} clip${n > 1 ? 's' : ''} will be taken off the timeline (Ctrl+Z brings them back).`, confirmLabel: 'Remove track' })))
      return
    editor.update((x) => ({ ...x, tracks: x.tracks.filter((y) => y.id !== t.id), clips: x.clips.filter((c) => c.trackId !== t.id) }))
  }
  const addTrack = (kind: Track['kind']) =>
    editor.update((x) => {
      const t: Track = { id: newId(), kind, name: nextTrackName(x.tracks, kind) }
      // new video tracks go on top (they cover the others), new audio tracks at the bottom
      return { ...x, tracks: kind === 'video' ? [t, ...x.tracks] : [...x.tracks, t] }
    })

  const ticks: number[] = []
  for (let s = 0; s * pps < width; s += step) ticks.push(s)
  const lastVideo = edit.tracks.findLastIndex((t) => t.kind === 'video')

  return (
    <div ref={scroller} className="relative h-full overflow-auto overscroll-contain bg-neutral-950 select-none">
      <div className="relative min-h-full" style={{ width: HEADER_W + width }}>
        {/* ruler */}
        <div className="sticky top-0 z-20 flex h-7 border-b border-white/10 bg-neutral-950">
          <div className="sticky left-0 z-40 shrink-0 border-r border-white/10 bg-neutral-950" style={{ width: HEADER_W }}>
            <Clock fps={edit.fps} />
          </div>
          <div className="relative cursor-text" style={{ width }} onPointerDown={scrub}>
            {ticks.map((s) => (
              <div key={s} className="absolute bottom-0 top-0 border-l border-white/15" style={{ left: s * pps }}>
                <span className="absolute left-1 top-0.5 font-mono text-[10px] text-white/45">{formatTick(s, step)}</span>
              </div>
            ))}
          </div>
        </div>

        {edit.tracks.map((track, i) => {
          const clips = edit.clips.filter((c) => c.trackId === track.id)
          const last = edit.tracks.filter((t) => t.kind === track.kind).length <= 1
          return (
            <div key={track.id} className={cn('flex border-b border-white/[0.06]', i === lastVideo && 'border-b-2 border-b-white/15')} style={{ height: ROW_H[track.kind] }}>
              <div
                className={cn(
                  'sticky left-0 z-30 flex shrink-0 items-center gap-1 border-r border-white/10 px-2 text-[12px]',
                  track.kind === 'video' ? 'bg-neutral-900' : 'bg-[#141a17]',
                )}
                style={{ width: HEADER_W }}
              >
                <span className={cn('w-7 font-mono font-semibold', track.muted ? 'text-white/30' : track.kind === 'video' ? 'text-sky-300' : 'text-emerald-300')}>{track.name}</span>
                <button
                  type="button"
                  onClick={() => toggleMute(track.id)}
                  className={cn('rounded p-1 hover:bg-white/10', track.muted ? 'text-rose-300' : 'text-white/50')}
                  title={track.kind === 'video' ? (track.muted ? 'Show track' : 'Hide track') : track.muted ? 'Unmute' : 'Mute'}
                >
                  {track.kind === 'video' ? (track.muted ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />) : track.muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
                </button>
                <button
                  type="button"
                  disabled={last}
                  onClick={() => void removeTrack(track)}
                  className="ml-auto rounded p-1 text-white/30 hover:bg-white/10 hover:text-rose-300 disabled:invisible"
                  title="Remove track"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
              <div
                data-track={track.id}
                className={cn('relative', track.muted && 'opacity-45', dropTrack === track.id && 'bg-white/[0.06]')}
                style={{ width }}
                onPointerDown={(e) => {
                  onSelect(undefined)
                  scrub(e)
                }}
                onDragOver={(e) => {
                  if (!e.dataTransfer.types.includes(DND_TYPE)) return
                  e.preventDefault()
                  e.dataTransfer.dropEffect = 'copy'
                  if (dropTrack !== track.id) setDropTrack(track.id)
                }}
                onDragLeave={() => setDropTrack(undefined)}
                onDrop={(e) => onDrop(e, track)}
              >
                {clips.map((c) => (
                  <ClipBox
                    key={c.id}
                    clip={c}
                    track={track}
                    src={sources.get(sourceKey(c.source))}
                    pps={pps}
                    selected={selected === c.id}
                    selectedEdge={selected === c.id ? selectedEdge : undefined}
                    invalid={invalidId === c.id}
                    onPointerDown={(e) => onClipDown(e, c)}
                    onPointerMove={onClipMove}
                    onPointerUp={onClipUp}
                    onSelectEdge={(side) => onSelectEdge(c.id, side)}
                    onDropTransition={(side, type) => dropTransition(c, side, type)}
                    onResizeTransition={(side, duration, first) => {
                      const tr = side === 'in' ? c.transitionIn : c.transitionOut
                      if (tr) putTransition(c.id, side, { ...tr, duration }, first)
                    }}
                  />
                ))}
              </div>
            </div>
          )
        })}

        <div className="sticky left-0 flex gap-1 px-2 py-1.5" style={{ width: HEADER_W + 200 }}>
          <button type="button" onClick={() => addTrack('video')} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-white/50 hover:bg-white/10 hover:text-white">
            <Plus className="size-3" /> Video track
          </button>
          <button type="button" onClick={() => addTrack('audio')} className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] text-white/50 hover:bg-white/10 hover:text-white">
            <Plus className="size-3" /> Audio track
          </button>
        </div>

        <Playhead pps={pps} />
      </div>
    </div>
  )
}

function formatTick(s: number, step: number) {
  const m = Math.floor(s / 60)
  const sec = s % 60
  const secText = step < 1 ? sec.toFixed(2).padStart(5, '0') : String(Math.floor(sec)).padStart(2, '0')
  return `${m}:${secText}`
}

function Clock({ fps }: { fps: number }) {
  const t = usePlayback((s) => s.t)
  return <div className="flex h-full items-center px-2 font-mono text-[11px] text-amber-200/90">{formatTimecode(t, fps)}</div>
}

function Playhead({ pps }: { pps: number }) {
  const t = usePlayback((s) => s.t)
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-[25] w-px bg-rose-400" style={{ left: HEADER_W + t * pps }}>
      <div className="absolute -left-[5px] top-0 size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-rose-400" />
    </div>
  )
}

function ClipBox({
  clip,
  track,
  src,
  pps,
  selected,
  selectedEdge,
  invalid,
  onSelectEdge,
  onDropTransition,
  onResizeTransition,
  ...handlers
}: {
  clip: Clip
  track: Track
  src?: SourceItem
  pps: number
  selected: boolean
  selectedEdge?: 'in' | 'out'
  invalid: boolean
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
  onSelectEdge: (side: 'in' | 'out') => void
  onDropTransition: (side: 'in' | 'out', type: TransitionType) => void
  /** `first` = the first step of a drag (one undo step per drag) */
  onResizeTransition: (side: 'in' | 'out', duration: number, first: boolean) => void
}) {
  const w = Math.max(4, clipLength(clip) * pps)
  const asSound = track.kind === 'audio'
  // an effect dragged over the clip: which edge it would land on
  const [dropSide, setDropSide] = useState<'in' | 'out'>()
  const sideAt = (e: React.DragEvent) => (e.clientX - e.currentTarget.getBoundingClientRect().left < w / 2 ? 'in' : 'out')
  const Icon = !src ? Film : asSound || src.media === 'audio' ? Music : src.media === 'image' ? ImageIcon : Film
  const color = !src
    ? 'bg-rose-950/80 ring-1 ring-rose-400/60'
    : asSound
      ? 'bg-emerald-800/70'
      : src.media === 'image'
        ? 'bg-violet-800/70'
        : 'bg-sky-800/70'
  return (
    <div
      {...handlers}
      onPointerCancel={handlers.onPointerUp}
      onDragOver={(e) => {
        if (asSound || !e.dataTransfer.types.includes(DND_TRANSITION)) return
        e.preventDefault()
        e.stopPropagation()
        e.dataTransfer.dropEffect = 'copy'
        const side = sideAt(e)
        if (side !== dropSide) setDropSide(side)
      }}
      onDragLeave={() => setDropSide(undefined)}
      onDrop={(e) => {
        const type = e.dataTransfer.getData(DND_TRANSITION) as TransitionType
        setDropSide(undefined)
        if (asSound || !type) return
        e.preventDefault()
        e.stopPropagation()
        onDropTransition(sideAt(e), type)
      }}
      className={cn(
        'group absolute bottom-1 top-1 cursor-grab touch-none overflow-hidden rounded-md text-[11px] text-white/90 shadow active:cursor-grabbing',
        color,
        selected && 'ring-2 ring-amber-300',
        invalid && 'opacity-60 ring-2 ring-rose-500',
      )}
      style={{ left: clip.start * pps, width: w }}
      title={src ? `${src.label}\n${clipLength(clip).toFixed(2)} s (source ${clip.in.toFixed(2)}–${clip.out.toFixed(2)} s)` : 'Source deleted - remove this clip'}
    >
      {!asSound && src?.thumb && (
        <div
          className="absolute inset-0 opacity-55"
          style={{ backgroundImage: `url(${src.thumb})`, backgroundSize: 'auto 100%', backgroundRepeat: 'repeat-x' }}
        />
      )}
      {asSound && <div className="absolute inset-x-0 top-1/2 h-px bg-white/25" />}
      <div className="relative flex items-center gap-1 truncate bg-gradient-to-b from-black/60 to-transparent px-1.5 py-0.5">
        <Icon className="size-3 shrink-0 opacity-80" />
        <span className="truncate">{src ? src.label : 'missing source'}</span>
        {!asSound && src?.hasAudio && clip.useAudio !== false && <Volume2 className="size-3 shrink-0 opacity-70" />}
        {clip.volume !== 1 && <span className="shrink-0 opacity-70">{Math.round(clip.volume * 100)}%</span>}
      </div>
      {!asSound &&
        (['in', 'out'] as const).map((side) => {
          const tr = side === 'in' ? clip.transitionIn : clip.transitionOut
          return tr ? (
            <TransitionMark
              key={side}
              side={side}
              tr={tr}
              len={clipLength(clip)}
              pps={pps}
              selected={selectedEdge === side}
              onSelect={() => onSelectEdge(side)}
              onResize={(d, first) => onResizeTransition(side, d, first)}
            />
          ) : null
        })}
      {dropSide && (
        <div
          className={cn('pointer-events-none absolute bottom-0 top-0 w-1/2 bg-fuchsia-400/30 ring-2 ring-inset ring-fuchsia-300', dropSide === 'in' ? 'left-0' : 'right-0')}
        />
      )}
      <div data-edge="start" className="absolute bottom-0 left-0 top-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 group-hover:bg-white/15" />
      <div data-edge="end" className="absolute bottom-0 right-0 top-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/30 group-hover:bg-white/15" />
    </div>
  )
}

const SHORT: Record<TransitionType, string> = { cross: 'CD', additive: 'AD', blur: 'BD' }

/**
 * A transition on a clip edge, DaVinci style: a striped block over the first / last seconds. Click selects it
 * (Delete removes it), dragging its inner edge changes the length.
 */
function TransitionMark({
  side,
  tr,
  len,
  pps,
  selected,
  onSelect,
  onResize,
}: {
  side: 'in' | 'out'
  tr: Transition
  len: number
  pps: number
  selected: boolean
  onSelect: () => void
  onResize: (duration: number, first: boolean) => void
}) {
  const w = Math.max(6, Math.min(tr.duration, len) * pps)
  const drag = useRef<{ x0: number; d0: number; first: boolean }>(undefined)
  return (
    <div
      className={cn(
        'absolute bottom-0 top-0 z-[1] flex cursor-pointer items-end justify-center overflow-hidden border-white/50 pb-0.5 text-[9.5px] font-semibold text-white',
        side === 'in' ? 'left-0 rounded-l-md border-r' : 'right-0 rounded-r-md border-l',
        selected ? 'bg-fuchsia-500/60 ring-2 ring-inset ring-fuchsia-200' : 'bg-fuchsia-500/35 hover:bg-fuchsia-500/50',
      )}
      style={{
        width: w,
        backgroundImage: 'repeating-linear-gradient(135deg, rgba(255,255,255,0.18) 0 4px, transparent 4px 9px)',
      }}
      title={`${TRANSITION_LABEL[tr.type]} · ${tr.duration.toFixed(2)} s on the clip ${side === 'in' ? 'start' : 'end'}\nClick to select (Delete removes it), drag its inner edge to change the length`}
      onPointerDown={(e) => {
        if (e.button !== 0) return
        e.stopPropagation()
        onSelect()
      }}
    >
      {w > 22 && <span className="drop-shadow">{SHORT[tr.type]}</span>}
      <div
        className={cn('absolute bottom-0 top-0 w-1.5 cursor-ew-resize touch-none hover:bg-white/50', side === 'in' ? 'right-0' : 'left-0')}
        onPointerDown={(e) => {
          if (e.button !== 0) return
          e.stopPropagation()
          onSelect()
          ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
          drag.current = { x0: e.clientX, d0: tr.duration, first: true }
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (!d) return
          const dx = (e.clientX - d.x0) / pps
          const next = Math.min(MAX_TRANSITION_S, len, Math.max(0.1, d.d0 + (side === 'in' ? dx : -dx)))
          onResize(Math.round(next * 100) / 100, d.first)
          d.first = false
        }}
        onPointerUp={() => (drag.current = undefined)}
        onPointerCancel={() => (drag.current = undefined)}
      />
    </div>
  )
}
