import { useRef, useState, type ReactNode } from 'react'
import { FolderOpen, Upload, X } from 'lucide-react'
import type { Asset } from '../../../shared/types'
import { fileUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { MenuItem, Popover } from '../Popover'

/** One of the five tiles above the prompt (Start frame, End frame, Image refs, Video refs, Audio refs). */
export function AttachTile({
  label,
  icon,
  items,
  tokens,
  max,
  accept,
  disabled,
  onFiles,
  onLibrary,
  onRemove,
}: {
  label: string
  icon: ReactNode
  items: Asset[]
  /** @token shown on each attached item */
  tokens?: string[]
  max: number
  accept: string
  /** reason the tile is disabled */
  disabled?: string
  onFiles: (files: File[]) => void
  onLibrary: () => void
  onRemove: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const full = items.length >= max
  const first = items[0]

  const tile = (toggle: () => void, open: boolean) => (
    <button
      type="button"
      disabled={!!disabled && !items.length}
      title={disabled}
      onClick={toggle}
      onDragOver={(e) => {
        if (disabled) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        setDrag(false)
        if (!disabled && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files].slice(0, Math.max(1, max - items.length)))
      }}
      className={cn(
        'group relative flex h-[64px] w-full shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded-2xl sm:h-[78px] sm:w-[92px] sm:gap-2',
        'bg-white/[0.06] text-[11px] sm:text-[12.5px] text-white/75 transition hover:bg-white/10 hover:text-white',
        'disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-white/[0.06]',
        disabled && items.length > 0 && 'opacity-60 ring-1 ring-rose-400/60',
        (open || drag) && 'bg-white/12 ring-1 ring-white/30',
      )}
    >
      {first ? (
        <>
          <img src={fileUrl('thumbs', first.thumb)} alt="" className="absolute inset-0 size-full object-cover opacity-70 transition group-hover:opacity-90" />
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pb-1 pt-4 text-[11px] text-white">
            {label}
          </span>
          {items.length > 1 && (
            <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 text-[11px] font-medium text-white">{items.length}</span>
          )}
        </>
      ) : (
        <>
          {icon}
          <span>{label}</span>
        </>
      )}
    </button>
  )

  return (
    <>
      <input
        ref={input}
        type="file"
        hidden
        multiple={max > 1}
        accept={accept}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])].slice(0, Math.max(1, max - items.length))
          e.target.value = ''
          if (files.length) onFiles(files)
        }}
      />
      <Popover trigger={({ toggle, open }) => tile(toggle, open)} className="w-64" wrapperClassName="w-[calc(20%-5px)] shrink-0 sm:w-auto">
        {(close) => (
          <div className="flex flex-col gap-1">
            {items.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 p-1">
                {items.map((a, i) => (
                  <div key={a.id} className="group/item relative aspect-square overflow-hidden rounded-lg bg-black">
                    <img src={fileUrl('thumbs', a.thumb)} alt={a.label} title={a.label} className="size-full object-cover" />
                    {tokens?.[i] && (
                      <span className="absolute bottom-0.5 left-0.5 rounded bg-black/75 px-1 text-[10px] text-white">{tokens[i]}</span>
                    )}
                    <button
                      type="button"
                      onClick={() => onRemove(a.id)}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/75 p-0.5 text-white opacity-0 transition group-hover/item:opacity-100"
                      title="Remove"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            {disabled && <p className="px-2.5 py-1 text-[11.5px] text-rose-300">{disabled}</p>}
            <MenuItem
              disabled={!!disabled || (full && max > 1)}
              onClick={() => {
                close()
                input.current?.click()
              }}
            >
              <Upload className="size-3.5" /> {first && max === 1 ? 'Replace…' : 'Upload…'}
              <span className="ml-auto text-[11px] text-white/40">or drop</span>
            </MenuItem>
            <MenuItem
              disabled={!!disabled || (full && max > 1)}
              onClick={() => {
                close()
                onLibrary()
              }}
            >
              <FolderOpen className="size-3.5" /> From library…
            </MenuItem>
            {max > 1 && <p className="px-2.5 pb-1 text-[11px] text-white/40">{items.length} / {max}</p>}
          </div>
        )}
      </Popover>
    </>
  )
}
