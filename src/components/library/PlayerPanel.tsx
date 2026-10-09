import { Fragment, useEffect, useRef, useState } from 'react'
import { DIRECTIVE_KEYS, DIRECTIVE_LABEL } from '../../../shared/directives'
import { tagCounts } from '../../../shared/tags'
import { readableLyrics } from '../../../shared/promptCompiler'
import { TagEditor } from '../TagEditor'
import {
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FastForward,
  Film,
  FolderInput,
  LibraryBig,
  Check,
  Mic,
  Music,
  ImagePlus,
  Clapperboard,
  ImageDown,
  Pencil,
  RotateCw,
  Shuffle,
  Star,
  Trash2,
  Type,
  X,
} from 'lucide-react'
import { formatUsd, getModel, parentInfoOf, resolveSettings } from '../../../shared/models'
import type { Generation } from '../../../shared/types'
import { useAssets, useFolders, useInvalidate, useProjects, useVoices } from '../../hooks/queries'
import { groupByFolder } from '../../lib/folders'
import { api, fileUrl, outputUrl } from '../../lib/api'
import { cn, elapsed, formatDuration, timeAgo } from '../../lib/utils'
import { DEFAULT_PROJECT_ID } from '../../../shared/types'
import { useComposer } from '../../stores/composer'
import { activeProjectId, useUi } from '../../stores/ui'
import { confirmAction } from '../ConfirmDialog'

type PromptTab = 'typed' | 'enhanced' | 'sent' | 'lyrics'

export function PlayerPanel({ list, all }: { list: Generation[]; all: Generation[] }) {
  const { selectedId, select, notify, requestTrim, setView, setEditId } = useUi()
  const composer = useComposer()
  const invalidate = useInvalidate()
  const { byId, data: assets = [] } = useAssets()
  const { data: voiceData } = useVoices()
  const { data: projects = [] } = useProjects()
  const { data: folders = [] } = useFolders()
  const video = useRef<HTMLVideoElement>(null)
  const [tab, setTab] = useState<PromptTab>('typed')
  const [title, setTitle] = useState('')

  const g = all.find((x) => x.id === selectedId)
  const idx = list.findIndex((x) => x.id === selectedId)

  useEffect(() => {
    setTitle(g?.title ?? '')
    setTab('typed')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g?.id])

  useEffect(() => {
    if (!g) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'Escape') select(undefined)
      if (e.key === 'ArrowLeft' && idx > 0) select(list[idx - 1].id)
      if (e.key === 'ArrowRight' && idx >= 0 && idx < list.length - 1) select(list[idx + 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [g, idx, list, select])

  if (!g) return null
  const model = getModel(g.model)
  const parent = g.parentId ? all.find((x) => x.id === g.parentId) : undefined
  const children = all.filter((x) => x.parentId === g.id)
  const done = g.status === 'completed' && !!g.file
  const photo = g.kind === 'image'
  const music = g.kind === 'music'
  // speech and music share the sound layout (player, no picture tools)
  const speech = g.kind === 'audio' || music
  const studio = g.studio
  const src = outputUrl(g)
  const canEdit = done && !resolveSettings(g.model, g.settings, { images: [], videos: [] }, 'edit', parentInfoOf(g)).errors.length
  const extendCheck = resolveSettings(g.model, { ...g.settings, enhance: false }, { images: [], videos: [] }, 'extend', parentInfoOf(g))
  const canExtend = done && !extendCheck.errors.length

  const run = async (fn: () => Promise<unknown>, msg?: string) => {
    try {
      await fn()
      if (msg) notify(msg)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  // everything that fills the composer also brings the generator back when the panel was opened from Studio
  const toComposer = (fn: () => void) => {
    fn()
    select(undefined)
    setView('generate')
  }

  const grabFrame = (at: number | 'last') =>
    run(async () => {
      const a = await api.frame(g.id, at)
      await invalidate('assets')
      composer.attach('firstFrame', [a.id])
      if (composer.mode !== 'create') composer.cancelMode()
      select(undefined)
      setView('generate')
    }, 'Frame set as the start frame')

  /** A photo becomes a library image: as the next video's start frame (Animate) or as an image ref. */
  const photoTo = (role: 'firstFrame' | 'images', switchToVideo: boolean) =>
    run(async () => {
      const a = await api.frame(g.id, 0)
      await invalidate('assets')
      if (switchToVideo) composer.setKind('video')
      else if (composer.mode !== 'create') composer.cancelMode()
      composer.attach(role, [a.id])
      select(undefined)
    }, role === 'firstFrame' ? 'Photo set as the start frame - describe the motion' : 'Added as an image ref')

  const addAsVideoRef = () =>
    run(async () => {
      const d = g.durationS ?? 0
      const start = d > 3.05 ? await requestTrim(src!, d) : 0
      if (start === null) return
      const a = await api.toAsset(g.id, start)
      await invalidate('assets')
      composer.attach('videos', [a.id])
      select(undefined)
      notify('Added as a video ref')
    })

  /** Photos become a library image; videos a 3 s clip (the library holds refs - Omni takes ≤3 s video refs). */
  const photoInLibrary = photo && assets.some((a) => a.fromGenerationId === g.id && a.kind === 'image' && a.source === 'generation')
  const addToLibrary = () =>
    run(async () => {
      if (photo) {
        await api.frame(g.id, 0)
      } else {
        const d = g.durationS ?? 0
        const start = d > 3.05 ? await requestTrim(src!, d) : 0
        if (start === null) return
        await api.toAsset(g.id, start)
      }
      await invalidate('assets')
      notify(photo ? 'Photo added to the library' : '3 s clip added to the library')
    })

  /** Reuse everything; references whose files were deleted are left out (and reported). */
  const reuseAll = () => {
    const currentProject = projects.find((p) => p.id === (activeProjectId() || DEFAULT_PROJECT_ID))
    const missing = composer.remix(g, {
      assetExists: (id) => byId.has(id),
      projectDefaults: currentProject?.defaults,
      voiceExists: (id) => !!voiceData?.voices.some((v) => v.id === id),
    })
    notify(
      missing
        ? `Reused - ${missing} reference${missing === 1 ? ' is' : 's are'} no longer in the library and ${missing === 1 ? 'was' : 'were'} left out`
        : 'Reused: prompt, settings and references copied to the composer',
      missing ? 'error' : 'info',
    )
  }

  // songs made before the filter may still hold only section markers ([[A0]]...) - nothing to read there
  const lyrics = readableLyrics(g.lyrics)
  const prompts: Record<PromptTab, string | undefined> = { typed: g.prompt, enhanced: g.enhancedPrompt, sent: g.sentPrompt, lyrics }
  const refThumbs = [
    ...(g.refs.firstFrame ? [{ id: g.refs.firstFrame, tag: '@start' }] : []),
    ...(g.refs.lastFrame ? [{ id: g.refs.lastFrame, tag: '@end' }] : []),
    ...g.refs.images.map((id, i) => ({ id, tag: `@img${i + 1}` })),
    ...g.refs.videos.map((id, i) => ({ id, tag: `@vid${i + 1}` })),
  ]

  const btn = 'flex items-center gap-2 rounded-xl bg-white/[0.06] px-3 py-2 text-[13px] text-white/85 transition hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-35'

  return (
    <div className="fixed inset-0 z-40 flex flex-col overflow-y-auto bg-black/85 backdrop-blur-md md:flex-row md:overflow-hidden" onMouseDown={(e) => e.target === e.currentTarget && select(undefined)}>
      <div className="relative flex h-[55vh] shrink-0 items-center justify-center p-2 md:h-auto md:flex-1 md:p-6" onMouseDown={(e) => e.target === e.currentTarget && select(undefined)}>
        <button
          type="button"
          onClick={() => select(undefined)}
          className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-2 text-white/80 backdrop-blur md:hidden"
          aria-label="Close"
        >
          <X className="size-4" />
        </button>
        {done && speech ? (
          <div className="flex w-full max-w-xl flex-col items-center gap-6 rounded-3xl bg-gradient-to-br from-fuchsia-500/15 via-sky-500/10 to-transparent p-10">
            {music && g.thumb ? (
              <img src={fileUrl('thumbs', g.thumb)} alt="" className="h-32 w-full rounded-xl object-fill opacity-85" />
            ) : music ? (
              <Music className="size-12 text-white/60" />
            ) : (
              <Mic className="size-12 text-white/60" />
            )}
            <audio key={g.id} src={src} controls autoPlay className="w-full" />
          </div>
        ) : done && photo ? (
          <img key={g.id} src={src} alt={g.prompt} className="max-h-full max-w-full rounded-xl bg-black object-contain shadow-2xl" />
        ) : done ? (
          <video
            ref={video}
            key={g.id}
            src={src}
            controls
            autoPlay
            loop
            playsInline
            className="max-h-full max-w-full rounded-xl bg-black shadow-2xl"
          />
        ) : (
          <div className="rounded-xl bg-white/5 px-8 py-16 text-center text-white/60">
            {g.status === 'failed' ? <p className="max-w-lg text-rose-200">{g.error}</p> : <p>{g.phase ?? g.status}… {elapsed(g.startedAt)}</p>}
          </div>
        )}
        {idx > 0 && (
          <button type="button" onClick={() => select(list[idx - 1].id)} className="absolute left-3 rounded-full bg-white/10 p-2 hover:bg-white/20" title="Previous (←)">
            <ChevronLeft className="size-5" />
          </button>
        )}
        {idx >= 0 && idx < list.length - 1 && (
          <button type="button" onClick={() => select(list[idx + 1].id)} className="absolute right-3 rounded-full bg-white/10 p-2 hover:bg-white/20" title="Next (→)">
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>

      <aside className="flex w-full shrink-0 flex-col gap-4 border-t border-white/10 bg-neutral-950/80 p-4 md:w-[400px] md:overflow-y-auto md:border-l md:border-t-0 md:p-5">
        <div className="flex items-start gap-2">
          <input
            value={title}
            placeholder="Untitled"
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => title !== (g.title ?? '') && run(async () => {
              await api.patchGeneration(g.id, { title })
              await invalidate('generations')
            })}
            className="flex-1 bg-transparent text-[16px] font-medium placeholder:text-white/30 focus:outline-none"
          />
          <button type="button" onClick={() => select(undefined)} className="rounded-full p-1 hover:bg-white/10" title="Close (Esc)">
            <X className="size-4" />
          </button>
        </div>

        <div className="flex flex-wrap gap-1.5 text-[11.5px] text-white/60">
          {(music
            ? [model.label, g.durationS ? formatDuration(g.durationS) : '', g.settings.instrumental ? 'instrumental' : 'vocals allowed', g.settings.enhance ? 'enhanced' : '', g.refs.images.length ? `${g.refs.images.length} image${g.refs.images.length > 1 ? 's' : ''}` : '']
            : speech
            ? [model.label, g.durationS ? formatDuration(g.durationS) : '', ...(g.voices ?? []).map((v) => `@voice${v.index} ${v.name}`)]
            : photo
            ? [model.label, g.mode !== 'create' ? g.mode : '', g.settings.aspectRatio, g.settings.imageSize ?? '', g.settings.enhance ? 'enhanced' : '']
            : [model.label, g.mode !== 'create' ? g.mode : '', g.settings.aspectRatio, g.settings.resolution, g.durationS ? formatDuration(g.durationS) : g.settings.duration ? `${g.settings.duration}s req.` : 'auto length', g.hasAudio === false || !g.settings.audio ? 'no audio' : 'audio', g.settings.enhance ? 'enhanced' : ''])
            .filter(Boolean)
            .map((t) => (
              <span key={t} className="rounded-md bg-white/[0.07] px-2 py-0.5">{t}</span>
            ))}
        </div>

        {studio ? (
          <div className="flex items-center gap-3 rounded-xl bg-white/[0.04] p-3 text-[12.5px] text-white/70">
            <span className="min-w-0 flex-1">
              Rendered in Studio from <b className="text-white/90">{studio.edit.name}</b> · {studio.edit.clips.length} clip{studio.edit.clips.length === 1 ? '' : 's'} on{' '}
              {studio.edit.tracks.length} tracks
            </span>
            <button
              type="button"
              className={btn}
              onClick={() => {
                setEditId(studio.editId)
                setView('studio')
                select(undefined)
              }}
              title="Open the timeline this video was rendered from"
            >
              <Clapperboard className="size-4" /> Open in Studio
            </button>
          </div>
        ) : (
        <div>
          <div className="mb-1.5 flex gap-1">
            {(['typed', 'enhanced', 'sent', ...(lyrics ? ['lyrics'] : [])] as PromptTab[]).map((t) => (
              <button
                key={t}
                type="button"
                disabled={!prompts[t]}
                onClick={() => setTab(t)}
                className={cn('rounded-md px-2 py-0.5 text-[12px] capitalize disabled:opacity-30', tab === t ? 'bg-white/15 text-white' : 'text-white/50 hover:text-white')}
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              className="ml-auto rounded-md p-1 text-white/45 hover:text-white"
              title="Copy"
              onClick={() => run(() => navigator.clipboard.writeText(prompts[tab] ?? ''), 'Copied')}
            >
              <Copy className="size-3.5" />
            </button>
          </div>
          <p className="max-h-56 overflow-y-auto whitespace-pre-wrap rounded-xl bg-white/[0.04] p-3 text-[13px] leading-relaxed text-white/85">
            {prompts[tab] || <span className="text-white/35">—</span>}
          </p>
        </div>
        )}

        {g.directives && Object.keys(g.directives).length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-white/[0.04] p-3 text-[12.5px]">
            {DIRECTIVE_KEYS.filter((k) => g.directives?.[k]).map((k) => (
              <Fragment key={k}>
                <dt className="text-white/40">{k === 'camera' && photo ? 'Framing' : DIRECTIVE_LABEL[k]}</dt>
                <dd className="text-white/75">{g.directives?.[k]}</dd>
              </Fragment>
            ))}
          </dl>
        )}

        {!speech && !!g.voices?.length && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl bg-white/[0.04] p-3 text-[12.5px]">
            {g.voices.map((v) => (
              <Fragment key={v.index}>
                <dt className="font-mono text-white/40">@voice{v.index}</dt>
                <dd className="text-white/75">{v.name} - {v.description}</dd>
              </Fragment>
            ))}
          </dl>
        )}

        {refThumbs.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/35">References</p>
            <div className="flex flex-wrap gap-1.5">
              {refThumbs.map((r) => {
                const a = byId.get(r.id)
                return (
                  <div key={r.tag} className="relative size-16 overflow-hidden rounded-lg bg-white/5" title={a?.label ?? 'deleted'}>
                    {a && <img src={fileUrl('thumbs', a.thumb)} alt="" className="size-full object-cover" />}
                    <span className="absolute bottom-0.5 left-0.5 rounded bg-black/75 px-1 text-[10px]">{r.tag}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-1.5">
          {!studio && (<>
          <button
            type="button"
            className={cn(btn, 'bg-white/[0.12] text-white')}
            onClick={() => toComposer(reuseAll)}
            title="Everything: model, parameters, prompt, style / camera / avoid where they differ from the project, and references still in the library"
          >
            <Shuffle className="size-4" /> Reuse
          </button>
          <button type="button" className={btn} onClick={() => toComposer(() => composer.setPrompt(g.prompt))} title="Only the prompt text">
            <Type className="size-4" /> Prompt only
          </button>
          {!speech && (
          <button
            type="button"
            className={btn}
            disabled={!canEdit}
            title={canEdit ? `Change this ${photo ? 'photo' : 'video'} with a follow-up prompt` : model.canEdit ? 'Only finished items with a stored interaction can be edited' : `${model.label} cannot edit`}
            onClick={() => toComposer(() => composer.continueFrom(g, 'edit'))}
          >
            <Pencil className="size-4" /> Edit
          </button>
          )}
          </>)}
          {speech ? null : photo ? (
            <>
              <button type="button" className={btn} disabled={!done} onClick={() => photoTo('firstFrame', true)} title="Start a video from this photo">
                <Clapperboard className="size-4" /> Animate
              </button>
              <button type="button" className={btn} disabled={!done} onClick={() => photoTo('images', false)} title="Attach to the composer as a reference image">
                <ImagePlus className="size-4" /> Use as image ref
              </button>
            </>
          ) : (
          <>
          {!studio && <button
            type="button"
            className={btn}
            disabled={!canExtend}
            title={canExtend ? 'Continue the scene' : extendCheck.errors.join(' ')}
            onClick={() => toComposer(() => composer.continueFrom(g, 'extend'))}
          >
            <FastForward className="size-4" /> Extend
          </button>}
          <button type="button" className={btn} disabled={!done} onClick={() => grabFrame(video.current?.currentTime ?? 0)} title="Current frame of the player becomes the start frame">
            <ImageDown className="size-4" /> Frame → start
          </button>
          <button type="button" className={btn} disabled={!done} onClick={() => grabFrame('last')} title="Chain: the last frame becomes the next video's start frame">
            <ImageDown className="size-4" /> Last frame → start
          </button>
          <button type="button" className={btn} disabled={!done} onClick={addAsVideoRef} title="Use a 3 s clip of this video as a video reference (Omni)">
            <Film className="size-4" /> Use as video ref
          </button>
          </>
          )}
          {!speech && (
            <button
              type="button"
              className={btn}
              disabled={!done || photoInLibrary}
              onClick={addToLibrary}
              title={photo ? 'Save this photo to the project library (reusable as a frame or image ref)' : 'Save a 3 s clip to the project library (reusable as a video ref)'}
            >
              {photoInLibrary ? <Check className="size-4" /> : <LibraryBig className="size-4" />}
              {photoInLibrary ? 'In library' : 'Add to library'}
            </button>
          )}
          {done ? (
            <a className={btn} href={src} download={`${(g.title || g.prompt || (photo ? 'photo' : music ? 'music' : speech ? 'speech' : 'video')).slice(0, 50).replace(/[^\w-]+/g, '_')}${g.file!.slice(g.file!.lastIndexOf('.'))}`}>
              <Download className="size-4" /> Download
            </a>
          ) : (
            <button type="button" className={btn} disabled={g.status !== 'failed'} onClick={() => run(async () => {
              await api.retry(g.id)
              await invalidate('generations')
            })}>
              <RotateCw className="size-4" /> Retry
            </button>
          )}
          <button
            type="button"
            className={btn}
            onClick={() => run(async () => {
              await api.patchGeneration(g.id, { favorite: !g.favorite })
              await invalidate('generations')
            })}
          >
            <Star className={cn('size-4', g.favorite && 'fill-amber-300 text-amber-300')} /> {g.favorite ? 'Unfavourite' : 'Favourite'}
          </button>
          <button
            type="button"
            className={cn(btn, 'hover:bg-rose-500/30')}
            onClick={async () => {
              const what = (g.kind === 'image' ? 'photo' : g.kind === 'audio' ? 'recording' : g.kind === 'music' ? 'song' : 'video')
              if (!(await confirmAction({ title: `Delete this ${what}?`, message: 'The file is removed from disk. This cannot be undone.' }))) return
              void run(async () => {
                const next = list[idx + 1] ?? list[idx - 1]
                await api.deleteGeneration(g.id)
                await invalidate('generations')
                select(next?.id)
              })
            }}
          >
            <Trash2 className="size-4" /> Delete
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/35">Tags</p>
          <TagEditor
            tags={g.tags ?? []}
            suggestions={tagCounts(all).map(([t]) => t)}
            onChange={(tags) =>
              run(async () => {
                await api.patchGeneration(g.id, { tags })
                await invalidate('generations')
              })
            }
          />
        </div>

        <label className="flex items-center gap-2 text-[12.5px] text-white/55">
          <FolderInput className="size-4" /> Project
          <select
            value={g.projectId ?? DEFAULT_PROJECT_ID}
            onChange={(e) =>
              run(async () => {
                await api.patchGeneration(g.id, { projectId: e.target.value })
                await invalidate('generations')
              }, 'Moved')
            }
            className="flex-1 rounded-lg bg-white/[0.06] px-2 py-1.5 text-[13px] text-white/85 focus:outline-none"
          >
            {groupByFolder(projects, folders).map((grp) =>
              grp.folder ? (
                <optgroup key={grp.folder.id} label={`📁 ${grp.folder.name}`} className="bg-neutral-900">
                  {grp.projects.map((p) => (
                    <option key={p.id} value={p.id} className="bg-neutral-900">{p.name}</option>
                  ))}
                </optgroup>
              ) : (
                grp.projects.map((p) => (
                  <option key={p.id} value={p.id} className="bg-neutral-900">{p.name}</option>
                ))
              ),
            )}
          </select>
        </label>

        {(parent || children.length > 0) && (
          <div>
            <p className="mb-1.5 text-[11px] uppercase tracking-wide text-white/35">Versions</p>
            <div className="flex flex-col gap-1">
              {parent && <LineageRow g={parent} label="source" onClick={() => select(parent.id)} />}
              {children.map((ch) => (
                <LineageRow key={ch.id} g={ch} label={ch.mode} onClick={() => select(ch.id)} />
              ))}
            </div>
          </div>
        )}

        <dl className="mt-auto grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px] text-white/50">
          <dt>Created</dt>
          <dd>{timeAgo(g.createdAt)}</dd>
          <dt>Took</dt>
          <dd>{g.finishedAt ? elapsed(g.startedAt, g.finishedAt) : '—'}</dd>
          <dt>Cost</dt>
          <dd>
            {g.cost.actualUsd !== undefined ? formatUsd(g.cost.actualUsd) : `~${formatUsd(g.cost.estimatedUsd)} (estimate)`}
          </dd>
          {g.width && (
            <>
              <dt>Size</dt>
              <dd>{g.width}×{g.height}</dd>
            </>
          )}
          {(g.provider.interactionId || g.provider.operationName || g.provider.openrouterJobId) && (
            <>
              <dt>Ref</dt>
              <dd className="truncate font-mono text-[11px]" title={g.provider.interactionId ?? g.provider.operationName ?? g.provider.openrouterJobId}>
                {g.provider.interactionId ?? g.provider.operationName ?? g.provider.openrouterJobId}
              </dd>
            </>
          )}
        </dl>
      </aside>
    </div>
  )
}

function LineageRow({ g, label, onClick }: { g: Generation; label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex items-center gap-2 rounded-lg p-1 text-left hover:bg-white/5">
      <div className="h-9 w-14 shrink-0 overflow-hidden rounded bg-black">
        {g.thumb && <img src={fileUrl('thumbs', g.thumb)} alt="" className="size-full object-cover" />}
      </div>
      <span className="rounded bg-white/10 px-1.5 text-[10.5px] text-white/70">{label}</span>
      <span className="truncate text-[12px] text-white/70">{g.title || g.prompt || '—'}</span>
    </button>
  )
}
