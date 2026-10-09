import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DEFAULT_PROJECT_ID } from '../../shared/types'
import type { Role } from './composer'

/** '' = all projects */
export type ProjectView = string
export type KindFilter = '' | 'video' | 'image' | 'audio' | 'music'

interface TrimRequest {
  src: string
  duration: number
  resolve: (start: number | null) => void
}

export type View = 'generate' | 'studio'

interface UiState {
  /** top-level screen: the generator gallery or the Studio timeline editor */
  view: View
  setView: (v: View) => void
  /** Studio: the open edit */
  editId?: string
  setEditId: (id?: string) => void
  projectId: ProjectView
  kindFilter: KindFilter
  /** AI prompt doctor: text model + reasoning level (remembered) */
  refineModel: string
  refineThinking: string
  setRefine: (v: { model?: string; thinking?: string }) => void
  /** sidebar folders the user folded */
  collapsedFolders: string[]
  toggleFolder: (id: string) => void
  /** phone: project sidebar shown as a drawer */
  sidebarOpen: boolean
  setSidebarOpen: (v: boolean) => void
  /** composer folded to one line */
  composerCollapsed: boolean
  setComposerCollapsed: (v: boolean) => void
  setProject: (id: ProjectView) => void
  setKindFilter: (k: KindFilter) => void
  selectedId?: string
  search: string
  modelFilter: string
  favOnly: boolean
  /** gallery tag filter (AND) */
  tagFilter: string[]
  setTagFilter: (t: string[]) => void
  /** open asset library; when `role` is set, picking attaches to the composer */
  library?: { role?: Role }
  /** project whose defaults dialog is open */
  defaultsFor?: string
  /** project whose voices dialog is open */
  voicesFor?: string
  openVoices: (projectId?: string) => void
  openDefaults: (projectId?: string) => void
  trim?: TrimRequest
  toast?: { text: string; kind: 'error' | 'info'; at: number }
  select: (id?: string) => void
  setSearch: (s: string) => void
  setModelFilter: (m: string) => void
  setFavOnly: (v: boolean) => void
  openLibrary: (role?: Role) => void
  closeLibrary: () => void
  requestTrim: (src: string, duration: number) => Promise<number | null>
  closeTrim: () => void
  notify: (text: string, kind?: 'error' | 'info') => void
}

export const useUi = create<UiState>()(
  persist(
  (set, get) => ({
  view: 'generate',
  setView: (view) => set({ view, sidebarOpen: false }),
  setEditId: (editId) => set({ editId }),
  projectId: DEFAULT_PROJECT_ID,
  kindFilter: '',
  composerCollapsed: false,
  sidebarOpen: false,
  collapsedFolders: [],
  refineModel: 'gemini-3.8-flash',
  refineThinking: 'high',
  setRefine: ({ model, thinking }) => set((s) => ({ refineModel: model ?? s.refineModel, refineThinking: thinking ?? s.refineThinking })),
  toggleFolder: (id) =>
    set((s) => ({
      collapsedFolders: s.collapsedFolders.includes(id) ? s.collapsedFolders.filter((x) => x !== id) : [...s.collapsedFolders, id],
    })),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setComposerCollapsed: (composerCollapsed) => set({ composerCollapsed }),
  setProject: (projectId) => set({ projectId, selectedId: undefined, tagFilter: [], sidebarOpen: false }),
  setKindFilter: (kindFilter) => set({ kindFilter }),
  search: '',
  modelFilter: '',
  favOnly: false,
  tagFilter: [],
  setTagFilter: (tagFilter) => set({ tagFilter }),
  select: (selectedId) => set({ selectedId }),
  setSearch: (search) => set({ search }),
  setModelFilter: (modelFilter) => set({ modelFilter }),
  setFavOnly: (favOnly) => set({ favOnly }),
  openLibrary: (role) => set({ library: { role } }),
  closeLibrary: () => set({ library: undefined }),
  openDefaults: (defaultsFor) => set({ defaultsFor, sidebarOpen: false }),
  openVoices: (voicesFor) => set({ voicesFor, sidebarOpen: false }),
  requestTrim: (src, duration) =>
    new Promise((resolve) => {
      get().trim?.resolve(null)
      set({ trim: { src, duration, resolve } })
    }),
  closeTrim: () => set({ trim: undefined }),
  notify: (text, kind = 'info') => set({ toast: { text, kind, at: Date.now() } }),
  }),
  { name: 'twelvelabs-ui', partialize: (s) => ({
      projectId: s.projectId,
      view: s.view,
      editId: s.editId,
      kindFilter: s.kindFilter,
      favOnly: s.favOnly,
      composerCollapsed: s.composerCollapsed,
      collapsedFolders: s.collapsedFolders,
      refineModel: s.refineModel,
      refineThinking: s.refineThinking,
    }) },
  ),
)

/** Project new uploads and generations go to: the open project, Default when viewing all. */
export function activeProjectId(): string {
  return useUi.getState().projectId || DEFAULT_PROJECT_ID
}
