import { useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '../lib/utils'

/** Minimal anchored popover: opens above its trigger, closes on outside click / Escape. */
export function Popover({
  trigger,
  children,
  align = 'left',
  side = 'top',
  className,
  wrapperClassName,
  open: controlled,
  onOpenChange,
}: {
  trigger: (p: { open: boolean; toggle: () => void }) => ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  side?: 'top' | 'bottom'
  className?: string
  /** classes for the element wrapping trigger + panel (e.g. its width in a flex row) */
  wrapperClassName?: string
  open?: boolean
  onOpenChange?: (v: boolean) => void
}) {
  const [inner, setInner] = useState(false)
  const open = controlled ?? inner
  const setOpen = (v: boolean) => (onOpenChange ? onOpenChange(v) : setInner(v))
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  })

  return (
    <div ref={ref} className={cn('relative', wrapperClassName)}>
      {trigger({ open, toggle: () => setOpen(!open) })}
      {open && (
        <div
          className={cn(
            'absolute z-50 min-w-48 max-w-[calc(100vw-1.5rem)] rounded-xl border border-white/10 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-xl',
            side === 'top' ? 'bottom-full mb-2' : 'top-full mt-2',
            align === 'left' ? 'left-0' : 'right-0',
            className,
          )}
        >
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}

export function MenuItem({
  children,
  onClick,
  active,
  disabled,
  hint,
}: {
  children: ReactNode
  onClick?: () => void
  active?: boolean
  disabled?: boolean
  hint?: string
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      title={hint}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-white/85',
        'hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent',
        active && 'bg-white/10 text-white',
      )}
    >
      {children}
    </button>
  )
}
