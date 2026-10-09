import { describe, expect, it } from 'vitest'
import { estimateCost, resolveSettings } from '../shared/models'
import { compileMusicPrompt, readableLyrics } from '../shared/promptCompiler'
import { outputUrl } from '../src/lib/api'
import type { Settings } from '../shared/types'
import { extractMusic } from '../server/providers/lyria'

const S: Settings = { aspectRatio: '16:9', resolution: '720p', duration: 0, audio: true, count: 1, enhance: false }
const noRefs = { images: [], videos: [] }

describe('music (Lyria)', () => {
  it('Lyria 3 Clip is always 30 s; Lyria 3.5 takes a length hint', () => {
    const clip = resolveSettings('lyria-3-clip-preview', { ...S, duration: 120 }, noRefs)
    expect(clip.settings.duration).toBe(30)
    expect(clip.locks.duration).toMatch(/30 s/)
    expect(resolveSettings('lyria-3.5', { ...S, duration: 90 }, noRefs).settings.duration).toBe(90)
    expect(resolveSettings('lyria-3.5', { ...S, duration: 7 }, noRefs).settings.duration).toBe(0)
  })

  it('costs a fixed price per song', () => {
    expect(estimateCost('lyria-3.5', { ...S, count: 2 })).toBeCloseTo(0.16)
    expect(estimateCost('lyria-3-clip-preview', S)).toBeCloseTo(0.04)
  })

  it('cannot be edited and takes at most 3 images', () => {
    expect(resolveSettings('lyria-3.5', S, noRefs, 'edit').errors[0]).toMatch(/cannot be edited/)
    expect(resolveSettings('lyria-3.5', S, { images: ['a', 'b', 'c', 'd'], videos: [] }).errors[0]).toMatch(/at most 3/)
    expect(resolveSettings('lyria-3.5', S, { images: ['a', 'b'], videos: [] }).warnings).toHaveLength(1)
  })

  it('length and instrumental become plain sentences; images become "image N"', () => {
    expect(compileMusicPrompt('Calm folk inspired by @img1', { duration: 90, instrumental: true })).toBe(
      'Calm folk inspired by image 1\n\nLength: about 1:30 minutes.\n\nInstrumental only, no vocals.',
    )
    expect(compileMusicPrompt('Lo-fi', { duration: 30 }, true)).toBe('Lo-fi') // the clip length is fixed - no hint
    expect(compileMusicPrompt('Lo-fi', { duration: 45 })).toBe('Lo-fi\n\nLength: about 45 seconds.')
  })

  it('reads the song and the lyrics from the interaction', () => {
    const r = extractMusic({
      steps: [{ type: 'model_output', content: [{ type: 'text', text: '[Verse 1]\nla la' }, { type: 'audio', data: 'AAAA', mime_type: 'audio/mp3' }] }],
    })
    expect(r.audio.data).toBe('AAAA')
    expect(r.lyrics).toBe('[Verse 1]\nla la')
    expect(extractMusic({ output_audio: { data: 'BBBB' }, output_text: 'x' }).audio.data).toBe('BBBB')
    expect(() => extractMusic({ output_text: 'I cannot make that' })).toThrow(/No music.*cannot make that/)
  })

  it('an instrumental has section markers only - no lyrics', () => {
    expect(extractMusic({ output_audio: { data: 'A' }, output_text: '[[A0]]\n[[B1]]\n[[C2]]' }).lyrics).toBeUndefined()
    expect(readableLyrics('[[A0]]\n[Verse 1]\nla la\n[[B1]]\n[Chorus]\noh')).toBe('[Verse 1]\nla la\n[Chorus]\noh')
  })

  it('a song file is served from the audio folder (a wrong folder greys out the player)', () => {
    expect(outputUrl({ kind: 'music', file: 's.mp3' })).toBe('/files/audio/s.mp3')
    expect(outputUrl({ kind: 'audio', file: 'v.m4a' })).toBe('/files/audio/v.m4a')
  })
})
