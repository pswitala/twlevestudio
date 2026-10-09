import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  ChevronDown,
  Clapperboard,
  Copy,
  FolderInput,
  Loader2,
  Magnet,
  Pause,
  Play,
  Plus,
  Redo2,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import {
  clipEnd,
  clipLength,
  DEFAULT_TRANSITION_S,
  formatTimecode,
  setTransition,
  shortId,
  splitClip,
  timelineEnd,
  trackEnd,
  type Edit,
  type TransitionType,
} from '../../../shared/studio'
import { DEFAULT_PROJECT_ID } from '../../../shared/types'
import { useEdits, useInvalidate, useProjects } from '../../hooks/queries'
import { api } from '../../lib/api'
import { cn, timeAgo } from '../../lib/utils'
import { activeProjectId, useUi } from '../../stores/ui'
import { ProjectTargetMenu } from '../assets/ProjectTargetMenu'
import { confirmAction } from '../ConfirmDialog'
import { MenuItem, Popover } from '../Popover'
import { Inspector } from './Inspector'
import { MediaBin } from './MediaBin'
import { PreviewPlayer } from './PreviewPlayer'
import { sourceKey, usePlayback, useSources } from './sources'
import { placeSource, Timeline } from './Timeline'
import { useEditor } from './useEditor'

/** Studio: timelines ("edits") of the open project - combine generated clips, library media and imports, export to mp4. */
export function StudioView() {
  const { projectId, editId, setEditId, notify } = useUi()
  const { data: edits = [], isLoading } = useEdits()
  const { data: projects = [] } = useProjects()
  const invalidate = useInvalidate()

  const inView = useMemo(
    () => edits.filter((e) => !projectId || e.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [edits, projectId],
  )
  const current = inView.find((e) => e.id === editId) ?? inView[0]

  async function create() {
    try {
      const e = await api.createEdit(activeProjectId())
      await invalidate('edits')
      setEditId(e.id)
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  if (isLoading) return null
  if (!current) {
    const name = projectId ? (projects.find((p) => p.id === projectId)?.name ?? '') : 'Default'
    return (
      <div className="mx-auto mt-24 max-w-md px-4 text-center text-white/50">
        <Clapperboard className="mx-auto mb-3 size-9 text-white/25" />
        <p className="text-[15px] text-white/75">No edits in {name} yet.</p>
        <p className="mt-1 text-[13px]">
          An edit is a timeline: put generated clips, photos, speech and your own music on video and audio tracks, trim and arrange them, then export one
          video to the gallery.
        </p>
        <button type="button" onClick={() => void create()} className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-white px-4 py-2 text-[13px] font-medium text-black">
          <Plus className="size-4" /> New edit
        </button>
      </div>
    )
  }
  return <Studio key={current.id} source={current} edits={inView} onCreate={() => void create()} />
}

function Studio({ source, edits, onCreate }: { source: Edit; edits: Edit[]; onCreate: () => void }) {
  const { setEditId, notify } = useUi()
  const { data: projects = [] } = useProjects()
  const invalidate = useInvalidate()
  const editor = useEditor(source)
  const edit = editor.edit!
  const { items, byKey } = useSources()
  const [selected, setSelectedClip] = useState<string>()
  /** a transition on the selected clip's start / end is selected (Delete removes the transition, not the clip) */
  const [selectedEdge, setSelectedEdge] = useState<'in' | 'out'>()
  const setSelected = (id?: string) => {
    setSelectedClip(id)
    setSelectedEdge(undefined)
  }
  const [pps, setPps] = useState(40)
  const [snapOn, setSnapOn] = useState(true)
  const playing = usePlayback((s) => s.playing)
  const { seek, setPlaying } = usePlayback.getState()
  const end = timelineEnd(edit)
  const selectedClip = edit.clips.find((c) => c.id === selected)

  const usage = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of edit.clips) m.set(sourceKey(c.source), (m.get(sourceKey(c.source)) ?? 0) + 1)
    return m
  }, [edit.clips])

  // a fresh edit opens at the start, stopped
  useEffect(() => {
    usePlayback.setState({ t: 0, playing: false })
    return () => usePlayback.setState({ playing: false })
  }, [])

  // the clock: playback advances the playhead; media elements follow it
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const t = usePlayback.getState().t + (now - last) / 1000
      last = now
      if (t >= end) {
        usePlayback.setState({ t: end, playing: false })
        return
      }
      usePlayback.setState({ t })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, end])

  const togglePlay = () => {
    if (playing) return setPlaying(false)
    if (usePlayback.getState().t >= end - 0.02) seek(0)
    if (end > 0) setPlaying(true)
  }

  /** S: split the selected clip at the playhead, or every clip under it when none is selected */
  function split() {
    const t = usePlayback.getState().t
    const targets = edit.clips.filter((c) => (selected ? c.id === selected : true) && c.start < t && t < clipEnd(c))
    if (!targets.length) return notify(selected ? 'Move the playhead over the selected clip to split it' : 'No clip under the playhead')
    editor.update((e) => {
      let clips = e.clips
      for (const c of targets) {
        const parts = splitClip(c, t, shortId())
        if (parts) clips = clips.flatMap((x) => (x.id === c.id ? parts : [x]))
      }
      return { ...e, clips }
    })
  }

  function removeSelected() {
    if (!selected) return
    if (selectedEdge) {
      editor.update((e) => ({ ...e, clips: setTransition(e.clips, selected, selectedEdge, undefined) }))
      setSelectedEdge(undefined)
      return
    }
    editor.update((e) => ({ ...e, clips: e.clips.filter((c) => c.id !== selected) }))
    setSelected(undefined)
  }

  /** Effects: put a transition on the selected clip's start / end (the bin's buttons; dragging works too) */
  function applyTransition(side: 'in' | 'out', type: TransitionType) {
    const c = edit.clips.find((x) => x.id === selected)
    if (!c || edit.tracks.find((t) => t.id === c.trackId)?.kind !== 'video') return notify('Select a clip on a video track first')
    editor.update((e) => ({ ...e, clips: setTransition(e.clips, c.id, side, { type, duration: Math.min(DEFAULT_TRANSITION_S, Math.max(0.1, clipLength(c) / 2)) }) }))
    setSelectedEdge(side)
  }

  // keyboard shortcuts (not while typing)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement
      if (el.closest('input, textarea, select, [contenteditable=true]') || useUi.getState().selectedId) return
      const mod = e.ctrlKey || e.metaKey
      const frame = 1 / (edit.fps || 24)
      const t = usePlayback.getState().t
      if (e.code === 'Space') togglePlay()
      else if (mod && e.key.toLowerCase() === 'z') (e.shiftKey ? editor.redo : editor.undo)()
      else if (mod && e.key.toLowerCase() === 'y') editor.redo()
      else if (!mod && e.key.toLowerCase() === 's') split()
      else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
      else if (e.key === 'ArrowLeft') seek(t - (e.shiftKey ? 1 : frame))
      else if (e.key === 'ArrowRight') seek(Math.min(end, t + (e.shiftKey ? 1 : frame)))
      else if (e.key === 'Home') seek(0)
      else if (e.key === 'End') seek(end)
      else if (e.key === 'Escape') setSelected(undefined)
      else if (e.key === '+' || e.key === '=') setPps(Math.min(400, pps * 1.25))
      else if (e.key === '-') setPps(Math.max(4, pps / 1.25))
      else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  async function duplicate() {
    await editor.flush()
    const copy = await api.duplicateEdit(edit.id)
    await invalidate('edits')
    setEditId(copy.id)
  }

  async function remove() {
    const ok = await confirmAction({
      title: `Delete edit “${edit.name}”?`,
      message: 'Only the timeline is deleted. The clips it uses and the videos already exported from it stay.',
      confirmLabel: 'Delete edit',
    })
    if (!ok) return
    await api.deleteEdit(edit.id)
    setEditId(edits.find((e) => e.id !== edit.id)?.id)
    await invalidate('edits')
  }

  async function moveTo(projectId: string) {
    editor.update((e) => ({ ...e, projectId }))
    await editor.flush()
    await invalidate('edits')
    const name = projects.find((p) => p.id === projectId)?.name
    notify(`Moved to ${name} - open that project to see it`)
  }

  const iconBtn = 'rounded-lg p-1.5 text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent'

  return (
    // phones: one scrolling column (bin, preview, inspector, timeline); desktop: everything fits the screen
    <div className="flex h-full min-h-0 flex-col overflow-y-auto md:overflow-hidden">
      {/* edit bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-white/[0.06] px-2 py-1.5 md:px-3">
        <Popover
          side="bottom"
          className="w-72 p-1"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-white/70 hover:bg-white/10" title="Edits in this project">
              <Clapperboard className="size-4 text-fuchsia-300" />
              <ChevronDown className="size-3.5" />
            </button>
          )}
        >
          {(close) => (
            <div className="max-h-[60vh] overflow-y-auto">
              {edits.map((e) => (
                <MenuItem key={e.id} active={e.id === edit.id} onClick={() => (setEditId(e.id), close())}>
                  <span className="min-w-0 flex-1 truncate">{e.name}</span>
                  <span className="shrink-0 text-[11px] text-white/35">{timeAgo(e.updatedAt)}</span>
                </MenuItem>
              ))}
              <div className="my-1 border-t border-white/10" />
              <MenuItem onClick={() => (onCreate(), close())}>
                <Plus className="size-3.5" /> New edit
              </MenuItem>
            </div>
          )}
        </Popover>
        <NameField value={edit.name} onCommit={(name) => editor.update((e) => ({ ...e, name }))} />
        <span className="flex items-center gap-1 text-[11.5px] text-white/35" title="Changes are saved automatically">
          {editor.saving === 'saving' || editor.saving === 'pending' ? <Loader2 className="size-3 animate-spin" /> : editor.saving === 'error' ? null : <Check className="size-3" />}
          <span className={cn('hidden sm:inline', editor.saving === 'error' && 'text-rose-300')}>{editor.saving === 'error' ? 'not saved' : editor.saving === 'idle' ? 'saved' : 'saving'}</span>
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <button type="button" className={iconBtn} disabled={!editor.canUndo} onClick={editor.undo} title="Undo (Ctrl+Z)">
            <Undo2 className="size-4" />
          </button>
          <button type="button" className={iconBtn} disabled={!editor.canRedo} onClick={editor.redo} title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={onCreate} title="New edit">
            <Plus className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={() => void duplicate()} title="Duplicate this edit">
            <Copy className="size-4" />
          </button>
          <div className="text-[12.5px]">
            <ProjectTargetMenu side="bottom" align="right" title="Move this edit to another project" label="" icon={<FolderInput className="size-4" />} projects={projects.filter((p) => p.id !== edit.projectId)} onPick={(id) => void moveTo(id)} />
          </div>
          <button type="button" className={cn(iconBtn, 'hover:text-rose-300')} onClick={() => void remove()} title="Delete this edit">
            <Trash2 className="size-4" />
          </button>
        </div>
      </div>

      {/* bin | preview | inspector */}
      <div className="flex flex-none flex-col md:min-h-0 md:flex-1 md:flex-row">
        <MediaBin
          items={items}
          projectId={edit.projectId || DEFAULT_PROJECT_ID}
          usage={usage}
          canTransition={!!selectedClip && edit.tracks.find((t) => t.id === selectedClip.trackId)?.kind === 'video'}
          onTransition={applyTransition}
          onAdd={(s) => {
            const track = s.media === 'audio' ? edit.tracks.find((t) => t.kind === 'audio') : edit.tracks.filter((t) => t.kind === 'video').at(-1)
            const id = placeSource(editor, s, track ? trackEnd(edit.clips, track.id) : 0, track?.id)
            if (id) setSelected(id)
          }}
          className="h-44 shrink-0 border-b border-white/[0.06] md:h-auto md:w-[300px] md:border-b-0 md:border-r xl:w-[340px]"
        />
        <div className="flex h-[42vh] min-w-0 flex-col md:h-auto md:min-h-[200px] md:flex-1">
          <div className="min-h-0 flex-1 p-2 md:p-3">
            <PreviewPlayer edit={edit} sources={byKey} />
          </div>
          <div className="flex items-center justify-center gap-1 pb-1.5">
            <button type="button" className={iconBtn} onClick={() => seek(0)} title="To start (Home)">
              <SkipBack className="size-4" />
            </button>
            <button type="button" onClick={togglePlay} disabled={!end} className="rounded-full bg-white p-2 text-black hover:bg-white/90 disabled:opacity-30" title="Play / pause (Space)">
              {playing ? <Pause className="size-4 fill-black" /> : <Play className="size-4 fill-black" />}
            </button>
            <button type="button" className={iconBtn} onClick={() => seek(end)} title="To end (End)">
              <SkipForward className="size-4" />
            </button>
            <TimeReadout fps={edit.fps} end={end} />
          </div>
        </div>
        <Inspector
          editor={editor}
          sources={byKey}
          selected={selectedClip}
          selectedEdge={selectedEdge}
          onSplit={split}
          onDelete={removeSelected}
          className="shrink-0 border-t border-white/[0.06] md:w-64 md:overflow-y-auto md:border-l md:border-t-0 xl:w-72"
        />
      </div>

      {/* timeline */}
      <div className="flex h-[55vh] min-h-[190px] shrink-0 flex-col border-t border-white/10 md:h-[38%]">
        <div className="flex items-center gap-0.5 border-b border-white/[0.06] px-2 py-1">
          <button type="button" className={cn(iconBtn, snapOn && 'text-amber-300')} onClick={() => setSnapOn(!snapOn)} title="Snap to clip edges and the playhead">
            <Magnet className="size-4" />
          </button>
          <button type="button" className={iconBtn} onClick={split} title="Split at the playhead (S)">
            <span className="px-0.5 text-[12px]">Split</span>
          </button>
          <span className="ml-auto" />
          <button type="button" className={iconBtn} onClick={() => setPps(Math.max(4, pps / 1.4))} title="Zoom out (-)">
            <ZoomOut className="size-4" />
          </button>
          <input type="range" min={4} max={400} value={pps} onChange={(e) => setPps(Number(e.target.value))} className="w-24 accent-white/70 sm:w-32" title="Zoom (Ctrl+wheel)" />
          <button type="button" className={iconBtn} onClick={() => setPps(Math.min(400, pps * 1.4))} title="Zoom in (+)">
            <ZoomIn className="size-4" />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <Timeline
            editor={editor}
            sources={byKey}
            selected={selected}
            onSelect={setSelected}
            selectedEdge={selectedEdge}
            onSelectEdge={(id, side) => {
              setSelectedClip(id)
              setSelectedEdge(side)
            }}
            pps={pps}
            setPps={setPps}
            snapOn={snapOn}
          />
        </div>
      </div>
    </div>
  )
}

function TimeReadout({ fps, end }: { fps: number; end: number }) {
  const t = usePlayback((s) => s.t)
  return (
    <span className="ml-2 font-mono text-[11.5px] text-white/50">
      <span className="text-white/85">{formatTimecode(t, fps)}</span> / {formatTimecode(end, fps)}
    </span>
  )
}

function NameField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState<string>()
  const commit = () => {
    const v = draft?.trim()
    setDraft(undefined)
    if (v && v !== value) onCommit(v)
  }
  return (
    <input
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setDraft(undefined)
      }}
      className="min-w-0 max-w-64 flex-1 rounded-lg bg-transparent px-1.5 py-1 text-[14px] font-medium text-white/90 hover:bg-white/[0.05] focus:bg-white/[0.08] focus:outline-none"
      title="Rename"
    />
  )
}
