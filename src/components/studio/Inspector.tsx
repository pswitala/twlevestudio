import { useRef, useState } from 'react'
import { Download, Loader2, Scissors, Trash2, Volume2, VolumeX } from 'lucide-react'
import {
  canvasSize,
  clipEnd,
  clipLength,
  DEFAULT_TRANSITION_S,
  EDIT_FPS,
  MAX_TRANSITION_S,
  neighbours,
  overlaps,
  setTransition,
  timelineEnd,
  TRANSITIONS,
  type Clip,
  type Edit,
  type EditAspect,
  type EditResolution,
  type TransitionType,
} from '../../../shared/studio'
import { useGenerations, useInvalidate } from '../../hooks/queries'
import { api, fileUrl } from '../../lib/api'
import { cn, elapsed, formatDuration, timeAgo } from '../../lib/utils'
import { useUi } from '../../stores/ui'
import { type SourceItem, sourceKey } from './sources'
import type { Editor } from './useEditor'

const label = 'text-[11px] uppercase tracking-wide text-white/40'
const field = 'w-full rounded-lg bg-white/[0.06] px-2 py-1 text-[12.5px] text-white/85 focus:bg-white/10 focus:outline-none'

export function Inspector({
  editor,
  sources,
  selected,
  selectedEdge,
  onSplit,
  onDelete,
  className,
}: {
  editor: Editor
  sources: Map<string, SourceItem>
  selected?: Clip
  selectedEdge?: 'in' | 'out'
  onSplit: () => void
  onDelete: () => void
  className?: string
}) {
  const edit = editor.edit!
  return (
    <div className={cn('flex min-h-0 flex-col gap-3 p-3', className)}>
      {selected ? (
        <ClipInspector editor={editor} clip={selected} src={sources.get(sourceKey(selected.source))} selectedEdge={selectedEdge} onSplit={onSplit} onDelete={onDelete} />
      ) : (
        <EditInspector edit={edit} editor={editor} />
      )}
      <Exports edit={edit} />
    </div>
  )
}

function ClipInspector({
  editor,
  clip,
  src,
  selectedEdge,
  onSplit,
  onDelete,
}: {
  editor: Editor
  clip: Clip
  src?: SourceItem
  selectedEdge?: 'in' | 'out'
  onSplit: () => void
  onDelete: () => void
}) {
  const notify = useUi((s) => s.notify)
  const edit = editor.edit!
  const track = edit.tracks.find((t) => t.id === clip.trackId)
  const onVideo = track?.kind === 'video'
  const audible = src?.hasAudio && (!onVideo || clip.useAudio !== false)
  const volumeGesture = useRef(false)

  /** numeric field change that must not overlap a neighbour or leave the source */
  const set = (patch: Partial<Clip>) => {
    const next = { ...clip, ...patch }
    if (next.out - next.in < 0.1) return notify('A clip must be at least 0.1 s long', 'error')
    if (src?.duration !== undefined && (next.in < 0 || next.out > src.duration + 1e-3)) return notify(`The source is ${src.duration.toFixed(2)} s long`, 'error')
    if (overlaps(edit.clips, next)) return notify('That would overlap the next clip on this track', 'error')
    editor.update((e) => ({ ...e, clips: e.clips.map((c) => (c.id === clip.id ? next : c)) }))
  }

  return (
    <section className="flex flex-col gap-2.5">
      <div>
        <p className={label}>Clip · {track?.name}</p>
        <p className="mt-0.5 line-clamp-2 text-[13px] text-white/90" title={src?.label}>
          {src?.label ?? <span className="text-rose-300">Source deleted</span>}
        </p>
        {src && (
          <p className="text-[11.5px] text-white/40">
            {src.origin === 'generated' ? 'generated' : src.origin === 'library' ? 'library ref' : 'imported'} · {src.media}
            {src.duration !== undefined ? ` · source ${formatDuration(src.duration)}` : ''}
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Num label="Start" value={clip.start} onCommit={(v) => set({ start: Math.max(0, v) })} />
        <Num label="In" value={clip.in} onCommit={(v) => set({ in: v })} />
        <Num label="Out" value={clip.out} onCommit={(v) => set({ out: v })} />
      </div>
      <p className="-mt-1 text-[11.5px] text-white/45">
        Length {clipLength(clip).toFixed(2)} s · ends at {clipEnd(clip).toFixed(2)} s
      </p>

      {src?.hasAudio && (
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <p className={label}>Sound</p>
            {onVideo && (
              <button
                type="button"
                onClick={() => editor.update((e) => ({ ...e, clips: e.clips.map((c) => (c.id === clip.id ? { ...c, useAudio: clip.useAudio === false } : c)) }))}
                className={cn('ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px]', audible ? 'bg-white/10 text-white/85' : 'bg-rose-500/15 text-rose-200')}
                title="Use this clip's own sound in the mix"
              >
                {audible ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />} {audible ? 'Clip audio on' : 'Clip audio off'}
              </button>
            )}
          </div>
          <label className={cn('flex items-center gap-2 text-[12px] text-white/60', !audible && 'opacity-40')}>
            <input
              type="range"
              min={0}
              max={200}
              step={5}
              disabled={!audible}
              value={Math.round(clip.volume * 100)}
              // one undo step per slider gesture (mouse drag or arrow keys while focused)
              onFocus={() => (volumeGesture.current = false)}
              onBlur={() => (volumeGesture.current = false)}
              onPointerDown={() => (volumeGesture.current = false)}
              onChange={(e) => {
                const volume = Number(e.target.value) / 100
                editor.update((x) => ({ ...x, clips: x.clips.map((c) => (c.id === clip.id ? { ...c, volume } : c)) }), !volumeGesture.current)
                volumeGesture.current = true
              }}
              className="flex-1 accent-emerald-300"
            />
            <span className="w-10 text-right font-mono">{Math.round(clip.volume * 100)}%</span>
          </label>
          {clip.volume > 1 && <p className="text-[11px] text-white/35">Above 100% is heard in the export only - the browser preview stops at 100%.</p>}
        </div>
      )}

      {onVideo && <Transitions editor={editor} clip={clip} selectedEdge={selectedEdge} />}

      <div className="flex gap-1.5">
        <button type="button" onClick={onSplit} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.08] px-2 py-1.5 text-[12.5px] hover:bg-white/15" title="Split at the playhead (S)">
          <Scissors className="size-3.5" /> Split
        </button>
        <button type="button" onClick={onDelete} className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/[0.08] px-2 py-1.5 text-[12.5px] hover:bg-rose-500/25" title="Remove from the timeline (Delete) - Ctrl+Z brings it back">
          <Trash2 className="size-3.5" /> Remove
        </button>
      </div>
    </section>
  )
}

/** Number field that commits on Enter / blur (typing "1." must not jump around). */
function Num({ label: text, value, onCommit }: { label: string; value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState<string>()
  const commit = () => {
    if (draft === undefined) return
    const v = Number(draft.replace(',', '.'))
    setDraft(undefined)
    if (Number.isFinite(v) && Math.abs(v - value) > 1e-4) onCommit(v)
  }
  return (
    <label className="flex flex-col gap-0.5">
      <span className={label}>{text}</span>
      <input
        inputMode="decimal"
        value={draft ?? value.toFixed(2)}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') setDraft(undefined)
          e.stopPropagation()
        }}
        className={cn(field, 'font-mono')}
      />
    </label>
  )
}

function EditInspector({ edit, editor }: { edit: Edit; editor: Editor }) {
  const { w, h } = canvasSize(edit.aspect, edit.resolution)
  const total = timelineEnd(edit)
  const set = (patch: Partial<Edit>) => editor.update((e) => ({ ...e, ...patch }))
  return (
    <section className="flex flex-col gap-2.5">
      <p className={label}>Output</p>
      <div className="grid grid-cols-3 gap-1.5">
        <select value={edit.aspect} onChange={(e) => set({ aspect: e.target.value as EditAspect })} className={field} title="Frame shape">
          {(['9:16', '16:9', '1:1'] as const).map((a) => (
            <option key={a} value={a} className="bg-neutral-900">{a}</option>
          ))}
        </select>
        <select value={edit.resolution} onChange={(e) => set({ resolution: e.target.value as EditResolution })} className={field}>
          {(['720p', '1080p'] as const).map((r) => (
            <option key={r} value={r} className="bg-neutral-900">{r}</option>
          ))}
        </select>
        <select value={edit.fps} onChange={(e) => set({ fps: Number(e.target.value) })} className={field} title="Frames per second">
          {EDIT_FPS.map((f) => (
            <option key={f} value={f} className="bg-neutral-900">{f} fps</option>
          ))}
        </select>
      </div>
      <p className="text-[11.5px] leading-relaxed text-white/45">
        {w}×{h} · {formatDuration(total) || '0s'} · {edit.clips.length} clip{edit.clips.length === 1 ? '' : 's'}. Clips of another shape are fitted inside the frame;
        an upper track covers the lower ones.
      </p>
      <p className="text-[11.5px] leading-relaxed text-white/35">
        Select a clip to trim it, set its volume or switch its sound. Space plays, S splits at the playhead, Delete removes, Ctrl+Z undoes, Ctrl+wheel zooms.
      </p>
    </section>
  )
}

function Exports({ edit }: { edit: Edit }) {
  const { data: generations = [] } = useGenerations()
  const { select, notify } = useUi()
  const invalidate = useInvalidate()
  const [busy, setBusy] = useState(false)
  const exports = generations.filter((g) => g.studio?.editId === edit.id)

  async function run() {
    setBusy(true)
    try {
      // the autosave may still be pending: render what is on screen, not the last save
      await api.saveEdit(edit)
      await api.exportEdit(edit.id)
      await invalidate('generations')
      notify('Rendering - the video lands in the gallery of this project')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2 border-t border-white/10 pt-3">
      <button
        type="button"
        disabled={busy || !edit.clips.length}
        onClick={() => void run()}
        className="flex items-center justify-center gap-2 rounded-xl bg-white px-3 py-2 text-[13px] font-medium text-black hover:bg-white/90 disabled:opacity-40"
        title="Render the timeline to an mp4 (locally, free)"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Export video
      </button>
      {exports.length > 0 && (
        <ul className="flex flex-col gap-1">
          {exports.map((g) => (
            <li key={g.id}>
              <button
                type="button"
                onClick={() => g.status === 'completed' && select(g.id)}
                className="flex w-full items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5"
                title={g.error}
              >
                <div className="size-10 shrink-0 overflow-hidden rounded bg-white/5">{g.thumb && <img src={fileUrl('thumbs', g.thumb)} alt="" className="size-full object-cover" />}</div>
                <div className="min-w-0 flex-1 text-[11.5px]">
                  <p className="truncate text-white/80">{timeAgo(g.createdAt)} · {g.settings.aspectRatio} {g.settings.resolution}</p>
                  <p className={cn('truncate', g.status === 'failed' ? 'text-rose-300' : g.status === 'completed' ? 'text-white/40' : 'text-sky-300')}>
                    {g.status === 'completed' ? formatDuration(g.durationS) : g.status === 'failed' ? g.error : `${g.phase ?? g.status} ${elapsed(g.startedAt)}`}
                  </p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Start / end transition of a video clip: type and length. Where a clip touches it, the dissolve is between the two. */
function Transitions({ editor, clip, selectedEdge }: { editor: Editor; clip: Clip; selectedEdge?: 'in' | 'out' }) {
  const edit = editor.edit!
  const { prev, next } = neighbours(edit.clips, clip)
  const len = clipLength(clip)
  const set = (side: 'in' | 'out', type: TransitionType | '', duration?: number) => {
    const cur = side === 'in' ? clip.transitionIn : clip.transitionOut
    const tr = type ? { type, duration: Math.min(MAX_TRANSITION_S, len, Math.max(0.1, duration ?? cur?.duration ?? Math.min(DEFAULT_TRANSITION_S, len / 2))) } : undefined
    editor.update((e) => ({ ...e, clips: setTransition(e.clips, clip.id, side, tr) }))
  }
  return (
    <div className="flex flex-col gap-1.5">
      <p className={label}>Transitions</p>
      {(['in', 'out'] as const).map((side) => {
        const tr = side === 'in' ? clip.transitionIn : clip.transitionOut
        // one transition per cut - the other clip's side of it counts too
        const fromNeighbour = side === 'in' ? prev?.transitionOut : next?.transitionIn
        const touching = side === 'in' ? prev : next
        return (
          <div key={side} className={cn('rounded-lg p-1.5', selectedEdge === side ? 'bg-fuchsia-500/15 ring-1 ring-fuchsia-300/50' : 'bg-white/[0.03]')}>
            <div className="flex items-center gap-1.5">
              <span className="w-9 text-[11.5px] text-white/55">{side === 'in' ? 'Start' : 'End'}</span>
              <select
                value={tr?.type ?? ''}
                onChange={(e) => set(side, e.target.value as TransitionType | '')}
                className={cn(field, 'min-w-0 flex-1')}
              >
                <option value="" className="bg-neutral-900">None</option>
                {TRANSITIONS.map((t) => (
                  <option key={t.type} value={t.type} className="bg-neutral-900">{t.label}</option>
                ))}
              </select>
              {tr && (
                <div className="w-14 shrink-0" title="Length in seconds">
                  <Num label="" value={tr.duration} onCommit={(v) => set(side, tr.type, v)} />
                </div>
              )}
            </div>
            <p className="mt-1 text-[10.5px] leading-snug text-white/35">
              {fromNeighbour && !tr
                ? `The ${side === 'in' ? 'previous' : 'next'} clip has a transition on this cut.`
                : touching
                  ? side === 'in'
                    ? 'Touches the previous clip: dissolves over it after the cut.'
                    : 'Touches the next clip: it dissolves in before the cut.'
                  : side === 'in'
                    ? 'Free edge: dissolves in from what is under it (black or a lower track); the sound fades in.'
                    : 'Free edge: dissolves out to what is under it; the sound fades out.'}
            </p>
          </div>
        )
      })}
    </div>
  )
}
