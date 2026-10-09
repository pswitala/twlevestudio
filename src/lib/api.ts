import type { ModelSpec } from '../../shared/models'
import type { Asset, CreateGenerationRequest, Folder, Generation, Project, SavedPrompt } from '../../shared/types'
import type { Voice } from '../../shared/voices'
import type { Edit, StudioMedia } from '../../shared/studio'

async function req<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { 'content-type': 'application/json', ...rest.headers } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error((data as { error?: string }).error ?? res.statusText), { status: res.status })
  return data as T
}

export const api = {
  config: () => req<{ hasKey: boolean; hasOpenRouterKey: boolean; models: ModelSpec[] }>('/api/config'),
  generations: () => req<Generation[]>('/api/generations'),
  createGenerations: (body: CreateGenerationRequest) => req<Generation[]>('/api/generations', { method: 'POST', json: body }),
  patchGeneration: (id: string, body: Partial<Pick<Generation, 'favorite' | 'title' | 'projectId' | 'tags'>>) =>
    req<Generation>(`/api/generations/${id}`, { method: 'PATCH', json: body }),
  deleteGeneration: (id: string) => req(`/api/generations/${id}`, { method: 'DELETE' }),
  retry: (id: string) => req<Generation>(`/api/generations/${id}/retry`, { method: 'POST' }),
  frame: (id: string, at: number | 'last') => req<Asset>(`/api/generations/${id}/frame`, { method: 'POST', json: { at } }),
  toAsset: (id: string, trimStart: number) =>
    req<Asset>(`/api/generations/${id}/to-asset`, { method: 'POST', json: { trimStart } }),
  assets: () => req<Asset[]>('/api/assets'),
  upload: (files: File[], opts: { trimStart?: number; source?: 'paste' | 'upload'; projectId?: string } = {}) => {
    const fd = new FormData()
    if (opts.projectId) fd.append('projectId', opts.projectId)
    for (const f of files) fd.append('files', f)
    if (opts.trimStart) fd.append('trimStart', String(opts.trimStart))
    if (opts.source) fd.append('source', opts.source)
    return req<Asset[]>('/api/assets', { method: 'POST', body: fd })
  },
  patchAsset: (id: string, body: { label?: string; projectId?: string; tags?: string[] }) => req<Asset>(`/api/assets/${id}`, { method: 'PATCH', json: body }),
  projects: () => req<Project[]>('/api/projects'),
  folders: () => req<Folder[]>('/api/folders'),
  createFolder: (name: string) => req<Folder>('/api/folders', { method: 'POST', json: { name } }),
  renameFolder: (id: string, name: string) => req<Folder>(`/api/folders/${id}`, { method: 'PATCH', json: { name } }),
  deleteFolder: (id: string) => req<{ moved: number }>(`/api/folders/${id}`, { method: 'DELETE' }),
  reorderFolders: (ids: string[]) => req<Folder[]>('/api/folders/reorder', { method: 'POST', json: { ids } }),
  /** put `ids` into `folderId` (null = top level) in exactly this order */
  reorderProjects: (ids: string[], folderId: string | null) =>
    req<Project[]>('/api/projects/reorder', { method: 'POST', json: { ids, folderId } }),
  moveProjectToFolder: (id: string, folderId: string | null) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', json: { folderId } }),
  voices: () =>
    req<{ voices: Voice[]; prebuilt: { name: string; note: string }[]; languages: { code: string; label: string }[] }>('/api/voices'),
  createVoice: (body: Partial<Voice> & { design?: boolean }) => req<Voice>('/api/voices', { method: 'POST', json: body }),
  patchVoice: (id: string, body: Partial<Voice>) => req<Voice>(`/api/voices/${id}`, { method: 'PATCH', json: body }),
  designVoice: (id: string) => req<Voice>(`/api/voices/${id}/design`, { method: 'POST' }),
  deleteVoice: (id: string) => req(`/api/voices/${id}`, { method: 'DELETE' }),
  transferVoices: (ids: string[], projectId: string, mode: 'copy' | 'move') =>
    req<{ done: number; skipped: number }>('/api/voices/transfer', { method: 'POST', json: { ids, projectId, mode } }),
  transferGenerations: (ids: string[], projectId: string, mode: 'copy' | 'move') =>
    req<{ done: number; skipped: number }>('/api/generations/transfer', { method: 'POST', json: { ids, projectId, mode } }),
  createProject: (name: string) => req<Project>('/api/projects', { method: 'POST', json: { name } }),
  renameProject: (id: string, name: string) => req<Project>(`/api/projects/${id}`, { method: 'PATCH', json: { name } }),
  updateProjectDefaults: (id: string, defaults: Project['defaults']) =>
    req<Project>(`/api/projects/${id}`, { method: 'PATCH', json: { defaults } }),
  deleteProject: (id: string) => req<{ moved: number }>(`/api/projects/${id}`, { method: 'DELETE' }),
  transferAssets: (ids: string[], projectId: string, mode: 'copy' | 'move') =>
    req<{ done: number; skipped: number }>('/api/assets/transfer', { method: 'POST', json: { ids, projectId, mode } }),
  deleteAsset: (id: string, force = false) => req(`/api/assets/${id}${force ? '?force=1' : ''}`, { method: 'DELETE' }),
  refine: (body: { targetModel: string; prompt: string; problem: string; directives?: object; model?: string; thinking?: string }) =>
    req<{ prompt: string }>('/api/refine', { method: 'POST', json: body }),
  defaultsAi: (body: { brief: string; current?: object; model?: string; thinking?: string }) =>
    req<{ style: string; camera: string; negative: string }>('/api/defaults-ai', { method: 'POST', json: body }),
  textModels: () => req<{ models: string[]; default: string; thinking: string[] }>('/api/text-models'),
  enhance: (model: string, prompt: string) => req<{ prompt: string }>('/api/enhance', { method: 'POST', json: { model, prompt } }),
  edits: () => req<Edit[]>('/api/edits'),
  createEdit: (projectId: string, name?: string) => req<Edit>('/api/edits', { method: 'POST', json: { projectId, name } }),
  saveEdit: (e: Edit) => req<Edit>(`/api/edits/${e.id}`, { method: 'PUT', json: e }),
  duplicateEdit: (id: string) => req<Edit>(`/api/edits/${id}/duplicate`, { method: 'POST' }),
  deleteEdit: (id: string) => req(`/api/edits/${id}`, { method: 'DELETE' }),
  exportEdit: (id: string) => req<Generation>(`/api/edits/${id}/export`, { method: 'POST' }),
  studioMedia: () => req<StudioMedia[]>('/api/studio/media'),
  importStudioMedia: (files: File[], projectId: string) => {
    const fd = new FormData()
    fd.append('projectId', projectId)
    for (const f of files) fd.append('files', f)
    return req<{ media: StudioMedia[]; errors: string[] }>('/api/studio/media', { method: 'POST', body: fd })
  },
  patchStudioMedia: (id: string, body: { label?: string; projectId?: string }) =>
    req<StudioMedia>(`/api/studio/media/${id}`, { method: 'PATCH', json: body }),
  deleteStudioMedia: (id: string) => req(`/api/studio/media/${id}`, { method: 'DELETE' }),
  prompts: () => req<SavedPrompt[]>('/api/prompts'),
  savePrompt: (text: string) => req<SavedPrompt>('/api/prompts', { method: 'POST', json: { text } }),
  deletePrompt: (id: string) => req(`/api/prompts/${id}`, { method: 'DELETE' }),
}

export const fileUrl = (dir: 'videos' | 'images' | 'audio' | 'voices' | 'assets' | 'thumbs' | 'studio', name?: string) => (name ? `/files/${dir}/${name}` : undefined)

/** URL of a generation's output (video or photo). */
export const outputUrl = (g: Pick<Generation, 'kind' | 'file'>) =>
  fileUrl(g.kind === 'image' ? 'images' : g.kind === 'audio' || g.kind === 'music' ? 'audio' : 'videos', g.file)
