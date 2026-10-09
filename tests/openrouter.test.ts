import { describe, expect, it, vi } from 'vitest'
import { estimateCost, getModel, resolveSettings, VIDEO_MODELS } from '../shared/models'
import type { Generation, Settings } from '../shared/types'

vi.mock('../server/store', () => ({
  DIRS: { tmp: '/data/tmp' },
  findAsset: (id: string) =>
    id === 'huge'
      ? { id, kind: 'image', mime: 'image/png', width: 8160, height: 4590 }
      : { id, kind: id.startsWith('v') ? 'video' : 'image', mime: id.startsWith('v') ? 'video/mp4' : 'image/png', width: 1024, height: 1024 },
  findGeneration: (id: string) => (id === 'parent' ? { id, kind: 'image', file: 'parent.jpg' } : undefined),
  outputDir: () => '/data/images',
}))
vi.mock('../server/assets', () => ({ assetBase64: async () => 'QUJD', assetPath: (a: { id: string }) => `/data/assets/${a.id}` }))
vi.mock('node:fs', () => ({ default: { promises: { readFile: async () => Buffer.from('XYZ'), rm: async () => {} } } }))
const scaleImage = vi.fn(async () => {})
vi.mock('../server/media', async (importOriginal) => ({ ...(await importOriginal<typeof import('../server/media')>()), scaleImage }))

const { buildImageRequest, buildRequest, costOf, resolutionParam } = await import('../server/providers/openrouter')
const { compileOpenRouterImagePrompt } = await import('../shared/promptCompiler')

const base: Settings = { aspectRatio: '16:9', resolution: '720p', duration: 5, audio: true, count: 1, enhance: false }
const noRefs = { images: [], videos: [] }

describe('OpenRouter catalogue', () => {
  it('lists the models as video models with sane defaults', () => {
    const ids = VIDEO_MODELS.filter((m) => m.provider === 'openrouter').map((m) => m.id)
    expect(ids).toEqual(expect.arrayContaining(['bytedance/seedance-2.5', 'minimax/hailuo-3', 'alibaba/happyhorse-1.1']))
    for (const id of ids) {
      const m = getModel(id)
      expect(m.durations).toContain(m.defaultDuration)
      expect(m.resolutions.length).toBeGreaterThan(0)
      expect(m.canEdit || m.canExtend).toBe(false)
    }
  })
})

describe('resolveSettings for OpenRouter models', () => {
  it('snaps duration and resolution to what the model offers', () => {
    const r = resolveSettings('minimax/hailuo-3', { ...base, duration: 4 }, noRefs)
    expect(r.settings).toMatchObject({ resolution: '2k', duration: 5 })
  })

  it('refuses frames the model does not take', () => {
    expect(resolveSettings('alibaba/happyhorse-1.1', base, { firstFrame: 'a', lastFrame: 'b', images: [], videos: [] }).errors.join()).toMatch(
      /takes no end frame/,
    )
    expect(resolveSettings('bytedance/seedance-2.5', base, { firstFrame: 'a', lastFrame: 'b', images: [], videos: [] }).errors).toEqual([])
  })

  it('does not mix frames with refs (OpenRouter would drop the refs)', () => {
    expect(resolveSettings('bytedance/seedance-2.5', base, { firstFrame: 'a', images: ['b'], videos: [] }).errors.join()).toMatch(/cannot combine/)
    expect(resolveSettings('bytedance/seedance-2.5', base, { images: ['b'], videos: ['v1'] }).errors).toEqual([])
  })

  it('locks sound off for silent models and refuses refs where there are none', () => {
    const r = resolveSettings('minimax/hailuo-3-max', base, noRefs)
    expect(r.settings.audio).toBe(false)
    expect(r.locks.audio).toMatch(/silent/)
    expect(resolveSettings('alibaba/happyhorse-1.1', base, { images: ['a'], videos: [] }).errors.join()).toMatch(/does not take image refs/)
  })

  it('cannot edit or extend', () => {
    const m = 'bytedance/seedance-2.5'
    expect(resolveSettings(m, base, noRefs, 'extend', { model: m }).errors.join()).toMatch(/cannot extend/)
  })
})

describe('estimateCost for OpenRouter models', () => {
  it('derives Seedance per-second rates from video tokens', () => {
    // 1280x720 x 24 fps / 1024 = 21,600 tokens/s x $10.7/M
    expect(estimateCost('bytedance/seedance-2.5', { ...base, duration: 10 })).toBeCloseTo(2.3112, 3)
  })

  it('uses the silent rate and per-image fees', () => {
    expect(estimateCost('kwaivgi/kling-v3.0-pro', { ...base, duration: 5, audio: false })).toBeCloseTo(0.56)
    expect(estimateCost('kwaivgi/kling-v3.0-pro', { ...base, duration: 5 })).toBeCloseTo(0.84)
    expect(estimateCost('minimax/hailuo-3', { ...base, resolution: '2k', duration: 5 }, 0, 2)).toBeCloseTo(0.73)
  })
})

describe('buildRequest', () => {
  const gen = (over: Partial<Generation>): Generation =>
    ({
      id: 'g',
      model: 'bytedance/seedance-2.5',
      settings: { ...base, audio: false },
      prompt: 'raw',
      sentPrompt: 'sent',
      refs: noRefs,
      mode: 'create',
      provider: {},
      ...over,
    }) as Generation

  it('sends frames as frame_images and the sound switch', async () => {
    const body = await buildRequest(gen({ refs: { firstFrame: 'a', lastFrame: 'b', images: [], videos: [] } }))
    expect(body).toMatchObject({ model: 'bytedance/seedance-2.5', prompt: 'sent', aspect_ratio: '16:9', duration: 5, resolution: '720p', generate_audio: false })
    expect(body.frame_images).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' }, frame_type: 'first_frame' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' }, frame_type: 'last_frame' },
    ])
    expect(body.input_references).toBeUndefined()
  })

  it('sends image and video refs as input_references', async () => {
    const body = await buildRequest(gen({ refs: { images: ['i1'], videos: ['v1'] } }))
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      { type: 'video_url', video_url: { url: 'data:video/mp4;base64,QUJD' } },
    ])
  })

  it('leaves the sound switch out for models without one', async () => {
    const body = await buildRequest(gen({ model: 'alibaba/happyhorse-1.1' }))
    expect(body).not.toHaveProperty('generate_audio')
  })

  it('maps 2k/4k and reads the reported cost', () => {
    expect(resolutionParam('2k')).toBe('2K')
    expect(resolutionParam('4k')).toBe('4K')
    expect(resolutionParam('768p')).toBe('768p')
    expect(costOf({ id: 'j', status: 'completed', usage: { cost: 0.42 } })).toBe(0.42)
    expect(costOf({ id: 'j', status: 'completed', usage: { cost: null } })).toBeUndefined()
  })
})

describe('OpenRouter photo models', () => {
  const photo: Settings = { ...base, aspectRatio: '1:1', imageSize: '2K' }
  const gen = (over: Partial<Generation>): Generation =>
    ({ id: 'g', kind: 'image', model: 'google/gemini-nano-banana-2.1', settings: photo, prompt: 'p', sentPrompt: 'sent', refs: noRefs, mode: 'create', provider: {}, ...over }) as Generation

  it('keeps sizes per model and locks the ones without a resolution', () => {
    expect(resolveSettings('google/gemini-nano-banana-2.1', photo, noRefs).settings.imageSize).toBe('2K')
    const gpt = resolveSettings('openai/gpt-image-2', photo, noRefs)
    expect(gpt.settings.imageSize).toBe('1K')
    expect(gpt.locks.imageSize).toMatch(/aspect ratio/)
    expect(resolveSettings('x-ai/grok-imagine-image-2.0', photo, { images: ['a', 'b', 'c', 'd'], videos: [] }).errors.join()).toMatch(/at most 3/)
  })

  it('edits any finished photo, counting it as one more image', () => {
    const m = 'x-ai/grok-imagine-image-2.0'
    expect(resolveSettings(m, photo, noRefs, 'edit', { model: 'gemini-3.1-flash-image', completed: true }).errors).toEqual([])
    expect(resolveSettings(m, photo, noRefs, 'edit', { model: m, completed: false }).errors.join()).toMatch(/not finished/)
    expect(resolveSettings(m, photo, { images: ['a', 'b', 'c'], videos: [] }, 'edit', { model: m, completed: true }).errors.join()).toMatch(/included/)
  })

  it('prices per image plus per-ref fees', () => {
    expect(estimateCost('qwen/qwen-image-3-pro', { ...photo, count: 2 }, 0, 2)).toBeCloseTo(2 * (0.075 + 0.006))
    expect(estimateCost('openai/gpt-image-2.5-sunburst', photo)).toBeCloseTo(0.13)
  })

  it('sends resolution / quality only where the model takes them', async () => {
    expect(await buildImageRequest(gen({}))).toEqual({ model: 'google/gemini-nano-banana-2.1', prompt: 'sent', aspect_ratio: '1:1', n: 1, resolution: '2K' })
    const gpt = await buildImageRequest(gen({ model: 'openai/gpt-image-2', settings: { ...photo, imageSize: '1K' } }))
    expect(gpt).toMatchObject({ quality: 'high' })
    expect(gpt).not.toHaveProperty('resolution')
  })

  it('puts the photo being edited after the refs and says so in the prompt', async () => {
    const body = await buildImageRequest(gen({ mode: 'edit', parentId: 'parent', refs: { images: ['i1'], videos: [] } }))
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('XYZ').toString('base64')}` } },
    ])
    expect(compileOpenRouterImagePrompt('add a hat to @img1', { mode: 'edit', imageRefs: 1 })).toBe(
      'Edit image 2 (the last image): add a hat to image 1 Keep everything else in it unchanged; the other images are references.',
    )
    expect(compileOpenRouterImagePrompt('a cat', { mode: 'create', imageRefs: 0 })).toBe('a cat')
  })
})

describe('input image cap', () => {
  it('scales an image over 4096 px / 16.7 MP down to a JPEG copy, keeps small ones', async () => {
    const { fitSize } = await import('../server/media')
    expect(fitSize(8160, 4590, 4096, 4096 * 4096)).toEqual({ w: 4096, h: 2304 })
    expect(fitSize(5000, 5000, 8192, 4096 * 4096)).toEqual({ w: 4096, h: 4096 })
    expect(fitSize(2048, 2048, 4096, 4096 * 4096)).toBeUndefined()

    scaleImage.mockClear()
    const body = await buildImageRequest({
      id: 'g', kind: 'image', model: 'bytedance-seed/seedream-5-0-pro', settings: { ...base, aspectRatio: '1:1', imageSize: '2K' },
      prompt: 'p', refs: { images: ['huge', 'small'], videos: [] }, mode: 'create', provider: {},
    } as unknown as Generation)
    expect(scaleImage).toHaveBeenCalledTimes(1)
    expect(scaleImage).toHaveBeenCalledWith('/data/assets/huge', expect.stringMatching(/\.jpg$/), 4096, 2304)
    expect(body.input_references).toEqual([
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${Buffer.from('XYZ').toString('base64')}` } },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ])
  })
})

describe('real-person refusals (ByteDance)', () => {
  it('turns the wrapped provider error into one readable line', async () => {
    const { explainError } = await import('../server/providers/openrouter')
    const raw =
      'HTTP 400: {"error":{"code":"InputImageSensitiveContentDetected.PrivacyInformation","message":"The request failed because the input image \'content[1]\' \'content[2]\' may contain real person. Request id: 0217","param":"","type":"BadRequest"}}'
    const msg = explainError(raw)
    expect(msg).toMatch(/^Refused: an input image may show a real person/)
    expect(msg).toMatch(/Nano Banana/)
    expect(msg).toContain('[InputImageSensitiveContentDetected.PrivacyInformation]')
    expect(explainError('HTTP 400: {"error":{"message":"Bad size"}}')).toBe('Bad size')
    expect(explainError('plain text')).toBe('plain text')
  })

  it('warns before sending images to Seedream / Seedance, not to others', () => {
    const photo: Settings = { ...base, aspectRatio: '1:1', imageSize: '1K' }
    const one = { images: ['a'], videos: [] }
    expect(resolveSettings('bytedance-seed/seedream-5-0-pro', photo, one).warnings.join()).toMatch(/real person/)
    expect(resolveSettings('bytedance-seed/seedream-5-0-pro', photo, noRefs).warnings).toEqual([])
    expect(resolveSettings('bytedance/seedance-2.5', base, { firstFrame: 'a', images: [], videos: [] }).warnings.join()).toMatch(/real person/)
    expect(resolveSettings('google/gemini-nano-banana-2.1', photo, one).warnings).toEqual([])
    expect(resolveSettings('kwaivgi/kling-v3.0-pro', base, { firstFrame: 'a', images: [], videos: [] }).warnings).toEqual([])
  })
})
