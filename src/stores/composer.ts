import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { DIRECTIVE_KEYS, type DirectiveKey, type DirectiveOverrides, type Directives } from '../../shared/directives'
import { DEFAULT_IMAGE_MODEL, DEFAULT_MODEL, DEFAULT_MUSIC_MODEL, DEFAULT_TTS_MODEL, getModel, type MediaKind, type ModelId } from '../../shared/models'
import type { Generation, GenerationMode, Refs, Settings } from '../../shared/types'

export type Role = 'firstFrame' | 'lastFrame' | 'images' | 'videos' | 'voices'

interface Draft {
  model: ModelId
  settings: Settings
}

interface ComposerState extends Draft {
  /** Video, Photo or Speech - `model`/`settings` belong to it, the other modes' are parked in `drafts` */
  kind: MediaKind
  drafts: Record<MediaKind, Draft>
  prompt: string
  refs: Refs
  mode: GenerationMode
  parentId?: string
  /** per-generation override of the project's style / camera / negatives (missing = project, '' = off) */
  overrides: DirectiveOverrides
  /** speech: chosen library voices = @voice1.. in this order; empty = the open project's voices */
  speechVoices: string[]
  setSpeechVoices: (ids: string[]) => void
  setOverride: (k: DirectiveKey, v: string | undefined) => void
  resetOverrides: () => void
  setKind: (k: MediaKind) => void
  setPrompt: (p: string) => void
  setModel: (m: ModelId) => void
  setSetting: <K extends keyof Settings>(k: K, v: Settings[K]) => void
  attach: (role: Role, ids: string[]) => void
  detach: (role: Role, id: string) => void
  clearRefs: () => void
  /** fresh draft: empty prompt, no refs, back to create mode (model + settings stay); returns what it cleared */
  resetDraft: () => DraftSnapshot
  restoreDraft: (d: DraftSnapshot) => void
  /** Reuse: model, parameters, prompt, still-existing refs and directive overrides of a past generation.
   *  Returns how many references were left out because their files are gone. */
  remix: (g: Generation, ctx: ReuseContext) => number
  continueFrom: (g: Generation, mode: 'edit' | 'extend') => void
  cancelMode: () => void
}

const EMPTY_REFS: Refs = { images: [], videos: [] }

export interface ReuseContext {
  /** is this library asset still there */
  assetExists: (id: string) => boolean
  /** the project the composer is working in now - its defaults decide what counts as an override */
  projectDefaults?: Directives
  /** is this library voice still there (speech: Reuse brings back the same voices) */
  voiceExists?: (id: string) => boolean
}

/**
 * What "Reuse" brings back from a generation:
 * - refs whose files still exist (an end frame without its start frame is dropped too - it cannot be sent alone);
 * - style / camera / avoid as overrides ONLY where the generation differs from today's project defaults
 *   ('' = it had that one switched off). Edits and speech never carried directives, so they set none.
 */
export function reuseOf(
  g: Generation,
  ctx: ReuseContext,
): { refs: Refs; overrides: DirectiveOverrides; missing: number; speechVoices: string[] } {
  const keep = (id?: string) => (id && ctx.assetExists(id) ? id : undefined)
  const firstFrame = keep(g.refs.firstFrame)
  const lastFrame = firstFrame ? keep(g.refs.lastFrame) : undefined
  const images = g.refs.images.filter(ctx.assetExists)
  const videos = g.refs.videos.filter(ctx.assetExists)
  const before = [g.refs.firstFrame, g.refs.lastFrame, ...g.refs.images, ...g.refs.videos].filter(Boolean).length
  const after = [firstFrame, lastFrame, ...images, ...videos].filter(Boolean).length

  const overrides: DirectiveOverrides = {}
  if (g.directives && g.mode !== 'edit' && g.kind !== 'audio') {
    for (const k of DIRECTIVE_KEYS) {
      const used = (g.directives[k] ?? '').trim()
      const now = (ctx.projectDefaults?.[k] ?? '').trim()
      if (used !== now) overrides[k] = used
    }
  }
  // speech: the same voices it used, wherever they live; recordings from before voice ids -> project voices
  const snapIds = (g.voices ?? []).map((v) => v.id)
  const speechVoices =
    g.kind === 'audio' && snapIds.length && snapIds.every(Boolean) ? (snapIds as string[]).filter((id) => ctx.voiceExists?.(id) ?? true) : []
  const lostVoices = g.kind === 'audio' && snapIds.every(Boolean) ? snapIds.length - speechVoices.length : 0
  return { refs: { firstFrame, lastFrame, images, videos }, overrides, missing: before - after + lostVoices, speechVoices }
}

export interface DraftSnapshot {
  prompt: string
  refs: Refs
  mode: GenerationMode
  parentId?: string
}

const BASE: Settings = { aspectRatio: '16:9', resolution: '720p', duration: 0, audio: true, count: 1, enhance: false }

const DRAFTS: Record<MediaKind, Draft> = {
  video: { model: DEFAULT_MODEL, settings: BASE },
  image: { model: DEFAULT_IMAGE_MODEL, settings: { ...BASE, aspectRatio: '1:1', imageSize: '1K' } },
  audio: { model: DEFAULT_TTS_MODEL, settings: { ...BASE, voice: 1 } },
  music: { model: DEFAULT_MUSIC_MODEL, settings: { ...BASE, duration: 0, instrumental: false } },
}

/** Removing @img2 renumbers @img3 -> @img2 so the prompt keeps pointing at the same media. */
export function renumber(prompt: string, prefix: 'img' | 'vid' | 'voice', removedIndex: number): string {
  return prompt.replace(new RegExp(`@${prefix}(\\d+)\\b`, 'g'), (t, n: string) => {
    const k = Number(n)
    if (k === removedIndex + 1) return ''
    return k > removedIndex + 1 ? `@${prefix}${k - 1}` : t
  })
}

/** State change that switches mode, parking the current model + settings. */
function switchKind(s: ComposerState, kind: MediaKind): Partial<ComposerState> {
  if (s.kind === kind) return {}
  const drafts = { ...s.drafts, [s.kind]: { model: s.model, settings: s.settings } }
  const next = drafts[kind] ?? DRAFTS[kind]
  return { kind, drafts, model: next.model, settings: next.settings, mode: 'create', parentId: undefined }
}

const kindOf = (g: Generation): MediaKind => g.kind ?? 'video'

export const useComposer = create<ComposerState>()(
  persist(
    (set, get) => ({
      kind: 'video',
      ...DRAFTS.video,
      drafts: DRAFTS,
      prompt: '',
      refs: EMPTY_REFS,
      mode: 'create',
      overrides: {},
      speechVoices: [],
      setSpeechVoices: (speechVoices) => set({ speechVoices }),
      setOverride: (k, v) =>
        set((s) => {
          const next = { ...s.overrides }
          if (v === undefined) delete next[k]
          else next[k] = v
          return { overrides: next }
        }),
      resetOverrides: () => set({ overrides: {} }),
      setKind: (kind) => set((s) => switchKind(s, kind)),
      setPrompt: (prompt) => set({ prompt }),
      setModel: (model) =>
        set((s) => {
          const m = getModel(model)
          return {
            model,
            settings: {
              ...s.settings,
              duration: m.durations.includes(s.settings.duration) ? s.settings.duration : m.defaultDuration,
              resolution: m.resolutions.length && !m.resolutions.includes(s.settings.resolution) ? '720p' : s.settings.resolution,
              aspectRatio: m.aspectRatios.includes(s.settings.aspectRatio) ? s.settings.aspectRatio : m.aspectRatios[0],
            },
          }
        }),
      setSetting: (k, v) => set((s) => ({ settings: { ...s.settings, [k]: v } })),
      attach: (role, ids) =>
        set((s) => {
          if (role === 'voices') return { speechVoices: [...s.speechVoices, ...ids.filter((id) => !s.speechVoices.includes(id))] }
          if (role === 'firstFrame' || role === 'lastFrame') return { refs: { ...s.refs, [role]: ids[0] } }
          const merged = [...s.refs[role], ...ids.filter((id) => !s.refs[role].includes(id))]
          return { refs: { ...s.refs, [role]: merged } }
        }),
      detach: (role, id) =>
        set((s) => {
          if (role === 'voices') {
            const i = s.speechVoices.indexOf(id)
            if (i < 0) return {}
            return { speechVoices: s.speechVoices.filter((x) => x !== id), prompt: renumber(s.prompt, 'voice', i) }
          }
          if (role === 'firstFrame' || role === 'lastFrame') {
            const token = role === 'firstFrame' ? /@start\b/g : /@end\b/g
            return { refs: { ...s.refs, [role]: undefined }, prompt: s.prompt.replace(token, '') }
          }
          const i = s.refs[role].indexOf(id)
          if (i < 0) return {}
          return {
            refs: { ...s.refs, [role]: s.refs[role].filter((x) => x !== id) },
            prompt: renumber(s.prompt, role === 'images' ? 'img' : 'vid', i),
          }
        }),
      clearRefs: () => set({ refs: EMPTY_REFS }),
      resetDraft: () => {
        const s = get()
        const snapshot: DraftSnapshot = { prompt: s.prompt, refs: s.refs, mode: s.mode, parentId: s.parentId }
        set({ prompt: '', refs: EMPTY_REFS, mode: 'create', parentId: undefined })
        return snapshot
      },
      restoreDraft: (d) => set({ prompt: d.prompt, refs: d.refs, mode: d.mode, parentId: d.parentId }),
      remix: (g, ctx) => {
        const r = reuseOf(g, ctx)
        set((s) => ({
          ...switchKind(s, kindOf(g)),
          prompt: g.prompt,
          model: g.model,
          settings: { ...g.settings },
          refs: r.refs,
          mode: 'create',
          parentId: undefined,
          overrides: r.overrides,
          ...(kindOf(g) === 'audio' ? { speechVoices: r.speechVoices } : {}),
        }))
        return r.missing
      },
      continueFrom: (g, mode) =>
        set((s) => {
          const base = { ...s, ...switchKind(s, kindOf(g)) }
          return {
            ...switchKind(s, kindOf(g)),
            model: g.model,
            mode,
            parentId: g.id,
            prompt: '',
            refs: EMPTY_REFS,
            settings: { ...base.settings, resolution: g.settings.resolution, aspectRatio: g.settings.aspectRatio, imageSize: g.settings.imageSize, count: 1 },
          }
        }),
      cancelMode: () => set({ mode: 'create', parentId: undefined }),
    }),
    {
      name: 'twelvelabs-composer',
      version: 5,
      migrate: (old) => {
        const o = (old ?? {}) as Partial<ComposerState> & { other?: Draft }
        o.speechVoices ??= []
        const kind = o.kind ?? 'video'
        const drafts = { ...DRAFTS, ...(o.other ? { [kind === 'video' ? 'image' : 'video']: o.other } : {}) }
        delete o.other
        return { ...o, kind, drafts, overrides: o.overrides ?? {} } as never
      },
    },
  ),
)
