import { useMemo } from 'react'
import { create } from 'zustand'
import type { Clip, SourceInfo } from '../../../shared/studio'
import { DEFAULT_PROJECT_ID } from '../../../shared/types'
import { useAssets, useGenerations, useStudioMedia } from '../../hooks/queries'
import { fileUrl, outputUrl } from '../../lib/api'

/** Anything that can go on the timeline, in one shape. */
export interface SourceItem extends SourceInfo {
  key: string
  source: Clip['source']
  label: string
  url: string
  thumb?: string
  projectId: string
  createdAt: string
  /** generated = gallery output, library = ref library, import = Studio import */
  origin: 'generated' | 'library' | 'import'
}

export const sourceKey = (s: Clip['source']) => `${s.type}:${s.id}`

/** Every usable source: finished generations (Studio exports too), library refs and Studio imports. */
export function useSources() {
  const { data: generations = [] } = useGenerations()
  const { data: assets = [] } = useAssets()
  const { data: media = [] } = useStudioMedia()
  return useMemo(() => {
    const items: SourceItem[] = []
    for (const g of generations) {
      if (g.status !== 'completed' || !g.file) continue
      // speech and music are both just sound on the timeline
      const kind = g.kind === 'music' ? 'audio' : (g.kind ?? 'video')
      items.push({
        key: `generation:${g.id}`,
        source: { type: 'generation', id: g.id },
        label: g.title || g.prompt.replace(/\s+/g, ' ').slice(0, 70) || kind,
        url: outputUrl(g)!,
        thumb: fileUrl('thumbs', g.thumb),
        projectId: g.projectId ?? DEFAULT_PROJECT_ID,
        createdAt: g.createdAt,
        origin: 'generated',
        media: kind,
        duration: kind === 'image' ? undefined : g.durationS,
        hasAudio: kind === 'audio' || (kind === 'video' && !!g.hasAudio),
      })
    }
    for (const a of assets) {
      items.push({
        key: `asset:${a.id}`,
        source: { type: 'asset', id: a.id },
        label: a.label,
        url: fileUrl('assets', a.file)!,
        thumb: fileUrl('thumbs', a.thumb),
        projectId: a.projectId ?? DEFAULT_PROJECT_ID,
        createdAt: a.createdAt,
        origin: 'library',
        media: a.kind,
        duration: a.kind === 'image' ? undefined : a.durationS,
        hasAudio: a.kind === 'audio',
      })
    }
    for (const m of media) {
      items.push({
        key: `media:${m.id}`,
        source: { type: 'media', id: m.id },
        label: m.label,
        url: fileUrl('studio', m.file)!,
        thumb: fileUrl('thumbs', m.thumb),
        projectId: m.projectId,
        createdAt: m.createdAt,
        origin: 'import',
        media: m.kind,
        duration: m.kind === 'image' ? undefined : m.durationS,
        hasAudio: m.hasAudio,
      })
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    return { items, byKey: new Map(items.map((i) => [i.key, i])) }
  }, [generations, assets, media])
}

/** Playhead + transport, in its own store so only the parts that show time re-render 60x a second. */
export const usePlayback = create<{
  t: number
  playing: boolean
  seek: (t: number) => void
  setPlaying: (p: boolean) => void
}>((set) => ({
  t: 0,
  playing: false,
  seek: (t) => set({ t: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
}))

/** drag-and-drop payload type from the media bin to a track */
export const DND_TYPE = 'application/x-studio-source'
/** drag-and-drop payload type of a transition (Effects) dropped on a clip edge */
export const DND_TRANSITION = 'application/x-studio-transition'
