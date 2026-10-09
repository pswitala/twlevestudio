import type { ReactNode } from 'react'
import { Check, Lock } from 'lucide-react'
import { cn } from '../lib/utils'
import { MenuItem, Popover } from './Popover'

export interface ChipOption<T> {
  value: T
  label: string
  disabled?: boolean
  hint?: string
}

const chipClass =
  'flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-white/75 transition hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40'

export function ChipSelect<T extends string | number | boolean>({
  icon,
  label,
  value,
  options,
  onChange,
  locked,
  title,
}: {
  icon: ReactNode
  label: string
  value: T
  options: ChipOption<T>[]
  onChange: (v: T) => void
  locked?: string
  title?: string
}) {
  if (locked) {
    return (
      <span className={cn(chipClass, 'cursor-help text-white/55 hover:bg-transparent')} title={locked}>
        {icon}
        {label}
        <Lock className="size-3 opacity-60" />
      </span>
    )
  }
  return (
    <Popover
      trigger={({ toggle, open }) => (
        <button type="button" className={cn(chipClass, open && 'bg-white/10 text-white')} onClick={toggle} title={title}>
          {icon}
          {label}
        </button>
      )}
    >
      {(close) =>
        options.map((o) => (
          <MenuItem
            key={String(o.value)}
            active={o.value === value}
            disabled={o.disabled}
            hint={o.hint}
            onClick={() => {
              onChange(o.value)
              close()
            }}
          >
            <span className="flex-1">{o.label}</span>
            {o.value === value && <Check className="size-3.5" />}
          </MenuItem>
        ))
      }
    </Popover>
  )
}

export function Chip({
  icon,
  label,
  onClick,
  active,
  title,
  disabled,
}: {
  icon: ReactNode
  label: string
  onClick: () => void
  active?: boolean
  title?: string
  disabled?: boolean
}) {
  return (
    <button type="button" className={cn(chipClass, active === false && 'text-white/45')} onClick={onClick} title={title} disabled={disabled}>
      {icon}
      {label}
    </button>
  )
}
