import { useEffect, useMemo } from 'react'
import { Clapperboard, FolderOpen, KeyRound, Menu, Search, Sparkles, Star, Wand2 } from 'lucide-react'
import { DEFAULT_PROJECT_ID } from '../shared/types'
import { hasAllTags, tagCounts } from '../shared/tags'
import { TagFilterBar } from './components/TagEditor'
import { formatUsd, MODELS } from '../shared/models'
import { AssetLibraryDialog } from './components/assets/AssetLibraryDialog'
import { TrimDialog } from './components/assets/TrimDialog'
import { Composer } from './components/composer/Composer'
import { PlayerPanel } from './components/library/PlayerPanel'
import { ProjectDefaultsDialog } from './components/ProjectDefaultsDialog'
import { VoicesDialog } from './components/VoicesDialog'
import { ProjectSidebar } from './components/ProjectSidebar'
import { VideoCard } from './components/library/VideoCard'
import { useConfig, useGenerations, useProjects } from './hooks/queries'
import { cn } from './lib/utils'
import { useUi } from './stores/ui'
import { ConfirmDialog } from './components/ConfirmDialog'
import { StudioView } from './components/studio/StudioView'

export default function App() {
  const { data: config } = useConfig()
  const { data: generations = [], isLoading } = useGenerations()
  const ui = useUi()
  const { data: projects = [] } = useProjects()
  const projectName = ui.projectId ? (projects.find((p) => p.id === ui.projectId)?.name ?? '') : 'All projects'

  // A deleted project (in another tab) falls back to Default.
  useEffect(() => {
    if (ui.projectId && projects.length && !projects.some((p) => p.id === ui.projectId)) ui.setProject(DEFAULT_PROJECT_ID)
  }, [projects, ui])

  const inView = useMemo(
    () => generations.filter((g) => !ui.projectId || (g.projectId ?? DEFAULT_PROJECT_ID) === ui.projectId),
    [generations, ui.projectId],
  )

  const list = useMemo(() => {
    const q = ui.search.trim().toLowerCase()
    return inView.filter(
      (g) =>
        (!ui.kindFilter || (g.kind ?? 'video') === ui.kindFilter) &&
        (!ui.modelFilter || g.model === ui.modelFilter) &&
        (!ui.favOnly || g.favorite) &&
        hasAllTags(g, ui.tagFilter) &&
        (!q || `${g.title ?? ''} ${g.prompt} ${g.enhancedPrompt ?? ''} ${(g.tags ?? []).join(' ')}`.toLowerCase().includes(q)),
    )
  }, [inView, ui.search, ui.modelFilter, ui.favOnly, ui.kindFilter, ui.tagFilter])

  const monthSpend = useMemo(() => {
    const now = new Date()
    return inView
      .filter((g) => {
        const d = new Date(g.createdAt)
        return g.status === 'completed' && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
      })
      .reduce((sum, g) => sum + (g.cost.actualUsd ?? g.cost.estimatedUsd), 0)
  }, [inView])

  const active = generations.filter((g) => g.status === 'queued' || g.status === 'running').length

  return (
    <div className="flex h-full flex-col">
      <header className="sticky top-0 z-30 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-white/[0.06] bg-neutral-950/70 px-3 py-2 backdrop-blur-xl md:px-5 md:py-3">
        <button
          type="button"
          onClick={() => ui.setSidebarOpen(true)}
          className="-ml-1 rounded-lg p-1.5 text-white/70 hover:bg-white/10 md:hidden"
          title="Projects"
          aria-label="Open projects"
        >
          <Menu className="size-5" />
        </button>
        <div className="flex items-center gap-2 text-[15px] font-semibold tracking-tight">
          <Sparkles className="size-4 text-fuchsia-300" /> twelvestudio
        </div>
        <span className="min-w-0 max-w-48 flex-1 truncate text-[13px] text-white/45 md:ml-2 md:flex-none">/ {projectName}</span>

        <div className="flex shrink-0 rounded-lg bg-white/[0.06] p-0.5 text-[12.5px]">
          {([['generate', 'Generate', Wand2], ['studio', 'Studio', Clapperboard]] as const).map(([v, label, Icon]) => (
            <button
              key={v}
              type="button"
              onClick={() => ui.setView(v)}
              className={cn('flex items-center gap-1.5 rounded-md px-2 py-1 sm:px-2.5', ui.view === v ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}
              title={v === 'studio' ? 'Timeline editor: combine clips, photos, speech and music into one video' : 'Generate videos, photos and speech'}
            >
              <Icon className="size-3.5" /> <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* filters: own full-width row on phones, inline on desktop */}
        {ui.view === 'generate' ? (
        <div className="order-last flex w-full min-w-0 items-center gap-2 md:order-none md:w-auto md:flex-1 md:gap-3">
          <div className="flex shrink-0 rounded-lg bg-white/[0.06] p-0.5 text-[12.5px]">
            {([['', 'All'], ['video', 'Videos'], ['image', 'Photos'], ['audio', 'Speech'], ['music', 'Music']] as const).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => ui.setKindFilter(k)}
                className={cn('rounded-md px-2 py-1 sm:px-2.5', ui.kindFilter === k ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="relative min-w-0 flex-1 md:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
            <input
              value={ui.search}
              onChange={(e) => ui.setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full rounded-lg bg-white/[0.06] py-1.5 pl-8 pr-3 text-[13px] placeholder:text-white/35 focus:bg-white/10 focus:outline-none"
            />
          </div>
          <select
            value={ui.modelFilter}
            onChange={(e) => ui.setModelFilter(e.target.value)}
            className="hidden rounded-lg bg-white/[0.06] px-2 py-1.5 text-[13px] text-white/80 focus:outline-none sm:block"
          >
            <option value="" className="bg-neutral-900">All models</option>
            {MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-neutral-900">{m.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => ui.setFavOnly(!ui.favOnly)}
            className={cn('shrink-0 rounded-lg p-1.5 hover:bg-white/10', ui.favOnly ? 'text-amber-300' : 'text-white/50')}
            title="Favourites only"
          >
            <Star className={cn('size-4', ui.favOnly && 'fill-amber-300')} />
          </button>
        </div>
        ) : (
          <span className="hidden md:block md:flex-1" />
        )}

        <div className="ml-auto flex items-center gap-2 text-[12.5px] text-white/50 md:gap-3">
          <button type="button" onClick={() => ui.openLibrary()} className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-white/70 hover:bg-white/10" title="Library">
            <FolderOpen className="size-4" /> <span className="hidden sm:inline">Library</span>
          </button>
          {active > 0 && (
            <span className="text-sky-300">
              {active}
              <span className="hidden lg:inline"> in progress</span>
            </span>
          )}
          <span className="hidden lg:inline" title="Completed items in this view this month (actual cost where Google reported usage, otherwise the estimate)">
            This month: <span className="text-white/80">{formatUsd(monthSpend)}</span>
          </span>
          {config && !config.hasKey && (
            <span className="flex items-center gap-1 rounded-md bg-rose-500/15 px-2 py-1 text-rose-200" title="Create twelvelabs/.env.local with GEMINI_API_KEY=... and restart">
              <KeyRound className="size-3.5" /> <span className="hidden sm:inline">GEMINI_API_KEY missing</span>
            </span>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
      <ProjectSidebar className="hidden w-56 md:flex" />
      {ui.sidebarOpen && (
        // phone: the same sidebar as a drawer
        <div className="fixed inset-0 z-40 flex md:hidden">
          <ProjectSidebar className="flex h-full w-72 max-w-[85vw] bg-neutral-950 shadow-2xl" onClose={() => ui.setSidebarOpen(false)} />
          <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={() => ui.setSidebarOpen(false)} />
        </div>
      )}
      {ui.view === 'studio' ? (
        <main className="min-w-0 flex-1 overflow-hidden">
          <StudioView />
        </main>
      ) : (
      <main
        className={cn(
          'min-w-0 flex-1 overflow-y-auto px-3 pt-3 md:px-5 md:pt-5',
          ui.composerCollapsed ? 'pb-24 md:pb-28' : 'pb-[min(75vh,560px)] md:pb-[300px]',
        )}
      >
        <TagFilterBar
          counts={tagCounts(inView)}
          selected={ui.tagFilter}
          onToggle={(t) => ui.setTagFilter(ui.tagFilter.includes(t) ? ui.tagFilter.filter((x) => x !== t) : [...ui.tagFilter, t])}
          onClear={() => ui.setTagFilter([])}
          className="mb-3"
        />
        {isLoading ? null : list.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(300px,100%),1fr))] gap-3">
            {list.map((g) => (
              <VideoCard key={g.id} g={g} />
            ))}
          </div>
        ) : (
          <div className="mx-auto mt-24 max-w-md text-center text-white/45">
            <Sparkles className="mx-auto mb-3 size-8 text-white/25" />
            <p className="text-[15px] text-white/70">{inView.length ? 'Nothing matches the filters.' : `Nothing in ${projectName} yet.`}</p>
            {!inView.length && (
              <p className="mt-1 text-[13px]">
                Describe a scene below - switch to <b className="text-white/70">Photo</b> for stills. Attach frames or refs and reference them
                with <span className="font-mono text-white/70">@</span>. Use 360p video drafts to iterate cheaply.
              </p>
            )}
          </div>
        )}
      </main>
      )}
      </div>

      {ui.view === 'generate' && (
      <div className="pointer-events-none fixed bottom-0 left-0 right-0 z-30 flex justify-center bg-gradient-to-t from-neutral-950 via-neutral-950/70 to-transparent px-2 pb-2 pt-10 md:left-56 md:px-4 md:pb-5 md:pt-16">
        <div className="pointer-events-auto flex w-full justify-center">
          <Composer />
        </div>
      </div>
      )}

      <PlayerPanel list={list} all={generations} />
      <AssetLibraryDialog />
      <TrimDialog />
      <ProjectDefaultsDialog />
      <VoicesDialog />
      <ConfirmDialog />
      <Toast />
    </div>
  )
}

function Toast() {
  const toast = useUi((s) => s.toast)
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useUi.setState({ toast: undefined }), toast.kind === 'error' ? 7000 : 2500)
    return () => clearTimeout(t)
  }, [toast])
  if (!toast) return null
  return (
    <div
      className={cn(
        'fixed left-1/2 top-16 z-[70] w-max max-w-[calc(100vw-1.5rem)] -translate-x-1/2 rounded-xl px-4 py-2 text-[13px] shadow-2xl sm:max-w-xl',
        toast.kind === 'error' ? 'bg-rose-600/95 text-white' : 'bg-white/95 text-black',
      )}
      onClick={() => useUi.setState({ toast: undefined })}
    >
      {toast.text}
    </div>
  )
}
