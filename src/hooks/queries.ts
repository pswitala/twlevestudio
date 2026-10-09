import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DEFAULT_PROJECT_ID, type Asset, type Generation } from '../../shared/types'
import { api } from '../lib/api'
import { activeProjectId } from '../stores/ui'

export function useConfig() {
  return useQuery({ queryKey: ['config'], queryFn: api.config, staleTime: Infinity })
}

export function useGenerations() {
  return useQuery({
    queryKey: ['generations'],
    queryFn: api.generations,
    refetchInterval: (q) =>
      (q.state.data as Generation[] | undefined)?.some((g) => g.status === 'queued' || g.status === 'running') ? 2500 : false,
  })
}

export function useAssets() {
  const q = useQuery({ queryKey: ['assets'], queryFn: api.assets })
  const byId = useMemo(() => new Map((q.data ?? []).map((a) => [a.id, a] as [string, Asset])), [q.data])
  return { ...q, byId }
}

export function useProjects() {
  return useQuery({ queryKey: ['projects'], queryFn: api.projects })
}

export function useFolders() {
  return useQuery({ queryKey: ['folders'], queryFn: api.folders })
}

/** All voices + the open project's voices in @voiceN order. */
export function useVoices(projectId?: string) {
  const q = useQuery({ queryKey: ['voices'], queryFn: api.voices })
  const pid = projectId || DEFAULT_PROJECT_ID
  const project = useMemo(
    () => (q.data?.voices ?? []).filter((v) => v.projectId === pid).sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
    [q.data, pid],
  )
  return { ...q, project }
}

export function useEdits() {
  return useQuery({ queryKey: ['edits'], queryFn: api.edits })
}

export function useStudioMedia() {
  return useQuery({ queryKey: ['studio-media'], queryFn: api.studioMedia })
}

export function usePrompts() {
  return useQuery({ queryKey: ['prompts'], queryFn: api.prompts })
}

export function useInvalidate() {
  const qc = useQueryClient()
  return (...keys: string[]) => Promise.all(keys.map((k) => qc.invalidateQueries({ queryKey: [k] })))
}

export function useUpload() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (v: { files: File[]; trimStart?: number; source?: 'paste' | 'upload' }) =>
      api.upload(v.files, { ...v, projectId: activeProjectId() }),
    onSuccess: () => invalidate('assets'),
  })
}
