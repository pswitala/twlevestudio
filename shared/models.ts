import type { Generation, GenerationMode, Refs, Settings } from './types'

export type ModelId =
  | 'gemini-omni-1.1-flash'
  | 'veo-3.1-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.1-lite-generate-preview'
  | 'gemini-3.1-flash-image'
  | 'gemini-3-pro-image'
  | 'gemini-3.1-flash-lite-image'
  | 'gemini-3.8-flash-tts'
  | 'gemini-3.8-flash-lite-tts'
  | 'lyria-3-clip-preview'
  | 'lyria-3.5'
  | 'studio-edit'
  | OpenRouterModelId
  | OpenRouterImageModelId

/** OpenRouter image models (POST /api/v1/images) */
export type OpenRouterImageModelId =
  | 'openai/gpt-image-2.5-sunburst'
  | 'openai/gpt-image-2.5-flare'
  | 'openai/gpt-image-2'
  | 'google/gemini-nano-banana-2.1'
  | 'x-ai/grok-imagine-image-2.0'
  | 'microsoft/mai-image-2.6'
  | 'microsoft/mai-image-2.6-flash'
  | 'black-forest-labs/flux-3-image'
  | 'qwen/qwen-image-3-pro'
  | 'bytedance-seed/seedream-5-0-pro'
  | 'bytedance-seed/seedream-5-0-flash'

/** OpenRouter video models: the id is OpenRouter's slug, sent as is */
export type OpenRouterModelId =
  | 'bytedance/seedance-2.5'
  | 'bytedance/seedance-2.0'
  | 'bytedance/seedance-2.0-fast'
  | 'bytedance/seedance-2.0-mini'
  | 'minimax/hailuo-3'
  | 'minimax/hailuo-3-max'
  | 'minimax/hailuo-2.3'
  | 'alibaba/happyhorse-1.1'
  | 'alibaba/wan-3.0'
  | 'alibaba/wan-3.0-prime'
  | 'kwaivgi/kling-v3.0-pro'
  | 'kwaivgi/kling-v3.0-std'
  | 'kwaivgi/kling-video-o1'
  | 'x-ai/grok-imagine-video-1.5'
  | 'x-ai/grok-imagine-video-1.5-lite'
  | 'black-forest-labs/flux-3-video'
  | 'runway/gen-4.5'

/** audio = speech (TTS), music = Lyria */
export type MediaKind = 'video' | 'image' | 'audio' | 'music'
export type Provider = 'omni' | 'veo' | 'nanobanana' | 'tts' | 'lyria' | 'studio' | 'openrouter' | 'openrouter-image'
export type AspectRatio = '16:9' | '9:16' | '1:1' | '3:2' | '2:3' | '4:3' | '3:4' | '4:5' | '5:4' | '21:9' | '9:21'
/** 480p / 768p / 2k: OpenRouter models only */
export type Resolution = '360p' | '480p' | '720p' | '768p' | '1080p' | '2k' | '4k'
/** Nano Banana output size; the API wants an uppercase K */
export type ImageSize = '512' | '1K' | '2K' | '4K'

const VIDEO_RATIOS: AspectRatio[] = ['16:9', '9:16']
const IMAGE_RATIOS: AspectRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '4:5', '5:4', '16:9', '9:16', '21:9']

export interface ModelSpec {
  id: ModelId
  label: string
  kind: MediaKind
  provider: Provider
  aspectRatios: AspectRatio[]
  /** image models only */
  imageSizes?: ImageSize[]
  /** USD per output image, by size (image models) */
  pricePerImage?: Partial<Record<ImageSize, number>>
  /** USD per second of speech (TTS models) */
  pricePerAudioSecond?: number
  /** USD per request, whatever comes back (music models) */
  pricePerRequest?: number
  resolutions: Resolution[]
  /** 0 = Auto (model decides) */
  durations: number[]
  defaultDuration: number
  /** hard limit (Veo) */
  maxImageRefs: number
  /** above this the UI warns, the request still goes (Omni: docs show 6) */
  imageRefsSoftMax: number
  maxVideoRefs: number
  canEdit: boolean
  canExtend: boolean
  /** USD per second of output, by resolution */
  pricePerSecond: Partial<Record<Resolution, number>>
  /** USD per second when the model is asked for no sound (OpenRouter models billed cheaper without audio) */
  pricePerSecondSilent?: Partial<Record<Resolution, number>>
  /** USD per attached image ref, on top of the seconds */
  pricePerImageRef?: number
  /** frames the model accepts; missing = start and end */
  frames?: ('first' | 'last')[]
  /** ByteDance (Seedream / Seedance): the provider refuses input images that may show a real person */
  refusesRealPeople?: boolean
  /** OpenRouter image models: send `resolution` (from imageSize) / a fixed `quality` */
  imageParams?: { resolution: boolean; quality?: string }
  /** false = the model makes silent video; true = sound can be switched off at the source (generate_audio); missing = always has sound */
  audio?: boolean
  /** seconds used for the estimate when duration = Auto */
  autoDurationEstimate: number
}

// Prices as of 2026-10-06 (ai.google.dev/gemini-api/docs/pricing).
// Omni bills 5,792 output tokens per second of 720p at $17.50/M (~$0.10/s); 360p is ~1/3 of that.
// 1080p/4k are upscales - Google publishes no separate rate, so they are estimated at the 720p rate.
const OMNI_720P = (5792 * 17.5) / 1_000_000

export const MODELS: ModelSpec[] = [
  {
    id: 'gemini-omni-1.1-flash',
    label: 'Omni 1.1 Flash',
    kind: 'video',
    provider: 'omni',
    aspectRatios: VIDEO_RATIOS,
    resolutions: ['360p', '720p', '1080p', '4k'],
    durations: [0, 4, 6, 8, 10],
    defaultDuration: 0,
    maxImageRefs: 12,
    imageRefsSoftMax: 6,
    maxVideoRefs: 3,
    canEdit: true,
    canExtend: true,
    pricePerSecond: { '360p': OMNI_720P / 3, '720p': OMNI_720P, '1080p': OMNI_720P, '4k': OMNI_720P },
    autoDurationEstimate: 10,
  },
  {
    id: 'veo-3.1-generate-preview',
    label: 'Veo 3.1',
    kind: 'video',
    provider: 'veo',
    aspectRatios: VIDEO_RATIOS,
    resolutions: ['720p', '1080p', '4k'],
    durations: [4, 6, 8],
    defaultDuration: 8,
    maxImageRefs: 3,
    imageRefsSoftMax: 3,
    maxVideoRefs: 0,
    canEdit: false,
    canExtend: true,
    pricePerSecond: { '720p': 0.4, '1080p': 0.4, '4k': 0.6 },
    autoDurationEstimate: 8,
  },
  {
    id: 'veo-3.1-fast-generate-preview',
    label: 'Veo 3.1 Fast',
    kind: 'video',
    provider: 'veo',
    aspectRatios: VIDEO_RATIOS,
    resolutions: ['720p', '1080p', '4k'],
    durations: [4, 6, 8],
    defaultDuration: 8,
    maxImageRefs: 3,
    imageRefsSoftMax: 3,
    maxVideoRefs: 0,
    canEdit: false,
    canExtend: true,
    pricePerSecond: { '720p': 0.1, '1080p': 0.12, '4k': 0.3 },
    autoDurationEstimate: 8,
  },
  {
    id: 'veo-3.1-lite-generate-preview',
    label: 'Veo 3.1 Lite',
    kind: 'video',
    provider: 'veo',
    aspectRatios: VIDEO_RATIOS,
    resolutions: ['720p', '1080p'],
    durations: [4, 6, 8],
    defaultDuration: 8,
    maxImageRefs: 0,
    imageRefsSoftMax: 0,
    maxVideoRefs: 0,
    canEdit: false,
    canExtend: false,
    pricePerSecond: { '720p': 0.05, '1080p': 0.08 },
    autoDurationEstimate: 8,
  },
]

// OpenRouter video models (GET https://openrouter.ai/api/v1/videos/models, 2026-10-10): ratios, lengths, frames and
// prices come from that list. Seedance bills video tokens = width x height x 24 fps / 1024 per second, so its rate per
// second is derived from the output size. Cards show the cost OpenRouter reports (usage.cost) once a job is done.
// Reference images (input_references) only for the models known to do reference-to-video: Seedance 2.x (also video
// refs), H3 and Kling O1. OpenRouter lets frame_images win when both are sent, so resolveSettings refuses the mix.
const seedanceRate = (perToken: number, w: number, h: number) => ((w * h * 24) / 1024) * perToken
const COMMON_DURATIONS = [2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30]
/** Long ranges (2-30 s) are cut to the usual values so the chip stays short. */
const durationsOf = (min: number, max: number) => {
  const d = COMMON_DURATIONS.filter((x) => x >= min && x <= max)
  return d.length ? d : [min]
}
const WIDE_RATIOS: AspectRatio[] = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', '9:21']

const orModel = (
  id: OpenRouterModelId,
  label: string,
  o: {
    aspectRatios: AspectRatio[]
    durations: number[]
    pricePerSecond: Partial<Record<Resolution, number>>
    pricePerSecondSilent?: Partial<Record<Resolution, number>>
    pricePerImageRef?: number
    frames: ('first' | 'last')[]
    audio?: boolean
    maxImageRefs?: number
    maxVideoRefs?: number
    refusesRealPeople?: boolean
  },
): ModelSpec => {
  const defaultDuration = o.durations.includes(5) ? 5 : o.durations.includes(6) ? 6 : o.durations[0]
  return {
    id,
    label,
    kind: 'video',
    provider: 'openrouter',
    aspectRatios: o.aspectRatios,
    resolutions: Object.keys(o.pricePerSecond) as Resolution[],
    durations: o.durations,
    defaultDuration,
    maxImageRefs: o.maxImageRefs ?? 0,
    imageRefsSoftMax: o.maxImageRefs ?? 0,
    maxVideoRefs: o.maxVideoRefs ?? 0,
    canEdit: false,
    canExtend: false,
    pricePerSecond: o.pricePerSecond,
    pricePerSecondSilent: o.pricePerSecondSilent,
    pricePerImageRef: o.pricePerImageRef,
    frames: o.frames,
    audio: o.audio,
    refusesRealPeople: o.refusesRealPeople,
    autoDurationEstimate: defaultDuration,
  }
}

const seedance = (id: OpenRouterModelId, label: string, maxSeconds: number, pricePerSecond: Partial<Record<Resolution, number>>, aspectRatios = WIDE_RATIOS) =>
  orModel(id, label, {
    aspectRatios,
    durations: durationsOf(4, maxSeconds),
    pricePerSecond,
    frames: ['first', 'last'],
    audio: true,
    maxImageRefs: 9,
    maxVideoRefs: 3,
    refusesRealPeople: true,
  })

export const OPENROUTER_MODELS: ModelSpec[] = [
  seedance(
    'bytedance/seedance-2.5',
    'Seedance 2.5',
    30,
    { '480p': seedanceRate(0.0000107, 854, 480), '720p': seedanceRate(0.0000107, 1280, 720) },
    ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
  ),
  seedance('bytedance/seedance-2.0', 'Seedance 2.0', 15, {
    '480p': seedanceRate(0.000007, 854, 480),
    '720p': seedanceRate(0.000007, 1280, 720),
    '1080p': seedanceRate(0.0000077, 1920, 1080),
    '4k': seedanceRate(0.000004, 3840, 2160),
  }),
  seedance('bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast', 15, {
    '480p': seedanceRate(0.0000042, 854, 480),
    '720p': seedanceRate(0.0000042, 1280, 720),
  }),
  seedance('bytedance/seedance-2.0-mini', 'Seedance 2.0 Mini', 15, {
    '480p': seedanceRate(0.0000035, 854, 480),
    '720p': seedanceRate(0.0000035, 1280, 720),
  }),
  orModel('minimax/hailuo-3', 'MiniMax H3', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durations: durationsOf(5, 15),
    pricePerSecond: { '2k': 0.13 },
    pricePerImageRef: 0.04,
    frames: ['first', 'last'],
    audio: true,
    maxImageRefs: 4,
  }),
  orModel('minimax/hailuo-3-max', 'MiniMax H3 Max', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durations: durationsOf(5, 15),
    pricePerSecond: { '480p': 0.05, '768p': 0.08 },
    frames: ['first', 'last'],
    audio: false,
  }),
  orModel('minimax/hailuo-2.3', 'MiniMax Hailuo 2.3', {
    aspectRatios: ['16:9'],
    durations: [6, 10],
    pricePerSecond: { '1080p': 0.0817 },
    frames: ['first'],
    audio: false,
  }),
  orModel('alibaba/happyhorse-1.1', 'HappyHorse 1.1', {
    aspectRatios: WIDE_RATIOS,
    durations: durationsOf(3, 15),
    pricePerSecond: { '720p': 0.0988, '1080p': 0.1278 },
    frames: ['first'],
  }),
  orModel('alibaba/wan-3.0', 'Wan 3.0', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durations: durationsOf(2, 30),
    pricePerSecond: { '480p': 0.05, '720p': 0.1, '1080p': 0.2 },
    frames: ['first'],
    audio: true,
  }),
  orModel('alibaba/wan-3.0-prime', 'Wan 3.0 Prime', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4'],
    durations: durationsOf(2, 30),
    pricePerSecond: { '480p': 0.068, '720p': 0.14, '1080p': 0.28 },
    frames: ['first'],
    audio: true,
  }),
  orModel('kwaivgi/kling-v3.0-pro', 'Kling 3.0 Pro', {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: durationsOf(3, 15),
    pricePerSecond: { '720p': 0.168 },
    pricePerSecondSilent: { '720p': 0.112 },
    frames: ['first', 'last'],
    audio: true,
  }),
  orModel('kwaivgi/kling-v3.0-std', 'Kling 3.0 Standard', {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: durationsOf(3, 15),
    pricePerSecond: { '720p': 0.126 },
    pricePerSecondSilent: { '720p': 0.084 },
    frames: ['first', 'last'],
    audio: true,
  }),
  orModel('kwaivgi/kling-video-o1', 'Kling O1', {
    aspectRatios: ['16:9', '9:16', '1:1'],
    durations: [5, 10],
    pricePerSecond: { '720p': 0.112 },
    frames: ['first', 'last'],
    audio: true,
    maxImageRefs: 7,
  }),
  orModel('x-ai/grok-imagine-video-1.5', 'Grok Imagine 1.5', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'],
    durations: durationsOf(1, 15),
    pricePerSecond: { '480p': 0.08, '720p': 0.14, '1080p': 0.25 },
    frames: ['first'],
  }),
  orModel('x-ai/grok-imagine-video-1.5-lite', 'Grok Imagine 1.5 Lite', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3'],
    durations: durationsOf(1, 15),
    pricePerSecond: { '480p': 0.02, '720p': 0.03, '1080p': 0.14 },
    frames: ['first'],
  }),
  orModel('black-forest-labs/flux-3-video', 'FLUX.3 Video', {
    aspectRatios: ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9'],
    durations: durationsOf(5, 20),
    pricePerSecond: { '720p': 0.17, '1080p': 0.29 },
    frames: ['first', 'last'],
    audio: true,
  }),
  orModel('runway/gen-4.5', 'Runway Gen-4.5', {
    aspectRatios: ['16:9', '9:16'],
    durations: durationsOf(2, 10),
    pricePerSecond: { '720p': 0.12 },
    frames: ['first'],
    audio: false,
  }),
]

// Nano Banana prices per image (docs/pricing, 2026-10-06): $60/M image tokens (Flash), $120/M (Pro), $30/M (Lite).
const imageModel = (
  id: ModelId,
  label: string,
  imageSizes: ImageSize[],
  pricePerImage: Partial<Record<ImageSize, number>>,
  canEdit: boolean,
): ModelSpec => ({
  id,
  label,
  kind: 'image',
  provider: 'nanobanana',
  aspectRatios: IMAGE_RATIOS,
  imageSizes,
  pricePerImage,
  resolutions: [],
  durations: [0],
  defaultDuration: 0,
  maxImageRefs: 14,
  imageRefsSoftMax: 14,
  maxVideoRefs: 0,
  canEdit,
  canExtend: false,
  pricePerSecond: {},
  autoDurationEstimate: 0,
})

// OpenRouter image models (POST https://openrouter.ai/api/v1/images): the top of the Artificial Analysis text-to-image
// and editing leaderboards (2026-10-10) that OpenRouter serves, plus Seedream 5.0 Flash as the cheap one. Ratios, sizes
// and ref limits from GET /api/v1/images/models; prices from its /endpoints records. Per-image prices are exact;
// token-billed models (OpenAI at quality "high", Nano Banana 2.1, MAI) are estimates - cards show usage.cost.
// They edit by sending the finished photo as one more input image, so any photo can be edited (no stored session).
const orImageModel = (
  id: OpenRouterImageModelId,
  label: string,
  o: {
    aspectRatios: AspectRatio[]
    pricePerImage: Partial<Record<ImageSize, number>>
    maxImageRefs: number
    pricePerImageRef?: number
    /** false = the model takes no resolution; it sizes from the aspect ratio (about 1 MP) */
    resolution?: boolean
    quality?: string
    refusesRealPeople?: boolean
  },
): ModelSpec => ({
  ...imageModel(id, label, Object.keys(o.pricePerImage) as ImageSize[], o.pricePerImage, true),
  provider: 'openrouter-image',
  aspectRatios: IMAGE_RATIOS.filter((r) => o.aspectRatios.includes(r)),
  maxImageRefs: o.maxImageRefs,
  imageRefsSoftMax: o.maxImageRefs,
  pricePerImageRef: o.pricePerImageRef,
  imageParams: { resolution: o.resolution ?? true, quality: o.quality },
  refusesRealPeople: o.refusesRealPeople,
})

const OPENAI_RATIOS: AspectRatio[] = ['1:1', '3:2', '2:3', '4:3', '3:4', '16:9', '9:16', '21:9']
const SEEDREAM_RATIOS: AspectRatio[] = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '9:21', '21:9']
const MAI_RATIOS: AspectRatio[] = ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3']

export const OPENROUTER_IMAGE_MODELS: ModelSpec[] = [
  // ~4,200 output tokens for a high-quality ~1 MP image at $30/M
  orImageModel('openai/gpt-image-2.5-sunburst', 'GPT Image 2.5 Sunburst', { aspectRatios: OPENAI_RATIOS, pricePerImage: { '1K': 0.13 }, maxImageRefs: 16, resolution: false, quality: 'high' }),
  orImageModel('openai/gpt-image-2.5-flare', 'GPT Image 2.5 Flare', { aspectRatios: OPENAI_RATIOS, pricePerImage: { '1K': 0.13 }, maxImageRefs: 16, resolution: false, quality: 'high' }),
  orImageModel('openai/gpt-image-2', 'GPT Image 2', { aspectRatios: OPENAI_RATIOS, pricePerImage: { '1K': 0.13 }, maxImageRefs: 16, resolution: false, quality: 'high' }),
  // Nano Banana token counts (1,120 / 1,680 / 2,520 per 1K / 2K / 4K image) at $30/M
  orImageModel('google/gemini-nano-banana-2.1', 'Nano Banana 2.1', {
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'],
    pricePerImage: { '1K': 0.034, '2K': 0.05, '4K': 0.076 },
    maxImageRefs: 14,
  }),
  orImageModel('x-ai/grok-imagine-image-2.0', 'Grok Imagine Image 2.0', {
    aspectRatios: ['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2'],
    pricePerImage: { '1K': 0.06, '2K': 0.08 },
    maxImageRefs: 3,
    pricePerImageRef: 0.01,
    quality: 'medium',
  }),
  orImageModel('microsoft/mai-image-2.6', 'MAI-Image-2.6', { aspectRatios: MAI_RATIOS, pricePerImage: { '1K': 0.04 }, maxImageRefs: 5, resolution: false }),
  orImageModel('microsoft/mai-image-2.6-flash', 'MAI-Image-2.6 Flash', { aspectRatios: MAI_RATIOS, pricePerImage: { '1K': 0.02 }, maxImageRefs: 5, resolution: false }),
  orImageModel('black-forest-labs/flux-3-image', 'FLUX.3 Image', {
    aspectRatios: ['21:9', '16:9', '3:2', '4:3', '5:4', '1:1', '4:5', '3:4', '2:3', '9:16', '9:21'],
    pricePerImage: { '1K': 0.048, '2K': 0.1, '4K': 0.607 },
    maxImageRefs: 10,
  }),
  orImageModel('qwen/qwen-image-3-pro', 'Qwen Image 3 Pro', {
    aspectRatios: ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9'],
    pricePerImage: { '1K': 0.04, '2K': 0.075 },
    maxImageRefs: 4,
    pricePerImageRef: 0.003,
  }),
  orImageModel('bytedance-seed/seedream-5-0-pro', 'Seedream 5.0 Pro', {
    aspectRatios: SEEDREAM_RATIOS,
    pricePerImage: { '1K': 0.045, '2K': 0.09 },
    maxImageRefs: 14,
    pricePerImageRef: 0.003,
    refusesRealPeople: true,
  }),
  orImageModel('bytedance-seed/seedream-5-0-flash', 'Seedream 5.0 Flash', {
    aspectRatios: SEEDREAM_RATIOS,
    pricePerImage: { '1K': 0.018, '2K': 0.018 },
    maxImageRefs: 14,
    refusesRealPeople: true,
  }),
]

export const IMAGE_MODELS: ModelSpec[] = [
  imageModel('gemini-3.1-flash-image', 'Nano Banana 2', ['512', '1K', '2K', '4K'], { '512': 0.045, '1K': 0.067, '2K': 0.101, '4K': 0.151 }, true),
  imageModel('gemini-3-pro-image', 'Nano Banana Pro', ['1K', '2K', '4K'], { '1K': 0.134, '2K': 0.134, '4K': 0.24 }, true),
  imageModel('gemini-3.1-flash-lite-image', 'Nano Banana 2 Lite', ['1K'], { '1K': 0.0336 }, false),
  ...OPENROUTER_IMAGE_MODELS,
]

// TTS (docs/pricing, 2026-10-06): $9/M audio tokens Flash, $6/M Lite = $0.00225 / $0.0015 per 10 s until 2026-12-31,
// doubling from 2027-01-01. Voice design has no separate price on the pricing page.
const ttsModel = (id: ModelId, label: string, pricePerAudioSecond: number): ModelSpec => ({
  ...imageModel(id, label, [], {}, false),
  kind: 'audio',
  provider: 'tts',
  aspectRatios: ['16:9'],
  imageSizes: undefined,
  pricePerImage: undefined,
  maxImageRefs: 0,
  imageRefsSoftMax: 0,
  pricePerAudioSecond,
})

export const TTS_MODELS: ModelSpec[] = [
  ttsModel('gemini-3.8-flash-tts', 'Gemini TTS Flash', 0.000225),
  ttsModel('gemini-3.8-flash-lite-tts', 'Gemini TTS Lite', 0.00015),
]

// Lyria (docs/pricing, 2026-10-08): Clip = always 30 s, $0.04; 3.5 = a full song ("a couple of minutes", length steered by
// the prompt), $0.08. Both take text + images through the Interactions API and return MP3. No free tier.
const musicModel = (id: ModelId, label: string, durations: number[], pricePerRequest: number): ModelSpec => ({
  ...imageModel(id, label, [], {}, false),
  kind: 'music',
  provider: 'lyria',
  aspectRatios: ['16:9'],
  imageSizes: undefined,
  pricePerImage: undefined,
  durations,
  defaultDuration: durations[0],
  // the docs show one image as inspiration; a few more are accepted
  maxImageRefs: 3,
  imageRefsSoftMax: 1,
  pricePerRequest,
})

export const MUSIC_MODELS: ModelSpec[] = [
  // 0 = let the song decide (about 2-3 min); other values become a length line in the prompt
  musicModel('lyria-3.5', 'Lyria 3.5', [0, 30, 60, 90, 120, 180], 0.08),
  musicModel('lyria-3-clip-preview', 'Lyria 3 Clip', [30], 0.04),
]

/** Not a model: a timeline rendered locally by ffmpeg in Studio ($0). Lives here so its exports are ordinary gallery items. */
export const STUDIO_MODEL: ModelSpec = {
  ...imageModel('studio-edit', 'Studio edit', [], {}, false),
  kind: 'video',
  provider: 'studio',
  aspectRatios: ['16:9', '9:16', '1:1'],
  imageSizes: undefined,
  pricePerImage: undefined,
  resolutions: ['720p', '1080p'],
  maxImageRefs: 0,
  imageRefsSoftMax: 0,
}

export const VIDEO_MODELS = [...MODELS, ...OPENROUTER_MODELS]
MODELS.push(...OPENROUTER_MODELS, ...IMAGE_MODELS, ...TTS_MODELS, ...MUSIC_MODELS, STUDIO_MODEL)

export const DEFAULT_MODEL: ModelId = 'gemini-omni-1.1-flash'
export const DEFAULT_IMAGE_MODEL: ModelId = 'gemini-3.1-flash-image'
export const DEFAULT_TTS_MODEL: ModelId = 'gemini-3.8-flash-tts'
export const DEFAULT_MUSIC_MODEL: ModelId = 'lyria-3.5'

export function getModel(id: string): ModelSpec {
  const m = MODELS.find((x) => x.id === id)
  if (!m) throw new Error(`Unknown model ${id}`)
  return m
}

/** Shown before sending: ByteDance's moderation refuses such inputs (InputImageSensitiveContentDetected.PrivacyInformation). */
export function realPeopleWarning(m: ModelSpec): string {
  return `${m.label} (ByteDance) refuses input images that may show a real person - use pictures without real people, or Nano Banana / GPT Image / FLUX / Kling for those.`
}

export const MAX_COUNT = 4
export const VIDEO_REF_MAX_SECONDS = 3

export interface ParentInfo {
  model: string
  resolution?: Resolution
  /** Veo output still on Google's side (2-day retention) */
  veoVideoAvailable?: boolean
  hasInteraction?: boolean
  /** finished, with its file - all an OpenRouter photo edit needs */
  completed?: boolean
}

export function parentInfoOf(g: Generation | undefined): ParentInfo | undefined {
  if (!g) return undefined
  return {
    model: g.model,
    resolution: g.settings.resolution,
    hasInteraction: !!g.provider.interactionId && g.status === 'completed',
    completed: g.status === 'completed' && !!g.file,
    veoVideoAvailable: !!g.provider.veoVideoExpiresAt && Date.parse(g.provider.veoVideoExpiresAt) > Date.now(),
  }
}

export interface Resolved {
  settings: Settings
  /** chip -> reason it is locked to its current value */
  locks: Partial<Record<keyof Settings, string>>
  /** request cannot be sent */
  errors: string[]
  /** request can be sent, but the user should know */
  warnings: string[]
}

/**
 * Normalises settings for a model and the attached refs: the single rule used by the
 * composer chips, the cost pill and the server's validation.
 */
export function resolveSettings(
  modelId: string,
  input: Settings,
  refs: Refs,
  mode: GenerationMode = 'create',
  parent?: ParentInfo,
): Resolved {
  const m = getModel(modelId)
  const s: Settings = { ...input }
  const locks: Resolved['locks'] = {}
  const errors: string[] = []
  const warnings: string[] = []

  if (!m.aspectRatios.includes(s.aspectRatio)) s.aspectRatio = m.aspectRatios[0]
  s.count = Math.min(MAX_COUNT, Math.max(1, Math.round(s.count || 1)))
  if (m.kind === 'image') return resolveImage(m, s, refs, mode, parent)
  if (m.kind === 'music') return resolveMusic(m, s, refs, mode)
  if (m.kind === 'audio') {
    const locks: Resolved['locks'] = { count: 'One recording per script', enhance: 'The script is spoken as written' }
    s.count = 1
    s.enhance = false
    const errors = mode !== 'create' ? ['Speech cannot be edited or extended - change the script and generate again.'] : []
    return { settings: s, locks, errors, warnings: [] }
  }

  if (!m.resolutions.includes(s.resolution)) s.resolution = m.resolutions.includes('720p') ? '720p' : m.resolutions[0]
  if (!m.durations.includes(s.duration)) s.duration = m.defaultDuration
  s.count = Math.min(MAX_COUNT, Math.max(1, Math.round(s.count || 1)))

  const nImg = refs.images.length
  const nVid = refs.videos.length

  if (refs.lastFrame && !refs.firstFrame) errors.push('An end frame needs a start frame.')
  if (m.frames && refs.firstFrame && !m.frames.includes('first')) errors.push(`${m.label} takes no start frame.`)
  if (m.frames && refs.lastFrame && !m.frames.includes('last')) errors.push(`${m.label} takes no end frame.`)
  if (nVid > m.maxVideoRefs) {
    errors.push(m.maxVideoRefs ? `At most ${m.maxVideoRefs} video refs.` : `${m.label} does not take video refs.`)
  }
  if (nImg > m.maxImageRefs) {
    errors.push(m.maxImageRefs ? `${m.label} takes at most ${m.maxImageRefs} image refs.` : `${m.label} does not take image refs.`)
  } else if (nImg > m.imageRefsSoftMax) {
    warnings.push(`More than ${m.imageRefsSoftMax} image refs - results may degrade.`)
  }
  if (m.refusesRealPeople && (refs.firstFrame || refs.lastFrame || nImg)) warnings.push(realPeopleWarning(m))

  if (mode === 'edit' && !m.canEdit) errors.push(`${m.label} cannot edit videos.`)
  if (mode === 'extend' && !m.canExtend) errors.push(`${m.label} cannot extend videos.`)
  if (mode !== 'create') {
    if (!parent) errors.push('The video to continue from is missing.')
    else if (getModel(parent.model).provider !== m.provider) {
      errors.push(`A ${getModel(parent.model).label} video can only be ${mode === 'edit' ? 'edited' : 'extended'} by the same model family.`)
    } else if (m.provider === 'omni' && !parent.hasInteraction) {
      errors.push('That video has no stored interaction to continue from.')
    }
  }

  if (m.audio === false) {
    s.audio = false
    locks.audio = `${m.label} makes silent videos`
  }
  if (m.provider === 'openrouter' && (refs.firstFrame || refs.lastFrame) && (nImg || nVid)) {
    errors.push(`${m.label} cannot combine start/end frames with image or video refs.`)
  }

  if (m.provider === 'veo') {
    if ((refs.firstFrame || refs.lastFrame) && nImg) errors.push('Veo cannot combine start/end frames with image refs.')
    if (mode === 'extend') {
      if (parent && parent.resolution !== '720p') errors.push('Veo can only extend 720p videos.')
      if (parent && !parent.veoVideoAvailable) errors.push('Veo keeps generated videos for 2 days - this one can no longer be extended.')
      if (refs.firstFrame || nImg) errors.push('Veo extension takes no images.')
      s.resolution = '720p'
      locks.resolution = 'Veo extends at 720p only'
    }
    const why =
      mode === 'extend' ? 'Veo extension is always 8 s'
      : nImg ? '8 s required with image refs'
      : s.resolution === '1080p' || s.resolution === '4k' ? `8 s required at ${s.resolution}`
      : undefined
    if (why) {
      s.duration = 8
      locks.duration = why
    }
  } else {
    if (mode !== 'create') {
      locks.duration = mode === 'extend' ? 'Extensions add 3-10 s, chosen by the model' : 'Edits keep the source length'
      s.duration = 0
    }
  }

  if (mode !== 'create') locks.aspectRatio = 'Keeps the aspect ratio of the source video'
  if (mode !== 'create') {
    s.count = 1
    locks.count = 'One continuation at a time'
  }

  if (mode === 'edit' && s.enhance) {
    s.enhance = false
    locks.enhance = 'Edits work best with short, plain prompts'
  }

  return { settings: s, locks, errors, warnings }
}

function resolveImage(m: ModelSpec, s: Settings, refs: Refs, mode: GenerationMode, parent?: ParentInfo): Resolved {
  const locks: Resolved['locks'] = {}
  const errors: string[] = []
  const sizes = m.imageSizes ?? ['1K']
  if (!s.imageSize || !sizes.includes(s.imageSize)) s.imageSize = sizes.includes('1K') ? '1K' : sizes[0]
  if (sizes.length === 1) {
    locks.imageSize = m.imageParams?.resolution === false ? `${m.label} sizes the image from the aspect ratio (about 1 MP)` : `${m.label} only makes ${sizes[0]} images`
  }
  if (refs.images.length > m.maxImageRefs) errors.push(`${m.label} takes at most ${m.maxImageRefs} reference images.`)
  if (mode === 'extend') errors.push('Photos cannot be extended.')
  if (mode === 'edit') {
    if (!m.canEdit) errors.push(`${m.label} is not made for multi-turn editing - pick Nano Banana 2 or Pro.`)
    if (!parent) errors.push('The photo to edit is missing.')
    else if (getModel(parent.model).kind !== 'image') errors.push('Only photos can be edited in Photo mode.')
    else if (m.provider === 'openrouter-image') {
      // the photo being edited travels as one more input image
      if (!parent.completed) errors.push('The photo to edit is not finished.')
      if (refs.images.length + 1 > m.maxImageRefs) errors.push(`${m.label} takes at most ${m.maxImageRefs} images, the photo being edited included.`)
    } else if (!parent.hasInteraction) errors.push('That photo has no stored interaction to continue from.')
    s.count = 1
    locks.count = 'One edit at a time'
  }
  const warnings = m.refusesRealPeople && (refs.images.length || mode === 'edit') ? [realPeopleWarning(m)] : []
  return { settings: s, locks, errors, warnings }
}

function resolveMusic(m: ModelSpec, s: Settings, refs: Refs, mode: GenerationMode): Resolved {
  const locks: Resolved['locks'] = {}
  const errors: string[] = []
  const warnings: string[] = []
  if (!m.durations.includes(s.duration)) s.duration = m.defaultDuration
  if (m.durations.length === 1) locks.duration = `${m.label} always makes ${m.durations[0]} s`
  if (mode !== 'create') errors.push('Music cannot be edited or extended - change the prompt and generate again.')
  if (refs.images.length > m.maxImageRefs) errors.push(`${m.label} takes at most ${m.maxImageRefs} images.`)
  else if (refs.images.length > m.imageRefsSoftMax) warnings.push('Lyria is documented with one inspiration image - more may be ignored.')
  return { settings: s, locks, errors, warnings }
}

/**
 * `speechSeconds` - estimated length of a TTS script (see shared/voices.estimateSpeechSeconds).
 * `imageRefs` - attached image refs, for models that bill them (MiniMax H3).
 */
export function estimateCost(modelId: string, s: Settings, speechSeconds = 0, imageRefs = 0): number {
  const m = getModel(modelId)
  if (m.kind === 'audio') return (m.pricePerAudioSecond ?? 0) * speechSeconds
  if (m.kind === 'image') {
    const perImage = m.pricePerImage?.[s.imageSize ?? '1K'] ?? Object.values(m.pricePerImage ?? {})[0] ?? 0
    return (perImage + (m.pricePerImageRef ?? 0) * imageRefs) * s.count
  }
  if (m.pricePerRequest !== undefined) return m.pricePerRequest * s.count
  const rate = ratePerSecond(m, s.resolution, s.audio) ?? Object.values(m.pricePerSecond)[0] ?? 0
  const seconds = s.duration || m.autoDurationEstimate
  return (rate * seconds + (m.pricePerImageRef ?? 0) * imageRefs) * s.count
}

/** USD per second; the silent rate when sound is off and the model bills less without it. */
function ratePerSecond(m: ModelSpec, resolution: Resolution, audio = true): number | undefined {
  return (!audio ? m.pricePerSecondSilent?.[resolution] : undefined) ?? m.pricePerSecond[resolution]
}

export function costOfSeconds(modelId: string, resolution: Resolution, seconds: number, audio = true): number {
  return (ratePerSecond(getModel(modelId), resolution, audio) ?? 0) * seconds
}

export function formatUsd(v: number): string {
  if (v > 0 && v < 0.01) return `$${v.toFixed(4)}`
  return v < 10 ? `$${v.toFixed(2)}` : `$${v.toFixed(0)}`
}
