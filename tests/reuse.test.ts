import { describe, expect, it } from 'vitest'
import type { Generation } from '../shared/types'
import { renumber, reuseOf } from '../src/stores/composer'

const gen = (over: Partial<Generation>): Generation => ({
  id: 'g',
  batchId: 'b',
  createdAt: '',
  status: 'completed',
  kind: 'video',
  model: 'gemini-omni-1.1-flash',
  settings: { aspectRatio: '9:16', resolution: '360p', duration: 6, audio: true, count: 1, enhance: false },
  prompt: 'x',
  refs: { images: [], videos: [] },
  mode: 'create',
  provider: {},
  cost: { estimatedUsd: 0 },
  ...over,
})

const exists = (ids: string[]) => (id: string) => ids.includes(id)

describe('reuseOf', () => {
  it('keeps only references whose files still exist and reports the rest', () => {
    const r = reuseOf(gen({ refs: { firstFrame: 'f', lastFrame: 'l', images: ['a', 'gone'], videos: ['v'] } }), {
      assetExists: exists(['f', 'l', 'a']),
    })
    expect(r.refs).toEqual({ firstFrame: 'f', lastFrame: 'l', images: ['a'], videos: [] })
    expect(r.missing).toBe(2)
  })

  it('drops an end frame whose start frame is gone (it cannot be sent alone)', () => {
    const r = reuseOf(gen({ refs: { firstFrame: 'gone', lastFrame: 'l', images: [], videos: [] } }), { assetExists: exists(['l']) })
    expect(r.refs.firstFrame).toBeUndefined()
    expect(r.refs.lastFrame).toBeUndefined()
    expect(r.missing).toBe(2)
  })

  it('turns directives into overrides only where they differ from the current project', () => {
    const r = reuseOf(gen({ directives: { style: 'grainy', camera: 'handheld' } }), {
      assetExists: () => true,
      projectDefaults: { style: 'grainy', camera: 'tripod', negative: 'logos' },
    })
    // style same as project -> follows the project; camera differs -> override; negative was off -> ''
    expect(r.overrides).toEqual({ camera: 'handheld', negative: '' })
  })

  it('sets no overrides for edits, speech or generations made before directives existed', () => {
    const defaults = { style: 'grainy' }
    expect(reuseOf(gen({ mode: 'edit', directives: {} }), { assetExists: () => true, projectDefaults: defaults }).overrides).toEqual({})
    expect(reuseOf(gen({ kind: 'audio', directives: {} }), { assetExists: () => true, projectDefaults: defaults }).overrides).toEqual({})
    expect(reuseOf(gen({}), { assetExists: () => true, projectDefaults: defaults }).overrides).toEqual({})
  })

  it('speech: brings back the same library voices (any project), dropping deleted ones', () => {
    const g = gen({
      kind: 'audio',
      voices: [
        { id: 'v1', index: 1, name: 'Anna', description: '' },
        { id: 'gone', index: 2, name: 'Jan', description: '' },
      ],
    })
    const r = reuseOf(g, { assetExists: () => true, voiceExists: (id) => id === 'v1' })
    expect(r.speechVoices).toEqual(['v1'])
    expect(r.missing).toBe(1)
    // recordings from before voice ids existed fall back to the project's voices
    expect(reuseOf(gen({ kind: 'audio', voices: [{ index: 1, name: 'A', description: '' }] }), { assetExists: () => true }).speechVoices).toEqual([])
  })

  it('removing a script voice renumbers the @voice tags after it', () => {
    expect(renumber('@voice1: hi\n@voice2: yo\n@voice3: hey', 'voice', 1)).toBe('@voice1: hi\n: yo\n@voice2: hey')
  })
})
