import { useEffect, useState } from 'react'
import { AlertTriangle, Loader2, Mic, Music, RotateCw, Star, Trash2 } from 'lucide-react'
import { formatUsd, getModel } from '../../../shared/models'
import type { Generation } from '../../../shared/types'
import { useInvalidate } from '../../hooks/queries'
import { api, fileUrl } from '../../lib/api'
import { cn, elapsed, formatDuration } from '../../lib/utils'
import { useUi } from '../../stores/ui'
import { confirmAction } from '../ConfirmDialog'

function useTick(active: boolean) {
  const [, set] = useState(0)
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => set((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [active])
}

export function VideoCard({ g }: { g: Generation }) {
  const select = useUi((s) => s.select)
  const notify = useUi((s) => s.notify)
  const invalidate = useInvalidate()
  const [hover, setHover] = useState(false)
  const pending = g.status === 'queued' || g.status === 'running'
  useTick(pending)

  const act = (fn: () => Promise<unknown>) => async (e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      await fn()
      await invalidate('generations')
    } catch (err) {
      notify((err as Error).message, 'error')
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => select(g.id)}
      onKeyDown={(e) => e.key === 'Enter' && select(g.id)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/[0.07] bg-white/[0.03] text-left transition hover:border-white/20"
    >
      <div className="relative aspect-video bg-black">
        {g.kind === 'audio' && g.status === 'completed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-fuchsia-500/15 via-sky-500/10 to-transparent">
            <Mic className="size-7 text-white/60" />
            <span className="max-w-[80%] truncate text-[12px] text-white/55">{g.voices?.map((v) => v.name).join(' · ')}</span>
          </div>
        )}
        {g.thumb && <img src={fileUrl('thumbs', g.thumb)} alt="" className="absolute inset-0 size-full object-contain" loading="lazy" />}
        {g.kind === 'music' && g.status === 'completed' && (
          <Music className="absolute left-2 top-2 size-5 text-white/70 drop-shadow" />
        )}
        {hover && g.file && (g.kind ?? 'video') === 'video' && (
          <video src={fileUrl('videos', g.file)} autoPlay muted loop playsInline className="absolute inset-0 size-full object-contain" />
        )}
        {pending && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-gradient-to-br from-sky-500/10 via-fuchsia-500/10 to-transparent">
            <Loader2 className="size-6 animate-spin text-white/70" />
            <span className="text-[12px] text-white/70">{g.status === 'queued' ? 'queued' : g.phase ?? 'working'}</span>
            {g.startedAt && <span className="font-mono text-[11px] text-white/45">{elapsed(g.startedAt)}</span>}
          </div>
        )}
        {g.status === 'failed' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-rose-950/40 p-4 text-center">
            <AlertTriangle className="size-5 text-rose-300" />
            <p className="line-clamp-4 text-[12px] text-rose-100/90">{g.error}</p>
            <button
              type="button"
              onClick={act(() => api.retry(g.id))}
              className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-[12px] hover:bg-white/20"
            >
              <RotateCw className="size-3" /> Retry
            </button>
          </div>
        )}
        <div className="absolute left-2 top-2 flex gap-1">
          <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] text-white/80">{getModel(g.model).label}</span>
          {g.mode !== 'create' && <span className="rounded-md bg-sky-500/70 px-1.5 py-0.5 text-[11px] text-white">{g.mode}</span>}
        </div>
        <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100 pointer-coarse:opacity-100">
          <button
            type="button"
            onClick={async (e) => {
              e.stopPropagation()
              const what = (g.kind === 'image' ? 'photo' : g.kind === 'audio' ? 'recording' : g.kind === 'music' ? 'song' : 'video')
              if (await confirmAction({ title: `Delete this ${what}?`, message: `"${(g.title || g.prompt || what).slice(0, 80)}" and its file are removed from disk. This cannot be undone.` }))
                await act(() => api.deleteGeneration(g.id))(e)
            }}
            title="Delete" className="rounded-md bg-black/60 p-1 hover:bg-rose-500/80">
            <Trash2 className="size-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={act(() => api.patchGeneration(g.id, { favorite: !g.favorite }))}
          title="Favourite"
          className={cn('absolute bottom-2 right-2 rounded-md bg-black/60 p-1 transition', g.favorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100')}
        >
          <Star className={cn('size-3.5', g.favorite && 'fill-amber-300 text-amber-300')} />
        </button>
      </div>
      <div className="px-3 py-2">
        {!!g.tags?.length && (
          <div className="mb-1 flex flex-wrap gap-1">
            {g.tags.slice(0, 4).map((t) => (
              <span key={t} className="rounded bg-fuchsia-400/15 px-1.5 text-[10.5px] text-fuchsia-100/90">{t}</span>
            ))}
            {g.tags.length > 4 && <span className="text-[10.5px] text-white/40">+{g.tags.length - 4}</span>}
          </div>
        )}
        <p className="line-clamp-2 min-h-[2.5em] text-[12.5px] leading-snug text-white/80">{g.title || g.prompt || (g.mode === 'extend' ? 'Extend this video' : 'Untitled')}</p>
        <p className="mt-1 flex gap-2 text-[11px] text-white/40">
          {g.kind === 'audio' ? (
            <span>speech</span>
          ) : g.kind === 'music' ? (
            <span>music{g.settings.instrumental ? ' · instrumental' : ''}</span>
          ) : (
            <>
              <span>{g.kind === 'image' ? (g.width ? `${g.width}×${g.height}` : g.settings.imageSize) : g.settings.resolution}</span>
              <span>{g.settings.aspectRatio}</span>
            </>
          )}
          {g.durationS !== undefined && <span>{formatDuration(g.durationS)}</span>}
          {g.kind === 'video' && !g.settings.audio && <span>muted</span>}
          <span className="ml-auto">{formatUsd(g.cost.actualUsd ?? g.cost.estimatedUsd)}{g.cost.actualUsd === undefined ? '*' : ''}</span>
        </p>
      </div>
    </div>
  )
}
