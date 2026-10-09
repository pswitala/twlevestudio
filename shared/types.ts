import type { DirectiveOverrides, Directives } from './directives'
import type { VoiceSnapshot } from './voices'
import type { Edit } from './studio'
import type { AspectRatio, ImageSize, MediaKind, ModelId, Resolution } from './models'

/** audio = music / sound effects / voice-over: never sent to a model (no audio refs), used on Studio's audio tracks */
export type AssetKind = 'image' | 'video' | 'audio'

export interface Asset {
  id: string
  kind: AssetKind
  sha256: string
  /** file name inside data/assets */
  file: string
  /** file name inside data/thumbs (audio: a picture of the waveform) */
  thumb: string
  mime: string
  bytes: number
  width?: number
  height?: number
  durationS?: number
  /** duration of the upload before it was trimmed to the 3 s video-ref limit */
  originalDurationS?: number
  label: string
  tags?: string[]
  projectId?: string
  source: 'upload' | 'paste' | 'frame' | 'generation'
  fromGenerationId?: string
  createdAt: string
  /** Gemini Files API copy (expires after 48 h) */
  geminiFile?: { name: string; uri: string; expiresAt: string }
}

export interface Refs {
  firstFrame?: string
  lastFrame?: string
  images: string[]
  videos: string[]
}

export interface Settings {
  aspectRatio: AspectRatio
  resolution: Resolution
  /** seconds; 0 = let the model decide (Omni only) */
  duration: number
  audio: boolean
  count: number
  enhance: boolean
  /** photo mode only */
  imageSize?: ImageSize
  /** speech mode: voice (1-based) for lines without an @voiceN: prefix */
  voice?: number
  /** music mode: no vocals */
  instrumental?: boolean
}

export interface Project {
  id: string
  name: string
  createdAt: string
  /** default style / camera / negatives for every generation in the project */
  defaults?: Directives
  /** sidebar folder; missing = top level */
  folderId?: string
  /** position within its folder (or the top level); missing = after the ordered ones, by creation */
  order?: number
}

/** Sidebar grouping of projects - purely organisational, owns no media. */
export interface Folder {
  id: string
  name: string
  createdAt: string
  order?: number
}

export const DEFAULT_PROJECT_ID = 'default'

export type GenerationMode = 'create' | 'edit' | 'extend'

export type GenerationStatus = 'queued' | 'running' | 'completed' | 'failed'

export interface Generation {
  id: string
  batchId: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  status: GenerationStatus
  /** missing on records made before photos existed = video */
  kind?: MediaKind
  projectId?: string
  /** human readable step while running: enhancing / uploading / generating / downloading */
  phase?: string
  model: ModelId
  settings: Settings
  /** prompt as typed (with @tokens) */
  prompt: string
  enhancedPrompt?: string
  /** style / camera / negatives this generation used (project defaults merged with overrides, frozen) */
  directives?: Directives
  /** project voices this generation referenced (@voiceN), frozen */
  voices?: VoiceSnapshot[]
  /** prompt actually sent to the model */
  sentPrompt?: string
  /** music: lyrics and song structure Lyria returned with the audio */
  lyrics?: string
  refs: Refs
  mode: GenerationMode
  parentId?: string
  provider: {
    interactionId?: string
    operationName?: string
    /** Veo output kept on Google's side for 2 days - needed for Veo extension */
    veoVideoUri?: string
    veoVideoExpiresAt?: string
    /** Omni ran synchronously (background mode refused) */
    sync?: boolean
    /** OpenRouter video job - polled again after a restart */
    openrouterJobId?: string
  }
  file?: string
  originalFile?: string
  thumb?: string
  durationS?: number
  width?: number
  height?: number
  hasAudio?: boolean
  cost: { estimatedUsd: number; actualUsd?: number; usage?: Record<string, unknown> }
  error?: string
  favorite?: boolean
  title?: string
  tags?: string[]
  /** Studio export: the timeline as it was when exported (Retry renders this again) */
  studio?: { editId: string; edit: Edit }
}

export interface SavedPrompt {
  id: string
  text: string
  createdAt: string
}

export interface CreateGenerationRequest {
  model: ModelId
  prompt: string
  refs: Refs
  settings: Settings
  mode?: GenerationMode
  parentId?: string
  projectId?: string
  directiveOverrides?: DirectiveOverrides
  /** speech: library voices for @voice1.. in this order (any project); missing = the project's voices */
  voiceIds?: string[]
}
