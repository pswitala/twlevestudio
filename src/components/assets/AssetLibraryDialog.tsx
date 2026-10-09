import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Copy, Film, FolderInput, Image as ImageIcon, Mic, Music, Plus, Search, Tag, Trash2, Upload, X } from 'lucide-react'
import { ProjectTargetMenu } from './ProjectTargetMenu'
import { AssetPreview, type PreviewItem } from './AssetPreview'
import { getModel } from '../../../shared/models'
import { readableLyrics } from '../../../shared/promptCompiler'
import { hasAllTags, normalizeTag, tagCounts } from '../../../shared/tags'
import { DEFAULT_PROJECT_ID, type Asset, type Generation } from '../../../shared/types'
import { speakingVoice, type Voice } from '../../../shared/voices'
import { useAssets, useGenerations, useInvalidate, useProjects, useUpload, useVoices } from '../../hooks/queries'
import { ProjectPicker } from './ProjectPicker'
import { api, fileUrl, outputUrl } from '../../lib/api'
import { cn, formatDuration, timeAgo } from '../../lib/utils'
import { useComposer, type Role } from '../../stores/composer'
import { useUi } from '../../stores/ui'
import { confirmAction } from '../ConfirmDialog'
import { TagEditor, TagFilterBar } from '../TagEditor'

const ROLE_LABEL: Record<Role, string> = {
  firstFrame: 'start frame',
  lastFrame: 'end frame',
  images: 'image refs',
  videos: 'video refs',
  voices: 'voices for the script',
}

type LibTab = 'image' | 'video' | 'audio' | 'speech' | 'voice'

const TABS: { key: LibTab; label: string; icon: typeof ImageIcon }[] = [
  { key: 'image', label: 'Images', icon: ImageIcon },
  { key: 'video', label: 'Videos', icon: Film },
  { key: 'audio', label: 'Audio', icon: Music },
  { key: 'speech', label: 'Speech', icon: Mic },
  { key: 'voice', label: 'Voices', icon: AudioLines },
]

/** One library row, whatever it is: an uploaded/extracted file (image, video ref, music), a speech recording, or a project voice. */
interface LibItem extends PreviewItem {
  tab: LibTab
  projectId: string
  createdAt: string
  thumb?: string
  asset?: Asset
  gen?: Generation
  voice?: Voice
}

function itemOfAsset(a: Asset): LibItem {
  return {
    id: a.id,
    tab: a.kind,
    media: a.kind,
    label: a.label,
    projectId: a.projectId ?? DEFAULT_PROJECT_ID,
    tags: a.tags,
    createdAt: a.createdAt,
    thumb: fileUrl('thumbs', a.thumb),
    src: fileUrl('assets', a.file),
    ...(a.kind === 'audio' ? { audioKind: 'music' as const, waveform: fileUrl('thumbs', a.thumb) } : {}),
    meta: a.kind === 'audio' ? formatDuration(a.durationS) || 'audio' : `${a.width}×${a.height}${a.durationS ? ` · ${formatDuration(a.durationS)}` : ''}`,
    asset: a,
  }
}

function itemOfSpeech(g: Generation): LibItem {
  return {
    id: g.id,
    tab: 'speech',
    media: 'audio',
    audioKind: 'speech',
    label: g.title || g.prompt.replace(/@voice\d+\s*(\([^)]*\))?\s*:/g, '').trim().slice(0, 60) || 'Speech',
    projectId: g.projectId ?? DEFAULT_PROJECT_ID,
    tags: g.tags,
    createdAt: g.createdAt,
    src: outputUrl(g),
    meta: [g.durationS ? formatDuration(g.durationS) : '', (g.voices ?? []).map((v) => v.name).join(' · ')].filter(Boolean).join(' · '),
    description: g.prompt,
    gen: g,
  }
}

/** Generated music (Lyria) - lives in the Audio tab next to uploaded music. */
function itemOfMusic(g: Generation): LibItem {
  return {
    id: g.id,
    tab: 'audio',
    media: 'audio',
    audioKind: 'music',
    label: g.title || g.prompt.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Music',
    projectId: g.projectId ?? DEFAULT_PROJECT_ID,
    tags: g.tags,
    createdAt: g.createdAt,
    thumb: fileUrl('thumbs', g.thumb),
    waveform: fileUrl('thumbs', g.thumb),
    src: outputUrl(g),
    meta: ['generated', g.durationS ? formatDuration(g.durationS) : '', g.settings.instrumental ? 'instrumental' : ''].filter(Boolean).join(' · '),
    description: readableLyrics(g.lyrics) ? `${g.prompt}\n\n— lyrics —\n${readableLyrics(g.lyrics)}` : g.prompt,
    gen: g,
  }
}

function itemOfVoice(v: Voice, n: number): LibItem {
  return {
    id: v.id,
    tab: 'voice',
    media: 'audio',
    audioKind: 'voice',
    label: v.name,
    projectId: v.projectId,
    tags: v.tags,
    createdAt: v.createdAt,
    src: fileUrl('voices', v.sampleFile),
    meta: `@voice${n} · ${v.language}${v.gender ? ` · ${v.gender}` : ''}${speakingVoice(v) ? '' : ' · not designed'}`,
    description: v.description,
    voice: v,
  }
}

/**
 * The library: uploaded files and extracted frames (images, video refs), music / sound, speech recordings and project voices.
 * Every tab has the same tools: project filter, search, tags, selection, preview, copy / move to a project, delete.
 * With a target role (from a composer tile) it is a picker for images / videos only.
 */
export function AssetLibraryDialog() {
  const { library, closeLibrary, notify, projectId, openVoices } = useUi()
  const { data: projects = [] } = useProjects()
  /** projects shown; empty = all */
  const [projectFilter, setProjectFilter] = useState<string[]>([])
  const isOpen = !!library
  // Every time the library opens it starts on the open project (or all of them in the "All projects" view).
  const role = library?.role
  // Voices for a speech script come from the whole library, so that picker starts on all projects.
  useEffect(() => {
    if (isOpen) setProjectFilter(role === 'voices' || !projectId ? [] : [projectId])
  }, [isOpen, projectId, role])
  const { data: assets = [] } = useAssets()
  const { data: generations = [] } = useGenerations()
  const { data: voiceData } = useVoices()
  const composer = useComposer()
  const upload = useUpload()
  const invalidate = useInvalidate()
  const input = useRef<HTMLInputElement>(null)
  const [tab, setTab] = useState<LibTab>(role === 'videos' ? 'video' : 'image')
  const [picked, setPicked] = useState<string[]>([])
  const [tagFilter, setTagFilter] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [bulkTag, setBulkTag] = useState('')
  /** item whose tags are being edited in the bar under the grid */
  const [editingId, setEditingId] = useState<string>()
  /** item open in the full-size preview */
  const [previewId, setPreviewId] = useState<string>()

  if (!library) return null
  const current: LibTab = role ? (role === 'voices' ? 'voice' : role === 'videos' ? 'video' : 'image') : tab

  // voices are numbered @voice1.. per project, in creation order
  const voiceNumber = new Map<string, number>()
  const perProject = new Map<string, number>()
  for (const v of [...(voiceData?.voices ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    const n = (perProject.get(v.projectId) ?? 0) + 1
    perProject.set(v.projectId, n)
    voiceNumber.set(v.id, n)
  }

  const allOfTab = (t: LibTab): LibItem[] =>
    t === 'speech'
      ? generations.filter((g) => g.kind === 'audio' && g.status === 'completed').map(itemOfSpeech)
      : t === 'voice'
        ? (voiceData?.voices ?? []).map((v) => itemOfVoice(v, voiceNumber.get(v.id) ?? 0))
        : t === 'audio'
          ? [
              ...generations.filter((g) => g.kind === 'music' && g.status === 'completed').map(itemOfMusic),
              ...assets.filter((a) => a.kind === 'audio').map(itemOfAsset),
            ].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          : assets.filter((a) => a.kind === t).map(itemOfAsset)

  const ofTab = allOfTab(current)
  const inScope = ofTab.filter((x) => !projectFilter.length || projectFilter.includes(x.projectId))
  const q = search.trim().toLowerCase()
  const list = inScope.filter(
    (x) =>
      hasAllTags(x, tagFilter) &&
      (!q || x.label.toLowerCase().includes(q) || x.description?.toLowerCase().includes(q) || x.tags?.some((t) => t.includes(q))),
  )
  const counts = tagCounts(inScope)
  const projectCounts = new Map<string, number>()
  for (const x of ofTab) projectCounts.set(x.projectId, (projectCounts.get(x.projectId) ?? 0) + 1)
  const allTags = counts.map(([t]) => t)
  const model = getModel(composer.model)
  const already = role === 'images' ? composer.refs.images.length : role === 'videos' ? composer.refs.videos.length : 0
  const limit = role === 'images' ? model.maxImageRefs - already : role === 'videos' ? model.maxVideoRefs - already : Infinity
  const selected = inScope.filter((x) => picked.includes(x.id))
  // the Audio tab mixes uploaded files (assets) and generated music (generations)
  const queryKeys = current === 'speech' ? ['generations'] : current === 'voice' ? ['voices'] : current === 'audio' ? ['assets', 'generations'] : ['assets']

  function toggle(x: LibItem) {
    if (role === 'firstFrame' || role === 'lastFrame') {
      composer.attach(role, [x.id])
      close()
      return
    }
    // picker: limited by free ref slots; library: free selection for tags / copy / move
    setPicked((p) => (p.includes(x.id) ? p.filter((id) => id !== x.id) : p.length < limit ? [...p, x.id] : p))
  }

  function switchTab(t: LibTab) {
    setTab(t)
    setPicked([])
    setTagFilter([])
    setEditingId(undefined)
    setPreviewId(undefined)
  }

  function close() {
    setPicked([])
    setTagFilter([])
    setSearch('')
    setEditingId(undefined)
    setPreviewId(undefined)
    closeLibrary()
  }

  const patchTags = (x: LibItem, tags: string[]) =>
    x.gen ? api.patchGeneration(x.id, { tags }) : x.voice ? api.patchVoice(x.id, { tags }) : api.patchAsset(x.id, { tags })

  async function setTags(x: LibItem, tags: string[]) {
    try {
      await patchTags(x, tags)
      await invalidate(...queryKeys)
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  async function bulk(op: 'add' | 'remove', raw: string) {
    const t = normalizeTag(raw)
    if (!t || !selected.length) return
    await Promise.all(
      selected.map((x) => patchTags(x, op === 'add' ? [...new Set([...(x.tags ?? []), t])] : (x.tags ?? []).filter((y) => y !== t))),
    )
    await invalidate(...queryKeys)
    setBulkTag('')
    notify(`${op === 'add' ? 'Tagged' : 'Untagged'} ${selected.length} item${selected.length > 1 ? 's' : ''} "${t}"`)
  }

  /** Copy / move the selection to another project. */
  async function transfer(mode: 'copy' | 'move', targetId: string) {
    const target = projects.find((p) => p.id === targetId)
    if (current === 'voice' && mode === 'move') {
      const ok = await confirmAction({
        title: `Move ${picked.length} voice${picked.length === 1 ? '' : 's'} to ${target?.name ?? 'project'}?`,
        message: '@voice numbers change in both projects - prompts that say @voice2 may then point at a different voice.',
        confirmLabel: 'Move',
      })
      if (!ok) return
    }
    try {
      const genIds = selected.filter((x) => x.gen).map((x) => x.id)
      const otherIds = selected.filter((x) => !x.gen).map((x) => x.id)
      const results = await Promise.all([
        genIds.length ? api.transferGenerations(genIds, targetId, mode) : undefined,
        !otherIds.length ? undefined : current === 'voice' ? api.transferVoices(otherIds, targetId, mode) : api.transferAssets(otherIds, targetId, mode),
      ])
      const r = results.reduce<{ done: number; skipped: number }>((acc, x) => ({ done: acc.done + (x?.done ?? 0), skipped: acc.skipped + (x?.skipped ?? 0) }), { done: 0, skipped: 0 })
      await invalidate(...queryKeys)
      if (mode === 'move') setPicked([])
      const verb = mode === 'move' ? 'Moved' : 'Copied'
      notify(`${verb} ${r.done} item${r.done === 1 ? '' : 's'} to ${target?.name ?? 'project'}` + (r.skipped ? ` · ${r.skipped} skipped (already there)` : ''))
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  async function remove(x: LibItem) {
    if (x.gen) {
      if (!(await confirmAction({ title: `Delete this ${x.tab === 'speech' ? 'recording' : 'song'}?`, message: `"${x.label}" and its audio file are removed from disk. This cannot be undone.` }))) return
      await api.deleteGeneration(x.id).catch((e) => notify((e as Error).message, 'error'))
      return invalidate('generations')
    }
    if (x.tab === 'voice') {
      const ok = await confirmAction({
        title: `Delete voice "${x.label}"?`,
        message: '@voice numbers after it in that project shift down by one. The designed voice is removed from Google too, unless a copy in another project still uses it.',
      })
      if (!ok) return
      await api.deleteVoice(x.id).catch((e) => notify((e as Error).message, 'error'))
      return invalidate('voices')
    }
    if (!(await confirmAction({ title: `Delete "${x.label}" from the library?`, message: 'The file is removed from disk. Generations that used it keep their results.' }))) return
    try {
      await api.deleteAsset(x.id)
    } catch (e) {
      if ((e as { status?: number }).status !== 409) return notify((e as Error).message, 'error')
      const ok = await confirmAction({
        title: 'This file is used by generations',
        message: `${(e as Error).message} Remix of those generations will be missing this reference.`,
        confirmLabel: 'Delete anyway',
      })
      if (!ok) return
      await api.deleteAsset(x.id, true)
    }
    await invalidate('assets')
  }

  const selectedTags = tagCounts(selected).map(([t]) => t)
  const editing = ofTab.find((x) => x.id === editingId)
  const previewing = list.find((x) => x.id === previewId)
  const canUpload = current === 'image' || current === 'video' || current === 'audio'
  const emptyText =
    current === 'speech'
      ? 'No speech recordings here - make one in the composer’s Speech tab.'
      : current === 'voice'
        ? 'No voices here - create one with “New voice”.'
        : current === 'audio'
          ? 'No music or sound here - upload mp3 / wav / m4a… (kept at full length) and use it on Studio’s audio tracks.'
          : 'Nothing here yet - upload, paste, grab frames from your videos.'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-full w-full max-w-6xl flex-col rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl">
        <header className="flex flex-wrap items-center gap-2 border-b border-white/10 px-3 py-2.5 sm:gap-3 sm:px-5 sm:py-3">
          <h2 className="text-[15px] font-medium">{role ? `Pick ${ROLE_LABEL[role]}` : 'Library'}</h2>
          {!role && (
            <div className="flex gap-1 rounded-lg bg-white/5 p-0.5">
              {TABS.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => switchTab(key)}
                  className={cn('flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[12.5px]', tab === key ? 'bg-white/15' : 'text-white/55')}
                >
                  <Icon className="size-3.5" />
                  <span className="hidden sm:inline">{label}</span>
                </button>
              ))}
            </div>
          )}
          <div className="relative order-last w-full sm:order-none sm:w-56">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={current === 'speech' ? 'Search script or tag…' : current === 'voice' ? 'Search name, description or tag…' : 'Search name or tag…'}
              className="w-full rounded-lg bg-white/[0.06] py-1.5 pl-8 pr-3 text-[12.5px] placeholder:text-white/35 focus:outline-none"
            />
          </div>
          <input
            ref={input}
            type="file"
            hidden
            multiple
            accept={current === 'video' ? 'video/*' : current === 'audio' ? 'audio/*,.mp3,.m4a,.wav,.ogg,.opus,.flac,.aac,.aif,.aiff,.wma' : 'image/*'}
            onChange={async (e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (!files.length) return
              try {
                await upload.mutateAsync({ files })
              } catch (err) {
                notify((err as Error).message, 'error')
              }
            }}
          />
          <ProjectPicker projects={projects} selected={projectFilter} onChange={setProjectFilter} counts={projectCounts} className="ml-auto" />
          {canUpload && (
            <button
              type="button"
              onClick={() => input.current?.click()}
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-1.5 text-[12.5px] hover:bg-white/12"
              title={
                current === 'video'
                  ? 'Videos longer than 3 s are cut from the start - use a tile to choose the window'
                  : current === 'audio'
                    ? 'Music, sound effects, voice-over - kept whole. Video models take no audio refs; use it in Studio.'
                    : undefined
              }
            >
              <Upload className="size-3.5" /> Upload
            </button>
          )}
          {current === 'voice' && !role && (
            <button
              type="button"
              onClick={() => openVoices(projectId || DEFAULT_PROJECT_ID)}
              className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-1.5 text-[12.5px] hover:bg-white/12"
              title="Create or edit voices of the open project"
            >
              <Plus className="size-3.5" /> New voice
            </button>
          )}
          <button type="button" onClick={close} className="rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </header>

        <TagFilterBar
          counts={counts}
          selected={tagFilter}
          onToggle={(t) => setTagFilter((f) => (f.includes(t) ? f.filter((x) => x !== t) : [...f, t]))}
          onClear={() => setTagFilter([])}
          className="border-b border-white/[0.06] px-5 py-2"
        />

        <div className="grid flex-1 grid-cols-[repeat(auto-fill,minmax(105px,1fr))] gap-1.5 overflow-y-auto p-2 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-2 sm:p-4">
          {list.map((x) => {
            const sel = picked.includes(x.id)
            const AudioIcon = x.tab === 'voice' ? AudioLines : Mic
            return (
              <div
                key={x.id}
                role="button"
                tabIndex={0}
                onClick={() => setPreviewId(x.id)}
                onKeyDown={(e) => e.key === ' ' && (e.preventDefault(), toggle(x))}
                className={cn(
                  'group relative cursor-pointer overflow-hidden rounded-xl border bg-black text-left hover:border-white/40',
                  sel ? 'border-white ring-2 ring-white/60' : editingId === x.id ? 'border-fuchsia-300/70' : 'border-white/[0.07]',
                )}
              >
                {x.thumb ? (
                  <img src={x.thumb} alt="" loading="lazy" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-fuchsia-500/15 via-sky-500/10 to-transparent px-3 pb-10 text-center">
                    <AudioIcon className="size-7 text-white/55" />
                    {x.description && <p className="line-clamp-3 text-[10.5px] leading-snug text-white/45">{x.description}</p>}
                  </div>
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/70 to-transparent px-2 pb-1.5 pt-8">
                  {!!x.tags?.length && (
                    <div className="mb-1 flex flex-wrap gap-0.5">
                      {x.tags.slice(0, 3).map((t) => (
                        <span key={t} className="rounded bg-fuchsia-400/25 px-1 text-[10px] text-fuchsia-100">{t}</span>
                      ))}
                      {x.tags.length > 3 && <span className="text-[10px] text-white/50">+{x.tags.length - 3}</span>}
                    </div>
                  )}
                  <p className="truncate text-[12px]">{x.label}</p>
                  <p className="truncate text-[10.5px] text-white/50">
                    {x.meta} · {timeAgo(x.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    toggle(x)
                  }}
                  title={role === 'firstFrame' || role === 'lastFrame' ? `Use as ${ROLE_LABEL[role]}` : sel ? 'Deselect' : 'Select'}
                  className={cn(
                    // same look as the tag / delete buttons; stays visible once selected
                    'absolute left-1.5 top-1.5 rounded-md p-1 transition',
                    sel ? 'bg-white text-black' : 'bg-black/70 opacity-0 hover:bg-white/25 group-hover:opacity-100 pointer-coarse:opacity-100',
                  )}
                >
                  <Check className="size-3.5" />
                </button>
                <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100" onClick={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setEditingId(editingId === x.id ? undefined : x.id)}
                    className={cn('rounded-md p-1 hover:bg-fuchsia-500/70', editingId === x.id ? 'bg-fuchsia-500/80' : 'bg-black/70')}
                    title="Edit tags"
                  >
                    <Tag className="size-3.5" />
                  </button>
                  {!role && (
                    <button type="button" onClick={() => void remove(x)} className="rounded-md bg-black/70 p-1 hover:bg-rose-500/80" title="Delete">
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            )
          })}
          {!list.length && (
            <p className="col-span-full py-12 text-center text-[13px] text-white/40">
              {inScope.length ? 'Nothing matches the search / tags.' : `${emptyText}${projectFilter.length ? ' Or pick more projects above.' : ''}`}
            </p>
          )}
        </div>

        {previewing && (
          <AssetPreview
            item={previewing}
            list={list}
            onSelect={setPreviewId}
            onClose={() => setPreviewId(undefined)}
            picked={picked.includes(previewing.id)}
            pickLabel={role === 'firstFrame' || role === 'lastFrame' ? `Use as ${ROLE_LABEL[role]}` : undefined}
            onPick={() => toggle(previewing)}
          />
        )}

        {editing && (
          <div className="flex items-start gap-3 border-t border-white/10 bg-fuchsia-500/[0.04] px-5 py-3">
            {editing.thumb ? (
              <img src={editing.thumb} alt="" className="size-12 shrink-0 rounded-lg object-cover" />
            ) : (
              <span className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-white/[0.06]">
                {editing.tab === 'voice' ? <AudioLines className="size-5 text-white/55" /> : editing.tab === 'audio' ? <Music className="size-5 text-white/55" /> : <Mic className="size-5 text-white/55" />}
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="mb-1.5 truncate text-[12px] text-white/60">
                Tags · <span className="text-white/85">{editing.label}</span>
              </p>
              <TagEditor key={editing.id} tags={editing.tags ?? []} onChange={(tags) => setTags(editing, tags)} suggestions={allTags} autoFocus />
            </div>
            <button type="button" onClick={() => setEditingId(undefined)} className="rounded-full p-1 text-white/50 hover:bg-white/10 hover:text-white" title="Done">
              <X className="size-4" />
            </button>
          </div>
        )}

        {(picked.length > 0 || role === 'images' || role === 'videos' || role === 'voices') && (
          <footer className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3 text-[12.5px] text-white/55">
            <span>
              {picked.length} selected{role && Number.isFinite(limit) ? ` · ${Math.max(0, limit)} slot${limit === 1 ? '' : 's'} left` : ''}
            </span>
            {picked.length > 0 && (
              <>
                <span className="mx-1 h-4 w-px bg-white/10" />
                <Tag className="size-3.5" />
                <input
                  value={bulkTag}
                  list="library-tags"
                  onChange={(e) => setBulkTag(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void bulk('add', bulkTag)}
                  placeholder="tag for selected…"
                  className="w-40 rounded-lg bg-white/[0.06] px-2.5 py-1 text-[12.5px] text-white placeholder:text-white/35 focus:outline-none"
                />
                <datalist id="library-tags">
                  {allTags.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
                <button type="button" disabled={!bulkTag.trim()} onClick={() => bulk('add', bulkTag)} className="rounded-lg bg-white/[0.08] px-2.5 py-1 text-white/80 hover:bg-white/15 disabled:opacity-40">
                  Add tag
                </button>
                {selectedTags.length > 0 && (
                  <select
                    value=""
                    onChange={(e) => e.target.value && void bulk('remove', e.target.value)}
                    className="rounded-lg bg-white/[0.06] px-2 py-1 text-[12.5px] text-white/70 focus:outline-none"
                  >
                    <option value="" className="bg-neutral-900">Remove tag…</option>
                    {selectedTags.map((t) => (
                      <option key={t} value={t} className="bg-neutral-900">{t}</option>
                    ))}
                  </select>
                )}
                {!role && (
                  <>
                    <span className="mx-1 h-4 w-px bg-white/10" />
                    <ProjectTargetMenu label="Copy to…" icon={<Copy className="size-3.5" />} projects={projects} onPick={(id) => transfer('copy', id)} />
                    <ProjectTargetMenu label="Move to…" icon={<FolderInput className="size-3.5" />} projects={projects} onPick={(id) => transfer('move', id)} />
                  </>
                )}
                <button type="button" onClick={() => setPicked([])} className="text-white/45 hover:text-white">
                  clear selection
                </button>
              </>
            )}
            {(role === 'images' || role === 'videos' || role === 'voices') && (
              <button
                type="button"
                disabled={!picked.length}
                onClick={() => {
                  composer.attach(role, picked)
                  close()
                }}
                className="ml-auto rounded-full bg-white px-4 py-1.5 font-medium text-black disabled:bg-white/25"
              >
                Add {picked.length || ''}
              </button>
            )}
          </footer>
        )}
      </div>
    </div>
  )
}
