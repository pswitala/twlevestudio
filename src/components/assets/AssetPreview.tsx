import { useEffect } from 'react'
import { AudioLines, Check, ChevronLeft, ChevronRight, ExternalLink, Mic, Music, X } from 'lucide-react'

/** Anything the library can show full size: an image, a video, or audio (speech / voice sample). */
export interface PreviewItem {
  id: string
  label: string
  media: 'image' | 'video' | 'audio'
  /** for audio: speech recording, voice sample, or uploaded music / sound */
  audioKind?: 'speech' | 'voice' | 'music'
  /** picture of the waveform (uploaded audio) */
  waveform?: string
  src?: string
  meta?: string
  /** longer text shown under audio: the script or the voice description */
  description?: string
  tags?: string[]
}

/** Full-size look at a library item. ←/→ step through `list`, Space selects, Esc closes. */
export function AssetPreview({
  item,
  list,
  onSelect,
  onClose,
  picked,
  pickLabel,
  onPick,
}: {
  item: PreviewItem
  list: PreviewItem[]
  onSelect: (id: string) => void
  onClose: () => void
  /** is this item in the library selection */
  picked?: boolean
  /** picker for a single frame: one-shot action label instead of select/deselect */
  pickLabel?: string
  onPick?: () => void
}) {
  const i = list.findIndex((a) => a.id === item.id)
  const prev = i > 0 ? list[i - 1] : undefined
  const next = i >= 0 && i < list.length - 1 ? list[i + 1] : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'Escape') {
        // close only the preview, not the library underneath
        e.stopImmediatePropagation()
        onClose()
      }
      // the preview owns these keys - the focused tile underneath must not act on them too
      // (Space reached it as well and toggled the selection straight back)
      if (e.key === 'ArrowLeft' && prev) {
        e.stopPropagation()
        onSelect(prev.id)
      }
      if (e.key === 'ArrowRight' && next) {
        e.stopPropagation()
        onSelect(next.id)
      }
      if (e.key === ' ' && onPick) {
        e.preventDefault()
        e.stopPropagation()
        onPick()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [prev, next, onSelect, onClose, onPick])

  const AudioIcon = item.audioKind === 'voice' ? AudioLines : item.audioKind === 'music' ? Music : Mic

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-md" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-[13px] sm:px-5 sm:py-3">
        <span className="truncate font-medium">{item.label}</span>
        <span className="text-white/45">
          {item.meta}
          {list.length > 1 ? ` · ${i + 1} / ${list.length}` : ''}
        </span>
        {!!item.tags?.length && (
          <span className="flex gap-1">
            {item.tags.map((t) => (
              <span key={t} className="rounded bg-fuchsia-400/20 px-1.5 text-[11.5px] text-fuchsia-100">{t}</span>
            ))}
          </span>
        )}
        {onPick && (
          <button
            type="button"
            onClick={onPick}
            className={
              picked
                ? 'ml-auto flex items-center gap-1.5 rounded-full bg-white px-3 py-1 font-medium text-black'
                : 'ml-auto flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1 text-white/85 hover:bg-white/20'
            }
            title="Space"
          >
            <Check className="size-3.5" /> {pickLabel ?? (picked ? 'Selected' : 'Select')}
          </button>
        )}
        {item.src && (
          <a href={item.src} target="_blank" rel="noreferrer" className={`${onPick ? '' : 'ml-auto '}flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-white/60 hover:bg-white/10 hover:text-white`}>
            <ExternalLink className="size-3.5" /> Open file
          </a>
        )}
        <button type="button" onClick={onClose} className="rounded-full p-1.5 text-white/70 hover:bg-white/10" title="Close (Esc)">
          <X className="size-4" />
        </button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-2 pb-4 sm:px-16 sm:pb-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
        {item.media === 'video' ? (
          <video key={item.id} src={item.src} controls autoPlay loop playsInline className="max-h-full max-w-full rounded-xl bg-black" />
        ) : item.media === 'image' ? (
          <img key={item.id} src={item.src} alt={item.label} className="max-h-full max-w-full rounded-xl object-contain" />
        ) : (
          <div className="flex w-full max-w-xl flex-col items-center gap-5 rounded-3xl bg-gradient-to-br from-fuchsia-500/15 via-sky-500/10 to-transparent p-8">
            {item.waveform ? <img src={item.waveform} alt="" className="h-28 w-full rounded-xl object-fill opacity-80" /> : <AudioIcon className="size-10 text-white/60" />}
            {item.src ? (
              <audio key={item.id} src={item.src} controls autoPlay className="w-full" />
            ) : (
              <p className="text-[13px] text-white/45">No sample to play - design the voice first.</p>
            )}
            {item.description && <p className="max-h-[35vh] w-full overflow-y-auto whitespace-pre-wrap text-[13px] leading-relaxed text-white/75">{item.description}</p>}
          </div>
        )}
        {prev && (
          <button type="button" onClick={() => onSelect(prev.id)} className="absolute left-4 rounded-full bg-white/10 p-2 hover:bg-white/20" title="Previous (←)">
            <ChevronLeft className="size-5" />
          </button>
        )}
        {next && (
          <button type="button" onClick={() => onSelect(next.id)} className="absolute right-4 rounded-full bg-white/10 p-2 hover:bg-white/20" title="Next (→)">
            <ChevronRight className="size-5" />
          </button>
        )}
      </div>
    </div>
  )
}
