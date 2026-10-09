import { describe, expect, it } from 'vitest'
import { estimateCost, resolveSettings } from '../shared/models'
import type { Settings } from '../shared/types'

const base: Settings = { aspectRatio: '16:9', resolution: '720p', duration: 4, audio: true, count: 1, enhance: false }
const noRefs = { images: [], videos: [] }

describe('resolveSettings', () => {
  it('locks Veo to 8 s with image refs, 1080p, 4k and extension', () => {
    const veo = 'veo-3.1-generate-preview'
    expect(resolveSettings(veo, base, { images: ['a'], videos: [] }).settings.duration).toBe(8)
    expect(resolveSettings(veo, { ...base, resolution: '1080p' }, noRefs).locks.duration).toMatch(/1080p/)
    expect(resolveSettings(veo, base, noRefs).settings.duration).toBe(4)
    const ext = resolveSettings(veo, { ...base, resolution: '4k' }, noRefs, 'extend', {
      model: veo,
      resolution: '720p',
      veoVideoAvailable: true,
    })
    expect(ext.errors).toEqual([])
    expect(ext.settings).toMatchObject({ duration: 8, resolution: '720p' })
  })

  it('refuses what Veo Lite cannot do', () => {
    const lite = 'veo-3.1-lite-generate-preview'
    expect(resolveSettings(lite, base, { images: ['a'], videos: [] }).errors.join()).toMatch(/does not take image refs/)
    expect(resolveSettings(lite, { ...base, resolution: '4k' }, noRefs).settings.resolution).toBe('720p')
    expect(
      resolveSettings(lite, base, noRefs, 'extend', { model: lite, resolution: '720p', veoVideoAvailable: true }).errors.join(),
    ).toMatch(/cannot extend/)
  })

  it('applies Omni ref limits', () => {
    const omni = 'gemini-omni-1.1-flash'
    expect(resolveSettings(omni, base, { images: [], videos: ['1', '2', '3', '4'] }).errors.join()).toMatch(/At most 3 video refs/)
    expect(resolveSettings(omni, base, { images: Array(7).fill('x'), videos: [] }).warnings).toHaveLength(1)
    expect(resolveSettings(omni, base, { lastFrame: 'b', images: [], videos: [] }).errors.join()).toMatch(/needs a start frame/)
    expect(resolveSettings(omni, { ...base, duration: 5 }, noRefs).settings.duration).toBe(0)
  })

  it('needs a stored interaction to edit with Omni, and never edits with Veo', () => {
    const omni = 'gemini-omni-1.1-flash'
    expect(resolveSettings(omni, base, noRefs, 'edit', { model: omni, hasInteraction: false }).errors).toHaveLength(1)
    const ok = resolveSettings(omni, { ...base, enhance: true, count: 3 }, noRefs, 'edit', { model: omni, hasInteraction: true })
    expect(ok.errors).toEqual([])
    expect(ok.settings).toMatchObject({ enhance: false, count: 1 })
    const veo = 'veo-3.1-generate-preview'
    expect(resolveSettings(veo, base, noRefs, 'edit', { model: veo }).errors.join()).toMatch(/cannot edit/)
  })
})

describe('estimateCost', () => {
  it('multiplies rate x seconds x count', () => {
    expect(estimateCost('veo-3.1-fast-generate-preview', { ...base, duration: 8, count: 2 })).toBeCloseTo(1.6)
    expect(estimateCost('gemini-omni-1.1-flash', { ...base, duration: 0 })).toBeCloseTo(1.0136, 3)
    expect(estimateCost('gemini-omni-1.1-flash', { ...base, resolution: '360p', duration: 0 })).toBeCloseTo(0.3379, 3)
  })
})
