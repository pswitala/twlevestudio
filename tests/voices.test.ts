import { describe, expect, it } from 'vitest'
import { estimateCost } from '../shared/models'
import { compileOmniPrompt, unknownTokens } from '../shared/promptCompiler'
import { describeVoiceTokens, estimateSpeechSeconds, parseScript, snapshotVoices, speakingVoice, voiceTokens, type Voice } from '../shared/voices'

const voice = (over: Partial<Voice>): Voice => ({
  id: 'x',
  projectId: 'default',
  name: 'Anna',
  description: 'warm woman in her 40s, slightly husky',
  language: 'pl-PL',
  model: 'gemini-3.8-flash-tts',
  createdAt: '2026-10-06T00:00:00Z',
  ...over,
})

describe('parseScript', () => {
  it('splits tagged lines into turns with styles, continuing untagged lines', () => {
    const turns = parseScript('DIALOG: @voice1: Dzień dobry!\nJak się masz?\n\n@voice2 (whispering): Cicho...\nplain line', 1)
    expect(turns).toEqual([
      { voice: 1, style: undefined, text: 'Dzień dobry! Jak się masz?' },
      { voice: 2, style: 'whispering', text: 'Cicho... plain line' },
    ])
  })

  it('accepts a label before the tag and does not speak it', () => {
    expect(parseScript('Pani z głosem: @voice1: cześć co słychać\nPan z głosem: @voice2: a dobrze dziękuję', 1)).toEqual([
      { voice: 1, style: undefined, text: 'cześć co słychać' },
      { voice: 2, style: undefined, text: 'a dobrze dziękuję' },
    ])
    expect(parseScript('ANNA @voice1 (cicho): hej', 2)).toEqual([{ voice: 1, style: 'cicho', text: 'hej' }])
    // a mention without a colon is just text
    expect(parseScript('Powiedz to głosem @voice2 proszę', 1)).toEqual([{ voice: 1, text: 'Powiedz to głosem @voice2 proszę' }])
  })

  it('uses the default voice before the first tag and after a blank line', () => {
    expect(parseScript('Hello there.\n\nBye.', 3)).toEqual([
      { voice: 3, text: 'Hello there.' },
      { voice: 3, text: 'Bye.' },
    ])
  })
})

describe('voices in video prompts', () => {
  const snaps = snapshotVoices([voice({}), voice({ name: 'Marek', description: 'deep calm male voice, 50s.' })])

  it('turns @voiceN into the description', () => {
    expect(describeVoiceTokens('pani @img1 mówi głosem @voice1 tekst: abc', snaps)).toBe(
      'pani @img1 mówi głosem (voice: warm woman in her 40s, slightly husky) tekst: abc',
    )
    expect(describeVoiceTokens('@voice2 says hi', snaps)).toBe('(voice: deep calm male voice, 50s) says hi')
    expect(voiceTokens('@voice2 and @voice1 and @voice2')).toEqual([2, 1])
  })

  it('then compiles the image tags for Omni', () => {
    const text = describeVoiceTokens('DIALOG: the woman @img1 says in @voice1: "abc"', snaps)
    expect(compileOmniPrompt(text, { hasFirst: false, hasLast: false, imageRefs: 1, videoRefs: 0 })).toContain(
      'the woman <IMAGE_REF_0> says in (voice: warm woman in her 40s, slightly husky): "abc"',
    )
  })

  it('flags voices the project does not have', () => {
    expect(unknownTokens('@voice1 @voice3', { hasFirst: false, hasLast: false, imageRefs: 0, videoRefs: 0, voices: 2 })).toEqual(['@voice3'])
  })
})

describe('speakingVoice', () => {
  it('uses the designed voice until the description changes, then the prebuilt fallback', () => {
    const designed = voice({ googleVoiceId: 'voice_1', designedFrom: 'warm woman in her 40s, slightly husky', prebuilt: 'Kore' })
    expect(speakingVoice(designed)).toBe('voice_1')
    expect(speakingVoice({ ...designed, description: 'changed' })).toBe('Kore')
    expect(speakingVoice(voice({}))).toBeUndefined()
  })
})

describe('speech cost', () => {
  it('estimates from the script length', () => {
    const secs = estimateSpeechSeconds('@voice1: ' + 'a'.repeat(150))
    expect(secs).toBeCloseTo(10)
    expect(estimateCost('gemini-3.8-flash-tts', { aspectRatio: '16:9', resolution: '720p', duration: 0, audio: true, count: 1, enhance: false }, secs)).toBeCloseTo(0.00225)
  })
})
