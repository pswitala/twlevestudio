import { useState } from 'react'
import { Check, ChevronDown, Folder as FolderIcon, FolderOpen, Minus, Search } from 'lucide-react'
import { useFolders } from '../../hooks/queries'
import { groupByFolder } from '../../lib/folders'
import type { Project } from '../../../shared/types'
import { cn } from '../../lib/utils'
import { Popover } from '../Popover'

/**
 * Multi-project filter with search. `selected` empty = all projects.
 * `counts` - items per project id, shown next to each name.
 */
export function ProjectPicker({
  projects,
  selected,
  onChange,
  counts,
  className,
}: {
  projects: Project[]
  selected: string[]
  onChange: (ids: string[]) => void
  counts: Map<string, number>
  className?: string
}) {
  const [q, setQ] = useState('')
  const all = selected.length === 0
  const label = all
    ? 'All projects'
    : selected.length === 1
      ? (projects.find((p) => p.id === selected[0])?.name ?? '1 project')
      : `${selected.length} projects`
  const { data: folders = [] } = useFolders()
  const groups = groupByFolder(projects, folders, q)
  const total = [...counts.values()].reduce((a, b) => a + b, 0)

  const commit = (next: string[]) => onChange(next.length === projects.length ? [] : next) // every project = "all"
  const toggle = (id: string) => commit(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  /** folder checkbox: tick all its projects, or untick them when all are ticked */
  const toggleFolder = (ids: string[]) => {
    const allOn = ids.every((id) => selected.includes(id))
    commit(allOn ? selected.filter((x) => !ids.includes(x)) : [...new Set([...selected, ...ids])])
  }

  const row = 'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-white/10'
  const box = (on: boolean) =>
    cn('flex size-4 shrink-0 items-center justify-center rounded border', on ? 'border-white bg-white text-black' : 'border-white/30')

  return (
    <Popover
      side="bottom"
      align="right"
      className="w-72 p-2"
      trigger={({ toggle: t, open }) => (
        <button
          type="button"
          onClick={t}
          className={cn(
            'flex max-w-56 items-center gap-1.5 rounded-lg bg-white/[0.07] px-3 py-1.5 text-[12.5px] text-white/80 hover:bg-white/12',
            open && 'bg-white/15',
            className,
          )}
          title="Projects shown in the library"
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown className="size-3.5 shrink-0 text-white/50" />
        </button>
      )}
    >
      <div className="relative mb-1">
        <Search className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-white/35" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find project or folder…"
          className="w-full rounded-lg bg-white/[0.06] py-1.5 pl-8 pr-3 text-[12.5px] placeholder:text-white/35 focus:outline-none"
        />
      </div>
      {!q.trim() && (
        <button type="button" onClick={() => onChange([])} className={row}>
          <span className={box(all)}>{all && <Check className="size-3" />}</span>
          <span className="flex-1">All projects</span>
          <span className="text-[11px] text-white/35">{total}</span>
        </button>
      )}
      <div className="max-h-72 overflow-y-auto">
        {groups.map((g) => {
          const ids = g.projects.map((p) => p.id)
          const on = ids.filter((id) => selected.includes(id)).length
          return (
            <div key={g.folder?.id ?? 'root'}>
              {g.folder ? (
                <button type="button" onClick={() => toggleFolder(ids)} className={cn(row, 'font-medium text-white/80')} title="Select the whole folder">
                  <span className={box(on > 0)}>{on === ids.length ? <Check className="size-3" /> : on > 0 ? <Minus className="size-3" /> : null}</span>
                  <FolderIcon className="size-3.5 shrink-0 text-white/50" />
                  <span className="flex-1 truncate">{g.folder.name}</span>
                  <span className="text-[11px] font-normal text-white/35">{ids.reduce((n, id) => n + (counts.get(id) ?? 0), 0)}</span>
                </button>
              ) : (
                groups.length > 1 && <p className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] uppercase tracking-wide text-white/30">No folder</p>
              )}
              {g.projects.map((p) => {
                const pOn = selected.includes(p.id)
                return (
                  <button key={p.id} type="button" onClick={() => toggle(p.id)} className={cn(row, g.folder && 'pl-8')}>
                    <span className={box(pOn)}>{pOn && <Check className="size-3" />}</span>
                    <span className="flex-1 truncate">{p.name}</span>
                    <span className="text-[11px] text-white/35">{counts.get(p.id) ?? 0}</span>
                  </button>
                )
              })}
            </div>
          )
        })}
        {!groups.length && <p className="px-2.5 py-2 text-[12px] text-white/40">No project matches.</p>}
      </div>
      {!all && (
        <button type="button" onClick={() => onChange([])} className="mt-1 w-full rounded-lg px-2.5 py-1 text-left text-[12px] text-white/45 hover:text-white">
          Clear - show all
        </button>
      )}
    </Popover>
  )
}
