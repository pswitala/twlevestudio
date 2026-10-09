import { useState, type DragEvent } from 'react'
import {
  ArrowDown,
  ArrowUp,
  AudioLines,
  Check,
  ChevronDown,
  ChevronRight,
  Folder as FolderIcon,
  FolderInput,
  FolderPlus,
  Layers,
  MoreHorizontal,
  Pencil,
  Plus,
  SlidersHorizontal,
  Trash2,
  X,
} from 'lucide-react'
import { DEFAULT_PROJECT_ID, type Folder, type Project } from '../../shared/types'
import { DIRECTIVE_KEYS } from '../../shared/directives'
import { useFolders, useGenerations, useInvalidate, useProjects, useVoices } from '../hooks/queries'
import { api } from '../lib/api'
import { byOrder } from '../lib/folders'
import { cn } from '../lib/utils'
import { useUi } from '../stores/ui'
import { MenuItem, Popover } from './Popover'
import { confirmAction } from './ConfirmDialog'

const DRAG_TYPE = 'application/x-twelvelabs-sidebar'
/** drop target id for "no folder" */
const ROOT = '__root__'

/**
 * Projects (every video, photo and ref lives in one) grouped in folders, in a saved order.
 * Drag a project onto another project (above / below it, joining its folder), onto a folder header (into it)
 * or onto "Projects" (out of any folder); drag a folder onto another folder to reorder folders.
 * Touch screens have no drag and drop - the ⋯ menus offer Move up / down and Move to folder.
 */
export function ProjectSidebar({ className, onClose }: { className?: string; onClose?: () => void } = {}) {
  const { data: projects = [] } = useProjects()
  const { data: folders = [] } = useFolders()
  const { data: generations = [] } = useGenerations()
  const { projectId, setProject, notify, openDefaults, openVoices, collapsedFolders, toggleFolder } = useUi()
  const invalidate = useInvalidate()
  const [creating, setCreating] = useState<'project' | 'folder'>()
  const [renaming, setRenaming] = useState<string>()
  const [name, setName] = useState('')
  const [drag, setDrag] = useState<{ kind: 'project' | 'folder'; id: string }>()
  /** where the dragged item would land: before / after a row, or into a folder (ROOT = top level) */
  const [hint, setHint] = useState<{ target: string; pos: 'before' | 'after' | 'into' }>()
  // "All projects" works on Default, like new generations do
  const activeId = projectId || DEFAULT_PROJECT_ID
  const active = projects.find((p) => p.id === activeId)
  const { project: activeVoices } = useVoices(activeId)
  const defaultsCount = DIRECTIVE_KEYS.filter((k) => active?.defaults?.[k]).length

  const counts = new Map<string, number>()
  for (const g of generations) counts.set(g.projectId ?? DEFAULT_PROJECT_ID, (counts.get(g.projectId ?? DEFAULT_PROJECT_ID) ?? 0) + 1)
  const folderIds = new Set(folders.map((f) => f.id))
  const sortedFolders = byOrder(folders)
  const sortedProjects = byOrder(projects)
  const containerOf = (p: Project) => (p.folderId && folderIds.has(p.folderId) ? p.folderId : null)
  const listIn = (folderId: string | null) => sortedProjects.filter((p) => containerOf(p) === folderId)
  const rootProjects = listIn(null)

  const fail = (e: unknown) => notify((e as Error).message, 'error')

  async function create() {
    const n = name.trim()
    const what = creating
    setCreating(undefined)
    setName('')
    if (!n) return
    try {
      if (what === 'folder') {
        await api.createFolder(n)
        await invalidate('folders')
      } else {
        const p = await api.createProject(n)
        await invalidate('projects')
        setProject(p.id)
      }
    } catch (e) {
      fail(e)
    }
  }

  async function renameProject(p: Project) {
    const n = name.trim()
    setRenaming(undefined)
    setName('')
    if (!n || n === p.name) return
    await api.renameProject(p.id, n)
    await invalidate('projects')
  }

  async function renameFolder(f: Folder) {
    const n = name.trim()
    setRenaming(undefined)
    setName('')
    if (!n || n === f.name) return
    await api.renameFolder(f.id, n)
    await invalidate('folders')
  }

  /** Put a project into `folderId` (null = top level) next to `anchorId`, or at the end. */
  async function placeProject(id: string, folderId: string | null, anchorId?: string, after = false) {
    const ids = listIn(folderId).map((p) => p.id).filter((x) => x !== id)
    const at = anchorId ? ids.indexOf(anchorId) + (after ? 1 : 0) : ids.length
    ids.splice(at < 0 ? ids.length : at, 0, id)
    try {
      await api.reorderProjects(ids, folderId)
      await invalidate('projects')
      // make the moved project visible
      if (folderId && collapsedFolders.includes(folderId)) toggleFolder(folderId)
    } catch (e) {
      fail(e)
    }
  }

  const moveProject = (id: string, folderId: string | null) => placeProject(id, folderId)

  async function placeFolder(id: string, anchorId: string, after: boolean) {
    const ids = sortedFolders.map((f) => f.id).filter((x) => x !== id)
    ids.splice(ids.indexOf(anchorId) + (after ? 1 : 0), 0, id)
    try {
      await api.reorderFolders(ids)
      await invalidate('folders')
    } catch (e) {
      fail(e)
    }
  }

  /** ⋯ menu Move up / down - the touch-screen way to reorder */
  function nudgeProject(p: Project, step: -1 | 1) {
    const list = listIn(containerOf(p))
    const i = list.findIndex((x) => x.id === p.id)
    const other = list[i + step]
    if (other) void placeProject(p.id, containerOf(p), other.id, step > 0)
  }

  function nudgeFolder(f: Folder, step: -1 | 1) {
    const i = sortedFolders.findIndex((x) => x.id === f.id)
    const other = sortedFolders[i + step]
    if (other) void placeFolder(f.id, other.id, step > 0)
  }

  async function removeProject(p: Project) {
    const ok = await confirmAction({
      title: `Delete project "${p.name}"?`,
      message: 'Its videos, photos, recordings, refs and voices move to Default - no media is deleted.',
      confirmLabel: 'Delete project',
    })
    if (!ok) return
    try {
      const r = await api.deleteProject(p.id)
      await invalidate('projects', 'generations', 'assets', 'voices')
      if (projectId === p.id) setProject(DEFAULT_PROJECT_ID)
      notify(`Project deleted - ${r.moved} item${r.moved === 1 ? '' : 's'} moved to Default`)
    } catch (e) {
      fail(e)
    }
  }

  async function removeFolder(f: Folder) {
    const n = projects.filter((p) => p.folderId === f.id).length
    const ok = await confirmAction({
      title: `Delete folder "${f.name}"?`,
      message: n ? `Its ${n} project${n === 1 ? '' : 's'} move${n === 1 ? 's' : ''} back to the top level - no project or media is deleted.` : 'The folder is empty.',
      confirmLabel: 'Delete folder',
    })
    if (!ok) return
    try {
      await api.deleteFolder(f.id)
      await invalidate('folders', 'projects')
    } catch (e) {
      fail(e)
    }
  }

  // ---------- drag and drop ----------
  const endDrag = () => {
    setDrag(undefined)
    setHint(undefined)
  }
  const half = (e: DragEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    return e.clientY > r.top + r.height / 2 ? 'after' : 'before'
  }
  const sameHint = (t: string, pos: string) => hint?.target === t && hint.pos === pos

  /** a project dropped on another project: above / below it, in its folder */
  const projectDrop = (p: Project) => ({
    onDragOver: (e: DragEvent) => {
      if (drag?.kind !== 'project' || drag.id === p.id) return
      e.preventDefault()
      e.stopPropagation()
      const pos = half(e)
      if (!sameHint(p.id, pos)) setHint({ target: p.id, pos })
    },
    onDrop: (e: DragEvent) => {
      if (drag?.kind !== 'project') return
      e.preventDefault()
      e.stopPropagation()
      const id = drag.id
      const after = half(e) === 'after'
      endDrag()
      if (id !== p.id) void placeProject(id, containerOf(p), p.id, after)
    },
  })

  /** a folder header: projects go INTO it, folders go above / below it */
  const folderHeaderDrop = (f: Folder) => ({
    onDragOver: (e: DragEvent) => {
      if (!drag || (drag.kind === 'folder' && drag.id === f.id)) return
      e.preventDefault()
      e.stopPropagation()
      const pos = drag.kind === 'folder' ? half(e) : 'into'
      if (!sameHint(f.id, pos)) setHint({ target: f.id, pos })
    },
    onDrop: (e: DragEvent) => {
      if (!drag) return
      e.preventDefault()
      e.stopPropagation()
      const d = drag
      const after = half(e) === 'after'
      endDrag()
      if (d.kind === 'project') void placeProject(d.id, f.id)
      else if (d.id !== f.id) void placeFolder(d.id, f.id, after)
    },
  })

  /** empty space of a folder, or the "Projects" heading (ROOT): a project goes in at the end */
  const intoDrop = (target: string) => ({
    onDragOver: (e: DragEvent) => {
      if (drag?.kind !== 'project') return
      e.preventDefault()
      if (!sameHint(target, 'into')) setHint({ target, pos: 'into' })
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as Node).contains(e.relatedTarget as Node)) setHint((h) => (h?.target === target ? undefined : h))
    },
    onDrop: (e: DragEvent) => {
      if (drag?.kind !== 'project') return
      e.preventDefault()
      const id = drag.id
      endDrag()
      void placeProject(id, target === ROOT ? null : target)
    },
  })

  /** the line showing where a dragged row will land */
  const lineFor = (id: string) =>
    hint?.target === id && hint.pos === 'before'
      ? 'shadow-[inset_0_2px_0_0_rgb(240_171_252)]'
      : hint?.target === id && hint.pos === 'after'
        ? 'shadow-[inset_0_-2px_0_0_rgb(240_171_252)]'
        : ''
  const intoRing = (id: string) => hint?.target === id && hint.pos === 'into' && 'bg-fuchsia-500/15 ring-1 ring-fuchsia-300/50'

  const row = 'group flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] transition'

  const projectRow = (p: Project, nested: boolean) =>
    renaming === p.id ? (
      <NameInput key={p.id} value={name} onChange={setName} onDone={() => renameProject(p)} onCancel={() => setRenaming(undefined)} />
    ) : (
      <div
        key={p.id}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, p.id)
          e.dataTransfer.effectAllowed = 'move'
          setDrag({ kind: 'project', id: p.id })
        }}
        onDragEnd={endDrag}
        {...projectDrop(p)}
        className={cn(
          row,
          'pr-1',
          nested && 'pl-6',
          projectId === p.id ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5',
          drag?.id === p.id && 'opacity-40',
          lineFor(p.id),
        )}
      >
        <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setProject(p.id)}>
          <span className={cn('size-2 shrink-0 rounded-full', projectId === p.id ? 'bg-fuchsia-300' : 'bg-white/25')} />
          <span className="flex-1 truncate">{p.name}</span>
          {!!(p.defaults?.style || p.defaults?.camera || p.defaults?.negative) && (
            <SlidersHorizontal className="size-3 shrink-0 text-white/35" aria-label="has defaults" />
          )}
        </button>
        <span className="text-[11px] text-white/35 group-hover:hidden pointer-coarse:hidden">{counts.get(p.id) ?? 0}</span>
        <Popover
          side="bottom"
          align="right"
          trigger={({ toggle }) => (
            <button type="button" onClick={toggle} className="hidden rounded p-0.5 text-white/50 hover:text-white group-hover:block pointer-coarse:block">
              <MoreHorizontal className="size-3.5" />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuItem
                onClick={() => {
                  close()
                  setName(p.name)
                  setRenaming(p.id)
                }}
              >
                <Pencil className="size-3.5" /> Rename
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  openDefaults(p.id)
                }}
              >
                <SlidersHorizontal className="size-3.5" /> Defaults…
              </MenuItem>
              <MenuItem
                onClick={() => {
                  close()
                  openVoices(p.id)
                }}
              >
                <AudioLines className="size-3.5" /> Voices…
              </MenuItem>
              {(() => {
                const list = listIn(containerOf(p))
                const i = list.findIndex((x) => x.id === p.id)
                return (
                  <>
                    <MenuItem
                      disabled={i <= 0}
                      onClick={() => {
                        close()
                        nudgeProject(p, -1)
                      }}
                    >
                      <ArrowUp className="size-3.5" /> Move up
                    </MenuItem>
                    <MenuItem
                      disabled={i < 0 || i >= list.length - 1}
                      onClick={() => {
                        close()
                        nudgeProject(p, 1)
                      }}
                    >
                      <ArrowDown className="size-3.5" /> Move down
                    </MenuItem>
                  </>
                )
              })()}
              {(folders.length > 0 || p.folderId) && (
                <>
                  <p className="mt-1 flex items-center gap-1.5 px-2.5 pb-0.5 pt-1 text-[11px] uppercase tracking-wide text-white/35">
                    <FolderInput className="size-3" /> Move to folder
                  </p>
                  {p.folderId && (
                    <MenuItem
                      onClick={() => {
                        close()
                        void moveProject(p.id, null)
                      }}
                    >
                      <span className="w-3.5" /> No folder
                    </MenuItem>
                  )}
                  {sortedFolders.map((f) => (
                    <MenuItem
                      key={f.id}
                      active={p.folderId === f.id}
                      onClick={() => {
                        close()
                        void moveProject(p.id, f.id)
                      }}
                    >
                      <FolderIcon className="size-3.5" /> <span className="truncate">{f.name}</span>
                    </MenuItem>
                  ))}
                </>
              )}
              <MenuItem
                disabled={p.id === DEFAULT_PROJECT_ID}
                hint={p.id === DEFAULT_PROJECT_ID ? 'Default cannot be deleted' : undefined}
                onClick={() => {
                  close()
                  void removeProject(p)
                }}
              >
                <Trash2 className="size-3.5" /> Delete…
              </MenuItem>
            </>
          )}
        </Popover>
      </div>
    )

  return (
    <aside className={cn('shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-white/[0.06] p-3', className ?? 'flex w-56')}>
      {/* the heading is also the drop target for "take it out of its folder" */}
      <div {...intoDrop(ROOT)} className={cn('mb-1 flex items-center gap-0.5 rounded-lg px-1', intoRing(ROOT))}>
        <span className="flex-1 text-[11px] uppercase tracking-wide text-white/35">
          {hint?.target === ROOT ? 'Drop: no folder, at the end' : 'Projects'}
        </span>
        {onClose && (
          <button type="button" onClick={onClose} className="mr-1 rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white" aria-label="Close">
            <X className="size-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            setCreating('folder')
            setName('')
          }}
          className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white"
          title="New folder"
        >
          <FolderPlus className="size-4" />
        </button>
        <button
          type="button"
          onClick={() => {
            setCreating('project')
            setName('')
          }}
          className="rounded-md p-1 text-white/45 hover:bg-white/10 hover:text-white"
          title="New project"
        >
          <Plus className="size-4" />
        </button>
      </div>

      <button
        type="button"
        onClick={() => setProject('')}
        className={cn(row, projectId === '' ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5')}
      >
        <Layers className="size-3.5 shrink-0" />
        <span className="flex-1 truncate">All projects</span>
        <span className="text-[11px] text-white/35">{generations.length}</span>
      </button>

      {sortedFolders.map((f) => {
        const inside = listIn(f.id)
        const open = !collapsedFolders.includes(f.id)
        return (
          <div key={f.id} {...intoDrop(f.id)} className={cn('rounded-lg', intoRing(f.id))}>
            {renaming === f.id ? (
              <NameInput value={name} onChange={setName} onDone={() => renameFolder(f)} onCancel={() => setRenaming(undefined)} />
            ) : (
              <div
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_TYPE, f.id)
                  e.dataTransfer.effectAllowed = 'move'
                  setDrag({ kind: 'folder', id: f.id })
                }}
                onDragEnd={endDrag}
                {...folderHeaderDrop(f)}
                className={cn(row, 'pr-1 text-white/70 hover:bg-white/5', drag?.id === f.id && 'opacity-40', lineFor(f.id))}
              >
                <button type="button" onClick={() => toggleFolder(f.id)} className="flex min-w-0 flex-1 items-center gap-1.5 text-left" title={open ? 'Collapse' : 'Expand'}>
                  {open ? <ChevronDown className="size-3.5 shrink-0 text-white/40" /> : <ChevronRight className="size-3.5 shrink-0 text-white/40" />}
                  <FolderIcon className="size-3.5 shrink-0 text-white/50" />
                  <span className="flex-1 truncate font-medium">{f.name}</span>
                </button>
                <span className="text-[11px] text-white/35 group-hover:hidden pointer-coarse:hidden">{inside.length}</span>
                <Popover
                  side="bottom"
                  align="right"
                  trigger={({ toggle }) => (
                    <button type="button" onClick={toggle} className="hidden rounded p-0.5 text-white/50 hover:text-white group-hover:block pointer-coarse:block">
                      <MoreHorizontal className="size-3.5" />
                    </button>
                  )}
                >
                  {(close) => (
                    <>
                      <MenuItem
                        onClick={() => {
                          close()
                          setName(f.name)
                          setRenaming(f.id)
                        }}
                      >
                        <Pencil className="size-3.5" /> Rename
                      </MenuItem>
                      <MenuItem
                        disabled={sortedFolders[0]?.id === f.id}
                        onClick={() => {
                          close()
                          nudgeFolder(f, -1)
                        }}
                      >
                        <ArrowUp className="size-3.5" /> Move up
                      </MenuItem>
                      <MenuItem
                        disabled={sortedFolders[sortedFolders.length - 1]?.id === f.id}
                        onClick={() => {
                          close()
                          nudgeFolder(f, 1)
                        }}
                      >
                        <ArrowDown className="size-3.5" /> Move down
                      </MenuItem>
                      <MenuItem
                        onClick={() => {
                          close()
                          void removeFolder(f)
                        }}
                      >
                        <Trash2 className="size-3.5" /> Delete folder…
                      </MenuItem>
                    </>
                  )}
                </Popover>
              </div>
            )}
            {open && inside.map((p) => projectRow(p, true))}
            {open && !inside.length && (
              <p className="py-1 pl-8 text-[11.5px] text-white/30">{drag?.kind === 'project' ? 'Drop a project here' : 'Empty - drag projects here'}</p>
            )}
          </div>
        )
      })}

      <div {...intoDrop(ROOT)} className="flex min-h-2 flex-col gap-0.5">
        {rootProjects.map((p) => projectRow(p, false))}
      </div>

      {creating && (
        <NameInput
          value={name}
          onChange={setName}
          onDone={create}
          onCancel={() => setCreating(undefined)}
          placeholder={creating === 'folder' ? 'Folder name' : 'Project name'}
        />
      )}

      <div className="mt-4 border-t border-white/[0.06] pt-3">
        <span className="mb-1 block truncate px-1 text-[11px] uppercase tracking-wide text-white/35" title={active?.name}>
          {active?.name ?? 'Project'}
        </span>
        <button type="button" onClick={() => openVoices(activeId)} className={cn(row, 'text-white/65 hover:bg-white/5')}>
          <AudioLines className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Voices</span>
          <span className="text-[11px] text-white/35">{activeVoices.length}</span>
        </button>
        <button type="button" onClick={() => openDefaults(activeId)} className={cn(row, 'text-white/65 hover:bg-white/5')}>
          <SlidersHorizontal className="size-3.5 shrink-0" />
          <span className="flex-1 truncate">Defaults</span>
          <span className="text-[11px] text-white/35">{defaultsCount ? `${defaultsCount}/3` : '—'}</span>
        </button>
      </div>
    </aside>
  )
}

function NameInput({
  value,
  onChange,
  onDone,
  onCancel,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  onDone: () => void
  onCancel: () => void
  placeholder?: string
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg bg-white/[0.06] px-1.5 py-1">
      <input
        autoFocus
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onDone()
          if (e.key === 'Escape') onCancel()
        }}
        className="min-w-0 flex-1 bg-transparent px-1 text-[13px] placeholder:text-white/35 focus:outline-none"
      />
      <button type="button" onClick={onDone} className="rounded p-0.5 text-white/60 hover:text-white">
        <Check className="size-3.5" />
      </button>
      <button type="button" onClick={onCancel} className="rounded p-0.5 text-white/60 hover:text-white">
        <X className="size-3.5" />
      </button>
    </div>
  )
}
