import type { Folder, Project } from '../../shared/types'

/** Saved order first; never-ordered items keep their creation order after them. */
export function byOrder<T extends { order?: number }>(items: T[]): T[] {
  return items
    .map((item, i) => ({ item, i }))
    .sort((a, b) => (a.item.order ?? 1e9 + a.i) - (b.item.order ?? 1e9 + b.i))
    .map((x) => x.item)
}

export interface ProjectGroup {
  /** undefined = projects without a folder */
  folder?: Folder
  projects: Project[]
}

/**
 * Projects grouped like the sidebar: folders (in their order) first, then projects without a folder.
 * `query` matches a project name or its folder's name (so typing a folder name shows its projects).
 * Empty groups are dropped.
 */
export function groupByFolder(projects: Project[], folders: Folder[], query = ''): ProjectGroup[] {
  const q = query.trim().toLowerCase()
  const ids = new Set(folders.map((f) => f.id))
  const match = (p: Project, f?: Folder) => !q || p.name.toLowerCase().includes(q) || !!f?.name.toLowerCase().includes(q)
  const sorted = byOrder(projects)
  const groups: ProjectGroup[] = byOrder(folders).map((f) => ({ folder: f, projects: sorted.filter((p) => p.folderId === f.id && match(p, f)) }))
  groups.push({ projects: sorted.filter((p) => (!p.folderId || !ids.has(p.folderId)) && match(p)) })
  return groups.filter((g) => g.projects.length)
}
