import { useMemo, useRef, useState } from 'react'
import { Film, Image as ImageIcon, Loader2, Music, Plus, Search, Sparkles, Trash2, Upload } from 'lucide-react'
import { useInvalidate, useProjects } from '../../hooks/queries'
import { api } from '../../lib/api'
import { cn, formatDuration } from '../../lib/utils'
import { useUi } from '../../stores/ui'
import { confirmAction } from '../ConfirmDialog'
import { TRANSITIONS, type TransitionType } from '../../../shared/studio'
import { DND_TRANSITION, DND_TYPE, type SourceItem } from './sources'

type Tab = 'video' | 'image' | 'audio' | 'effects'

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|wma|aif|aiff|amr)$/i
const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)
const TABS: { key: Tab; label: string; icon: typeof Film }[] = [
  { key: 'video', label: 'Video', icon: Film },
  { key: 'image', label: 'Photos', icon: ImageIcon },
  { key: 'audio', label: 'Audio', icon: Music },
  { key: 'effects', label: 'Effects', icon: Sparkles },
]
const ORIGIN: Record<SourceItem['origin'], string> = { generated: 'generated', library: 'library', import: 'imported' }

/**
 * Everything that can go on the timeline: the gallery's finished videos / photos / speech, library refs and
 * Studio imports (own footage, music). Drag onto a track, or "+" to append at the end of the first fitting track.
 */
export function MediaBin({
  items,
  projectId,
  usage,
  onAdd,
  canTransition,
  onTransition,
  className,
}: {
  items: SourceItem[]
  /** the edit's project */
  projectId: string
  /** how many clips of the open edit use each source key */
  usage: Map<string, number>
  onAdd: (s: SourceItem) => void
  /** a clip on a video track is selected - Effects can go on its start / end */
  canTransition: boolean
  onTransition: (side: 'in' | 'out', type: TransitionType) => void
  className?: string
}) {
  const notify = useUi((s) => s.notify)
  const invalidate = useInvalidate()
  const { data: projects = [] } = useProjects()
  const [tab, setTab] = useState<Tab>('video')
  const [scope, setScope] = useState<'project' | 'all'>('project')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter(
      (i) =>
        i.media === tab &&
        (scope === 'all' || i.projectId === projectId) &&
        (!needle || i.label.toLowerCase().includes(needle)),
    )
  }, [items, tab, scope, projectId, q])

  async function importFiles(files: File[]) {
    if (!files.length) return
    setBusy(true)
    try {
      // Music / sound goes to the library (Library › Audio: tags, copy / move between projects); footage and
      // photos stay Studio imports, because library videos are 3 s refs.
      const audio = files.filter(isAudioFile)
      const rest = files.filter((f) => !isAudioFile(f))
      const errors: string[] = []
      let done = 0
      if (audio.length) {
        done += (await api.upload(audio, { projectId })).length
        await invalidate('assets')
        setTab('audio')
      }
      if (rest.length) {
        const r = await api.importStudioMedia(rest, projectId)
        await invalidate('studio-media')
        done += r.media.length
        errors.push(...r.errors)
        const kinds = new Set(r.media.map((m) => m.kind))
        if (!audio.length && kinds.size === 1) setTab([...kinds][0])
      }
      notify(errors.length ? `Imported ${done}, skipped: ${errors.join(' · ')}` : `Imported ${done} file${done > 1 ? 's' : ''}${audio.length ? ' (audio is in Library › Audio)' : ''}`, errors.length ? 'error' : 'info')
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
      if (file.current) file.current.value = ''
    }
  }

  async function remove(i: SourceItem) {
    const used = usage.get(i.key) ?? 0
    const ok = await confirmAction({
      title: `Delete “${i.label}”?`,
      message: `The imported file is deleted from disk.${used ? ` ${used} clip${used > 1 ? 's' : ''} in this edit will show as missing.` : ''} Clips in other edits that use it go missing too.`,
      confirmLabel: 'Delete',
    })
    if (!ok) return
    try {
      await api.deleteStudioMedia(i.source.id)
      await invalidate('studio-media')
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div
      className={cn('flex min-h-0 flex-col gap-2 p-2', className)}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) e.preventDefault()
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        void importFiles([...e.dataTransfer.files])
      }}
    >
      <div className="flex items-center gap-1">
        <div className="flex rounded-lg bg-white/[0.06] p-0.5 text-[12px]">
          {TABS.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn('flex items-center gap-1 rounded-md px-2 py-1', tab === key ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}
            >
              <Icon className="size-3.5" /> {label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => file.current?.click()}
          disabled={busy}
          className="ml-auto flex items-center gap-1 rounded-lg bg-white/[0.08] px-2 py-1 text-[12px] text-white/80 hover:bg-white/15 disabled:opacity-50"
          title="Import your own footage, music or voice-over (full length, nothing is cut). You can also drop files here."
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} <span className="hidden xl:inline">Import</span>
        </button>
        <input
          ref={file}
          type="file"
          multiple
          hidden
          accept="video/*,audio/*,image/*,.mkv,.mov"
          onChange={(e) => void importFiles([...(e.target.files ?? [])])}
        />
      </div>
      {tab === 'effects' ? (
        <Effects canApply={canTransition} onApply={onTransition} />
      ) : (
      <>
      <div className="flex items-center gap-1">
        <div className="relative min-w-0 flex-1">
          <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search…"
            className="w-full rounded-lg bg-white/[0.06] py-1 pl-7 pr-2 text-[12.5px] placeholder:text-white/35 focus:outline-none"
          />
        </div>
        <select
          value={scope}
          onChange={(e) => setScope(e.target.value as 'project' | 'all')}
          className="rounded-lg bg-white/[0.06] px-1.5 py-1 text-[12px] text-white/75 focus:outline-none"
          title="Show media of the edit's project or of every project"
        >
          <option value="project" className="bg-neutral-900">This project</option>
          <option value="all" className="bg-neutral-900">All projects</option>
        </select>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-0.5">
        {list.length ? (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-1.5">
            {list.map((i) => {
              const used = usage.get(i.key) ?? 0
              const other = scope === 'all' && i.projectId !== projectId ? projects.find((p) => p.id === i.projectId)?.name : undefined
              return (
                <li
                  key={i.key}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DND_TYPE, i.key)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onDoubleClick={() => onAdd(i)}
                  className="group relative cursor-grab overflow-hidden rounded-lg bg-white/[0.05] ring-1 ring-white/5 hover:ring-white/25 active:cursor-grabbing"
                  title={`${i.label}\n${ORIGIN[i.origin]}${other ? ` · ${other}` : ''}\nDrag onto a track, or double-click to append`}
                >
                  <div className="relative aspect-video bg-black/40">
                    {i.thumb ? (
                      <img src={i.thumb} alt="" draggable={false} className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-emerald-300/70">
                        <Music className="size-6" />
                      </div>
                    )}
                    {i.duration !== undefined && (
                      <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 font-mono text-[10px]">{formatDuration(i.duration)}</span>
                    )}
                    {used > 0 && <span className="absolute left-1 top-1 rounded bg-amber-300/90 px-1 text-[10px] font-medium text-black" title="Clips in this edit">×{used}</span>}
                    <button
                      type="button"
                      onClick={() => onAdd(i)}
                      className="absolute right-1 top-1 rounded-full bg-white/90 p-0.5 text-black opacity-0 shadow transition group-hover:opacity-100 pointer-coarse:opacity-100"
                      title="Append to the timeline"
                    >
                      <Plus className="size-3.5" />
                    </button>
                    {i.origin === 'import' && (
                      <button
                        type="button"
                        onClick={() => void remove(i)}
                        className="absolute bottom-1 left-1 rounded-full bg-black/70 p-1 text-white/70 opacity-0 transition hover:text-rose-300 group-hover:opacity-100 pointer-coarse:opacity-100"
                        title="Delete imported file"
                      >
                        <Trash2 className="size-3" />
                      </button>
                    )}
                  </div>
                  <div className="px-1.5 py-1">
                    <p className="truncate text-[11.5px] text-white/85">{i.label}</p>
                    <p className="truncate text-[10.5px] text-white/40">
                      {ORIGIN[i.origin]}
                      {i.media === 'video' && !i.hasAudio ? ' · no sound' : ''}
                      {other ? ` · ${other}` : ''}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-2 py-6 text-center text-[12px] text-white/40">
            {tab === 'audio'
              ? 'No sound here yet - generate Speech, or Import music / voice-over.'
              : `No ${tab === 'video' ? 'videos' : 'photos'} ${scope === 'project' ? 'in this project' : ''} yet.`}
            {scope === 'project' && (
              <button type="button" onClick={() => setScope('all')} className="mt-1 block w-full text-sky-300 hover:underline">
                Show all projects
              </button>
            )}
          </p>
        )}
      </div>
      </>
      )}
    </div>
  )
}

/**
 * DaVinci-style transitions. Drag one onto a clip on a video track (the left half = its start, the right half = its
 * end), or select a clip and press Start / End.
 */
function Effects({ canApply, onApply }: { canApply: boolean; onApply: (side: 'in' | 'out', type: TransitionType) => void }) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <p className="px-1 pb-2 text-[11.5px] leading-snug text-white/45">
        Video transitions. Drag one onto a clip edge, or select a clip and press <b className="text-white/70">Start</b> / <b className="text-white/70">End</b>.
        Where two clips touch, the later one dissolves over the earlier; at a free edge the clip dissolves from / to what is under it.
      </p>
      <ul className="flex flex-col gap-1.5">
        {TRANSITIONS.map((tr) => (
          <li
            key={tr.type}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_TRANSITION, tr.type)
              e.dataTransfer.effectAllowed = 'copy'
            }}
            className="flex cursor-grab items-center gap-2 rounded-lg bg-white/[0.05] p-1.5 ring-1 ring-white/5 hover:ring-white/25 active:cursor-grabbing"
            title={`${tr.hint}\nDrag onto the start or end of a clip`}
          >
            <TransitionIcon type={tr.type} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12.5px] text-white/90">{tr.label}</p>
              <p className="truncate text-[10.5px] text-white/40">{tr.hint}</p>
            </div>
            {(['in', 'out'] as const).map((side) => (
              <button
                key={side}
                type="button"
                disabled={!canApply}
                onClick={() => onApply(side, tr.type)}
                className="rounded-md bg-white/[0.08] px-1.5 py-1 text-[11px] text-white/80 hover:bg-white/15 disabled:opacity-30"
                title={canApply ? `Put it on the selected clip's ${side === 'in' ? 'start' : 'end'}` : 'Select a clip on a video track first'}
              >
                {side === 'in' ? 'Start' : 'End'}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Small picture of the dissolve: two frames melting into each other, styled per type. */
function TransitionIcon({ type }: { type: TransitionType }) {
  return (
    <div className="relative h-8 w-12 shrink-0 overflow-hidden rounded bg-sky-700">
      <div
        className="absolute inset-0"
        style={{
          background: 'linear-gradient(90deg, transparent 15%, rgb(168 85 247) 85%)',
          mixBlendMode: type === 'additive' ? 'plus-lighter' : undefined,
          filter: type === 'blur' ? 'blur(3px)' : undefined,
        }}
      />
      {type === 'additive' && <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2 bg-white/60 blur-sm" />}
    </div>
  )
}
