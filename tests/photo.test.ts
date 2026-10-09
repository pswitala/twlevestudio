import { describe, expect, it } from 'vitest'
import { estimateCost, resolveSettings } from '../shared/models'
import { compileImagePrompt, unknownTokens } from '../shared/promptCompiler'
import type { Settings } from '../shared/types'
import { costFromUsage, extractImage } from '../server/providers/nanobanana'
import { renumber } from '../src/stores/composer'

const base: Settings = { aspectRatio: '16:9', resolution: '720p', duration: 0, audio: true, count: 1, enhance: false, imageSize: '1K' }
const noRefs = { images: [], videos: [] }

describe('photo settings', () => {
  it('keeps image ratios and sizes per model', () => {
    const r = resolveSettings('gemini-3.1-flash-image', { ...base, aspectRatio: '21:9', imageSize: '512' }, noRefs)
    expect(r.errors).toEqual([])
    expect(r.settings).toMatchObject({ aspectRatio: '21:9', imageSize: '512' })
    expect(resolveSettings('gemini-3-pro-image', { ...base, imageSize: '512' }, noRefs).settings.imageSize).toBe('1K')
    const lite = resolveSettings('gemini-3.1-flash-lite-image', { ...base, imageSize: '4K' }, noRefs)
    expect(lite.settings.imageSize).toBe('1K')
    expect(lite.locks.imageSize).toBeTruthy()
  })

  it('caps refs at 14 and only edits photos with a stored interaction', () => {
    expect(resolveSettings('gemini-3.1-flash-image', base, { images: Array(15).fill('x'), videos: [] }).errors).toHaveLength(1)
    const model = 'gemini-3.1-flash-image'
    expect(resolveSettings(model, base, noRefs, 'edit', { model, hasInteraction: true }).errors).toEqual([])
    expect(resolveSettings(model, base, noRefs, 'edit', { model, hasInteraction: false }).errors).toHaveLength(1)
    expect(resolveSettings(model, base, noRefs, 'edit', { model: 'gemini-omni-1.1-flash', hasInteraction: true }).errors.join()).toMatch(/Only photos/)
    expect(resolveSettings('gemini-3.1-flash-lite-image', base, noRefs, 'edit', { model, hasInteraction: true }).errors.join()).toMatch(/not made for multi-turn/)
  })

  it('a video model falls back to a video ratio', () => {
    expect(resolveSettings('gemini-omni-1.1-flash', { ...base, aspectRatio: '1:1' }, noRefs).settings.aspectRatio).toBe('16:9')
  })

  it('prices per image', () => {
    expect(estimateCost('gemini-3.1-flash-image', { ...base, imageSize: '2K', count: 3 })).toBeCloseTo(0.303)
    expect(estimateCost('gemini-3-pro-image', { ...base, imageSize: '4K' })).toBeCloseTo(0.24)
  })
})

describe('photo prompts', () => {
  it('turns @imgN into "image N" and rejects video tokens', () => {
    expect(compileImagePrompt('put the cat from @img2 on @img1')).toBe('put the cat from image 2 on image 1')
    expect(unknownTokens('@start and @img1', { hasFirst: false, hasLast: false, imageRefs: 1, videoRefs: 0 })).toEqual(['@start'])
  })

  it('renumbers tokens when a ref is removed', () => {
    expect(renumber('a @img1 b @img2 c @img3', 'img', 1)).toBe('a @img1 b  c @img2')
    expect(renumber('@vid1 @vid2', 'vid', 0)).toBe(' @vid1')
  })
})

describe('extractImage', () => {
  it('takes the final image and skips thought steps', () => {
    const img = extractImage({
      steps: [
        { type: 'thought', content: [{ type: 'image', data: 'THOUGHT' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Here it is' }, { type: 'image', data: 'FINAL', mime_type: 'image/png' }] },
      ],
    })
    expect(img.data).toBe('FINAL')
  })

  it('reports the model text when no image came back', () => {
    expect(() => extractImage({ steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Cannot draw that' }] }] })).toThrow(/Cannot draw that/)
  })

  it('prices image tokens at the image rate', () => {
    const usd = costFromUsage('gemini-3.1-flash-image', {
      total_input_tokens: 100,
      total_output_tokens: 1120,
      output_tokens_by_modality: [{ modality: 'image', tokens: 1120 }],
    })
    expect(usd).toBeCloseTo((100 * 0.5 + 1120 * 60) / 1e6, 6)
  })
})
