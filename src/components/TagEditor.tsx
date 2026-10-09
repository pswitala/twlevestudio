import { useState } from 'react'
import { Tag, X } from 'lucide-react'
import { normalizeTag } from '../../shared/tags'
import { cn } from '../lib/utils'

/** Chips + input. Enter or comma adds, Backspace on an empty input removes the last tag. */
export function TagEditor({
  tags,
  onChange,
  suggestions = [],
  placeholder = 'Add tag…',
  autoFocus,
}: {
  tags: string[]
  onChange: (tags: string[]) => void
  /** existing tags, most used first */
  suggestions?: string[]
  placeholder?: string
  autoFocus?: boolean
}) {
  const [text, setText] = useState('')
  const add = (raw: string) => {
    const next = [...tags]
    for (const part of raw.split(',')) {
      const t = normalizeTag(part)
      if (t && !next.includes(t)) next.push(t)
    }
    if (next.length !== tags.length) onChange(next)
    setText('')
  }
  const q = normalizeTag(text)
  const hints = suggestions.filter((s) => !tags.includes(s) && (!q || s.includes(q))).slice(0, 8)

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-1 rounded-lg bg-white/[0.05] px-1.5 py-1">
        {tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-md bg-fuchsia-400/15 px-1.5 py-0.5 text-[12px] text-fuchsia-100">
            {t}
            <button type="button" onClick={() => onChange(tags.filter((x) => x !== t))} className="text-fuchsia-200/60 hover:text-white" title="Remove">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={text}
          placeholder={tags.length ? '' : placeholder}
          onChange={(e) => {
            if (e.target.value.includes(',')) add(e.target.value)
            else setText(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add(text)
            }
            if (e.key === 'Backspace' && !text && tags.length) onChange(tags.slice(0, -1))
          }}
          onBlur={() => text.trim() && add(text)}
          className="min-w-24 flex-1 bg-transparent px-1 py-0.5 text-[12.5px] placeholder:text-white/35 focus:outline-none"
        />
      </div>
      {hints.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {hints.map((s) => (
            <button
              key={s}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(s)}
              className="flex items-center gap-1 rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[11.5px] text-white/60 hover:bg-white/12 hover:text-white"
            >
              <Tag className="size-3" /> {s}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/** Clickable tag chips used as a filter (AND). */
export function TagFilterBar({
  counts,
  selected,
  onToggle,
  onClear,
  className,
}: {
  counts: [string, number][]
  selected: string[]
  onToggle: (t: string) => void
  onClear: () => void
  className?: string
}) {
  if (!counts.length) return null
  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      <Tag className="mr-0.5 size-3.5 text-white/35" />
      {counts.map(([t, n]) => (
        <button
          key={t}
          type="button"
          onClick={() => onToggle(t)}
          className={cn(
            'rounded-full px-2 py-0.5 text-[12px] transition',
            selected.includes(t) ? 'bg-fuchsia-300 text-black' : 'bg-white/[0.06] text-white/65 hover:bg-white/12 hover:text-white',
          )}
        >
          {t} <span className={selected.includes(t) ? 'text-black/50' : 'text-white/35'}>{n}</span>
        </button>
      ))}
      {selected.length > 0 && (
        <button type="button" onClick={onClear} className="ml-1 text-[12px] text-white/45 hover:text-white">
          clear
        </button>
      )}
    </div>
  )
}
