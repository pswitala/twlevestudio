import { useState, type ReactNode } from 'react'
import { Folder as FolderIcon, Search } from 'lucide-react'
import { useFolders } from '../../hooks/queries'
import { groupByFolder } from '../../lib/folders'
import type { Project } from '../../../shared/types'
import { Popover } from '../Popover'

/** Button + searchable project list; picking a project calls `onPick`. */
export function ProjectTargetMenu({
  label,
  icon,
  projects,
  onPick,
  disabled,
  side = 'top',
  align = 'left',
  title,
}: {
  label: string
  icon: ReactNode
  projects: Project[]
  onPick: (projectId: string) => void
  disabled?: boolean
  side?: 'top' | 'bottom'
  align?: 'left' | 'right'
  title?: string
}) {
  const [q, setQ] = useState('')
  const { data: folders = [] } = useFolders()
  const groups = groupByFolder(projects, folders, q)
  return (
    <Popover
      side={side}
      align={align}
      className="w-64 p-2"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          disabled={disabled}
          onClick={toggle}
          title={title}
          className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-white/80 hover:bg-white/15 disabled:opacity-40 ${open ? 'bg-white/15' : 'bg-white/[0.08]'}`}
        >
          {icon} {label}
        </button>
      )}
    >
      {(close) => (
        <>
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
          <div className="max-h-72 overflow-y-auto">
            {groups.map((g) => (
              <div key={g.folder?.id ?? 'root'}>
                {g.folder ? (
                  <p className="flex items-center gap-1.5 px-2.5 pb-0.5 pt-1.5 text-[11.5px] font-medium text-white/55">
                    <FolderIcon className="size-3.5 text-white/40" /> <span className="truncate">{g.folder.name}</span>
                  </p>
                ) : (
                  groups.length > 1 && <p className="px-2.5 pb-0.5 pt-1.5 text-[10.5px] uppercase tracking-wide text-white/30">No folder</p>
                )}
                {g.projects.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      close()
                      setQ('')
                      onPick(p.id)
                    }}
                    className={`flex w-full items-center rounded-lg py-1.5 pr-2.5 text-left text-[13px] hover:bg-white/10 ${g.folder ? 'pl-7' : 'pl-2.5'}`}
                  >
                    <span className="truncate">{p.name}</span>
                  </button>
                ))}
              </div>
            ))}
            {!groups.length && <p className="px-2.5 py-2 text-[12px] text-white/40">No project matches.</p>}
          </div>
        </>
      )}
    </Popover>
  )
}
