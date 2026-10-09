import { describe, expect, it } from 'vitest'
import { composePrompt, effectiveDirectives, withSceneDirectives } from '../shared/directives'
import { compileImagePrompt, compileOmniPrompt, compileVeoPrompt } from '../shared/promptCompiler'

const project = { style: 'documentary realism', camera: 'handheld camera', negative: 'on-screen text, logos' }

describe('effectiveDirectives', () => {
  it('follows the project when nothing is overridden', () => {
    expect(effectiveDirectives(project, {})).toEqual(project)
  })

  it('an override replaces, an empty override switches off', () => {
    expect(effectiveDirectives(project, { camera: 'static tripod', negative: '' })).toEqual({
      style: 'documentary realism',
      camera: 'static tripod',
    })
  })

  it('works without project defaults and ignores whitespace', () => {
    expect(effectiveDirectives(undefined, { style: '  anime  ', camera: ' ' })).toEqual({ style: 'anime' })
  })
})

describe('composePrompt', () => {
  const omniLayout = { hasFirst: false, hasLast: false, imageRefs: 1, videoRefs: 0 }
  const omni = (t: string) => compileOmniPrompt(t, omniLayout, { durationHint: 6 })

  it('puts CAMERA and STYLE in the scene, Omni guidance as its own paragraph, NEGATIVE last', () => {
    // the layout Omni accepted; CAMERA after the reference guidance was "Input blocked"
    const text = composePrompt('a horse @img1', project, { compile: omni }).text
    expect(text).toBe(
      '[# References <IMAGE_REF_0>@Image1] a horse <IMAGE_REF_0>\n\n' +
        'CAMERA: handheld camera\nSTYLE: documentary realism\n\n' +
        'Use the given image(s) as references for video generation. The images should not be used as literal initial frames. The video is 6 seconds long.\n\n' +
        'NEGATIVE: on-screen text, logos',
    )
  })

  it('keeps NEGATIVE in the text and also hands it to Veo as a parameter', () => {
    const r = composePrompt('A horse.', project, { negativeAsParam: true })
    expect(r.text.endsWith('NEGATIVE: on-screen text, logos')).toBe(true)
    expect(r.negativePrompt).toBe('on-screen text, logos')
  })

  it('says FRAMING for photos, flattens line breaks inside a field, leaves a bare prompt alone', () => {
    expect(withSceneDirectives('x', { camera: 'close-up' }, 'image')).toBe('x\n\nFRAMING: close-up')
    expect(withSceneDirectives('x', { style: 'grainy\n  phone   footage' })).toBe('x\n\nSTYLE: grainy phone footage')
    expect(composePrompt('just this', {}, { compile: omni }).text).toBe(
      '[# References <IMAGE_REF_0>@Image1] just this Use the given image(s) as references for video generation. The images should not be used as literal initial frames. The video is 6 seconds long.',
    )
  })

  it('keeps line breaks through the Veo and photo compilers', () => {
    expect(compileVeoPrompt('a horse\n\nCAMERA: wide')).toBe('a horse\n\nCAMERA: wide')
    expect(compileImagePrompt('@img1  in a  field\nFRAMING: close-up')).toBe('image 1 in a field\nFRAMING: close-up')
  })
})
