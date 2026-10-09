import { describe, expect, it } from 'vitest'
import { availableTokens, compileOmniPrompt, compileVeoPrompt, unknownTokens } from '../shared/promptCompiler'

const none = { hasFirst: false, hasLast: false, imageRefs: 0, videoRefs: 0 }

describe('compileOmniPrompt', () => {
  it('leaves a plain text prompt alone', () => {
    expect(compileOmniPrompt('  A horse galloping  ', none)).toBe('A horse galloping')
  })

  it('declares sources and references in input order', () => {
    const out = compileOmniPrompt('@start a woman @img1 holds @img2 like @vid1', {
      hasFirst: true,
      hasLast: true,
      imageRefs: 2,
      videoRefs: 1,
    })
    expect(out).toContain(
      '[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] [# References <IMAGE_REF_0>@Image3 <IMAGE_REF_1>@Image4 <VIDEO_REF_0>@Video1]',
    )
    expect(out).toContain('<FIRST_FRAME> a woman <IMAGE_REF_0> holds <IMAGE_REF_1> like <VIDEO_REF_0>')
    expect(out).toContain('Use Image1 as the first frame and Image2 as the last frame.')
    expect(out).toContain('should not be used as literal initial frames')
    expect(out).toContain('Do not use them as a source for video editing.')
  })

  it('numbers image refs after a lone start frame', () => {
    const out = compileOmniPrompt('x @img1', { ...none, hasFirst: true, imageRefs: 1 })
    expect(out.startsWith('[# Sources <FIRST_FRAME>@Image1] [# References <IMAGE_REF_0>@Image2]')).toBe(true)
    expect(out).toContain('Use Image1 as the starting frame.')
  })

  it('adds the duration hint and the extend prefix', () => {
    expect(compileOmniPrompt('a cat', none, { durationHint: 6 })).toBe('a cat The video is 6 seconds long.')
    expect(compileOmniPrompt('the camera pans left', none, { mode: 'extend' })).toBe('Extend this video: the camera pans left')
    expect(compileOmniPrompt('', none, { mode: 'extend' })).toBe('Extend this video.')
    expect(compileOmniPrompt('Continue the scene', none, { mode: 'extend' })).toBe('Continue the scene')
  })
})

describe('tokens', () => {
  it('lists the tokens for attached media', () => {
    expect(availableTokens({ hasFirst: true, hasLast: false, imageRefs: 2, videoRefs: 1 }).map((t) => t.token)).toEqual([
      '@start',
      '@img1',
      '@img2',
      '@vid1',
    ])
  })

  it('reports tokens without media', () => {
    expect(unknownTokens('@img1 and @img3 and @end and @start', { ...none, hasFirst: true, imageRefs: 2 })).toEqual(['@img3', '@end'])
    expect(unknownTokens('mail me at a@b.com', none)).toEqual([])
  })

  it('turns tokens into words for Veo', () => {
    expect(compileVeoPrompt('@start the woman from @img2 walks')).toBe('the first frame the woman from reference image 2 walks')
  })
})
