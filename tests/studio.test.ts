import { describe, expect, it } from 'vitest'
import {
  audibleClipsAt,
  clipEnd,
  clipFor,
  freeStart,
  layerLookAt,
  layerPlan,
  nextTrackName,
  setTransition,
  newEdit,
  normalizeEdit,
  overlaps,
  snap,
  splitClip,
  timelineEnd,
  trimClip,
  visibleClipAt,
  type Clip,
  type Edit,
  type SourceInfo,
} from '../shared/studio'
import { buildRender, type ResolvedSource } from '../server/studio'

const VIDEO: SourceInfo = { media: 'video', duration: 8, hasAudio: true }
const IMAGE: SourceInfo = { media: 'image', hasAudio: false }
const clip = (over: Partial<Clip>): Clip => ({
  id: 'c',
  trackId: 'v1',
  source: { type: 'generation', id: 'g' },
  start: 0,
  in: 0,
  out: 4,
  volume: 1,
  ...over,
})
const edit = (clips: Clip[]): Edit => ({ ...newEdit('e', 'p', 'Test', 'now'), clips })

describe('studio timeline', () => {
  it('a dropped source becomes a clip of its whole length; a photo gets 3 s', () => {
    expect(clipFor('a', 'v1', { type: 'generation', id: 'g' }, VIDEO, 2)).toMatchObject({ start: 2, in: 0, out: 8, useAudio: true })
    expect(clipFor('b', 'v1', { type: 'asset', id: 'i' }, IMAGE, -1)).toMatchObject({ start: 0, out: 3, useAudio: false })
  })

  it('splits at the playhead into two clips that continue the same source', () => {
    const [l, r] = splitClip(clip({ start: 10, in: 1, out: 7 }), 12, 'n')!
    expect(l).toMatchObject({ start: 10, in: 1, out: 3 })
    expect(r).toMatchObject({ id: 'n', start: 12, in: 3, out: 7 })
    expect(clipEnd(r)).toBe(16)
    expect(splitClip(clip({}), 0, 'n')).toBeUndefined()
  })

  it('trims within the source and never below the minimum length', () => {
    const c = clip({ start: 5, in: 1, out: 5 })
    expect(trimClip(c, 'end', 20, 8).out).toBe(8) // source is 8 s long
    expect(trimClip(c, 'end', 4, 8).out).toBeCloseTo(1.1)
    expect(trimClip(c, 'start', 2, 8)).toMatchObject({ start: 4, in: 0 }) // cannot go before the source start
    expect(trimClip(c, 'start', 6, 8)).toMatchObject({ start: 6, in: 2, out: 5 })
    // a photo has no length limit
    expect(trimClip(clip({ out: 3 }), 'end', 30).out).toBe(30)
  })

  it('detects overlaps on the same track only and snaps to nearby edges', () => {
    const clips = [clip({ id: 'a', start: 0, out: 4 }), clip({ id: 'b', trackId: 'v2', start: 0, out: 4 })]
    expect(overlaps(clips, { id: 'x', trackId: 'v1', start: 3, in: 0, out: 2 })).toBe(true)
    expect(overlaps(clips, { id: 'x', trackId: 'v1', start: 4, in: 0, out: 2 })).toBe(false) // touching is fine
    expect(snap(4.08, [0, 4, 10], 0.1)).toBe(4)
    expect(snap(4.5, [0, 4, 10], 0.1)).toBe(4.5)
  })

  it('the top video track wins; sound comes from audio tracks and video clips with audio on', () => {
    const e = edit([
      clip({ id: 'low', trackId: 'v1', start: 0, out: 10 }),
      clip({ id: 'top', trackId: 'v2', start: 2, out: 2, useAudio: false }),
      clip({ id: 'music', trackId: 'a1', start: 0, out: 30 }),
    ])
    expect(visibleClipAt(e, 1)?.id).toBe('low')
    expect(visibleClipAt(e, 3)?.id).toBe('top')
    expect(visibleClipAt({ ...e, tracks: e.tracks.map((t) => (t.id === 'v2' ? { ...t, muted: true } : t)) }, 3)?.id).toBe('low')
    expect(audibleClipsAt(e, 3, () => VIDEO).map((c) => c.id)).toEqual(['low', 'music'])
    expect(timelineEnd(e)).toBe(30)
  })

  it('a drop onto a taken spot moves right to the first gap that fits', () => {
    const clips = [clip({ id: 'a', start: 0, out: 4 }), clip({ id: 'b', start: 5, out: 4 })]
    expect(freeStart(clips, 'v1', 1, 2)).toBe(9) // 4..5 is too short for 2 s
    expect(freeStart(clips, 'v1', 1, 1)).toBe(4)
    expect(freeStart(clips, 'v2', 1, 2)).toBe(1)
    expect(nextTrackName(newEdit('e', 'p', 'x').tracks, 'video')).toBe('V3')
  })

  it('normalizeEdit drops clips on unknown tracks and keeps ids from the stored edit', () => {
    const base = edit([])
    const n = normalizeEdit(
      { id: 'hack', projectId: 'other', name: '  New name ', aspect: '4:3' as never, clips: [clip({ trackId: 'nope' }), clip({ id: 'ok', volume: 9 })] },
      base,
    )
    expect(n).toMatchObject({ id: 'e', projectId: 'p', name: 'New name', aspect: '9:16' })
    expect(n.clips.map((c) => [c.id, c.volume])).toEqual([['ok', 2]])
  })
})

describe('studio render command', () => {
  const files: Record<string, ResolvedSource> = {
    vid: { file: 'v.mp4', label: 'v', media: 'video', duration: 8, hasAudio: true },
    pic: { file: 'p.png', label: 'p', media: 'image', hasAudio: false },
    song: { file: 's.mp3', label: 's', media: 'audio', duration: 60, hasAudio: true },
  }
  const resolve = (c: Clip) => files[c.source.id]

  it('overlays bottom track first, delays sounds to their place and mixes over a silent bed', () => {
    const e = edit([
      clip({ id: '1', trackId: 'v1', source: { type: 'generation', id: 'vid' }, start: 0, in: 2, out: 6 }),
      clip({ id: '2', trackId: 'v2', source: { type: 'asset', id: 'pic' }, start: 1, in: 0, out: 2 }),
      clip({ id: '3', trackId: 'a1', source: { type: 'media', id: 'song' }, start: 0.5, in: 10, out: 15, volume: 0.5 }),
    ])
    const r = buildRender(e, resolve)
    expect(r.total).toBe(5.5)
    expect(r.size).toEqual({ w: 1080, h: 1920 })
    // V1 video (input 2) is overlaid before V2 photo (input 3)
    expect(r.args.join(' ')).toContain('-ss 2 -t 4 -i v.mp4 -loop 1 -framerate 24 -t 2 -i p.png -ss 10 -t 5 -i s.mp3')
    const first = r.filter.indexOf('[base][v2]overlay')
    expect(first).toBeGreaterThan(-1)
    expect(first).toBeLessThan(r.filter.indexOf('[o2][v3]overlay'))
    expect(r.filter).toContain('setpts=PTS-STARTPTS+1/TB[v3]')
    expect(r.filter).toContain('volume=0.5,adelay=500|500')
    expect(r.filter).toContain('amix=inputs=3:duration=first:normalize=0')
  })

  it('refuses an empty timeline and clips whose source is gone', () => {
    expect(() => buildRender(edit([]), resolve)).toThrow(/empty/)
    expect(() => buildRender(edit([clip({ source: { type: 'generation', id: 'gone' } })]), resolve)).toThrow(/deleted/)
  })
})

describe('studio transitions', () => {
  const a = clip({ id: 'a', start: 0, in: 1, out: 5 })
  const b = clip({ id: 'b', start: 4, in: 0, out: 4 })

  it('on the later clip START: dissolves after the cut, the earlier clip runs on under it', () => {
    const p = layerPlan(edit([a, { ...b, transitionIn: { type: 'cross', duration: 1 } }]))
    expect(p.get('a')).toMatchObject({ post: 1, start: 0, end: 5 })
    expect(p.get('b')).toMatchObject({ pre: 0, ramps: [{ from: 4, to: 5, dir: 'in', type: 'cross' }] })
  })

  it('on the earlier clip END: dissolves before the cut, the later clip starts early', () => {
    const p = layerPlan(edit([{ ...a, transitionOut: { type: 'blur', duration: 1 } }, b]))
    expect(p.get('b')).toMatchObject({ pre: 1, start: 3, ramps: [{ from: 3, to: 4, dir: 'in', type: 'blur' }] })
    // the outgoing clip blurs too
    expect(p.get('a')!.blurs).toEqual([{ from: 3, to: 4, dir: 'out' }])
  })

  it('at a free edge the clip fades from / to what is under it, and so does its sound', () => {
    const p = layerPlan(edit([{ ...b, transitionIn: { type: 'additive', duration: 0.5 }, transitionOut: { type: 'cross', duration: 9 } }]))
    const l = p.get('b')!
    expect(l.ramps).toEqual([
      { from: 4, to: 4.5, dir: 'in', type: 'additive' },
      { from: 4, to: 8, dir: 'out', type: 'cross' }, // capped at the clip length
    ])
    expect([l.audioIn, l.audioOut]).toEqual([0.5, 4])
    // additive: full strength by the middle of its ramp (a separate clip, so the long fade-out does not overlap)
    const solo = layerPlan(edit([{ ...b, transitionIn: { type: 'additive', duration: 0.5 } }])).get('b')!
    expect(layerLookAt(solo, 4.25)).toMatchObject({ additive: true, opacity: 1 })
    expect(layerLookAt(solo, 4.1).opacity).toBeCloseTo(0.4)
  })

  it('one transition per cut: setting one side clears the other; split keeps each edge with its half', () => {
    const clips = setTransition([{ ...a, transitionOut: { type: 'cross', duration: 1 } }, b], 'b', 'in', { type: 'blur', duration: 2 })
    expect(clips[0].transitionOut).toBeUndefined()
    expect(clips[1].transitionIn).toEqual({ type: 'blur', duration: 2 })
    const [l, r] = splitClip({ ...b, transitionIn: { type: 'cross', duration: 1 }, transitionOut: { type: 'cross', duration: 1 } }, 6, 'n')!
    expect([!!l.transitionIn, !!l.transitionOut, !!r.transitionIn, !!r.transitionOut]).toEqual([true, false, false, true])
  })

  it('renders handles, alpha fades, blur mixes and additive blends', () => {
    const files: Record<string, ResolvedSource> = { g: { file: 'v.mp4', label: 'v', media: 'video', duration: 6, hasAudio: true } }
    const r = buildRender(
      edit([{ ...a, transitionOut: { type: 'cross', duration: 1 } }, { ...b, in: 0.5, transitionOut: { type: 'additive', duration: 1 } }]),
      (c) => files[c.source.id],
    )
    // b starts 1 s early but has only 0.5 s of source before its in-point: 0.5 s frozen
    expect(r.args.join(' ')).toContain('-ss 0 -t 4 -i v.mp4')
    expect(r.filter).toContain('tpad=start_duration=0.5:start_mode=clone')
    expect(r.filter).toContain('fade=t=in:st=3:d=1:alpha=1')
    expect(r.filter).toMatch(/blend=all_expr='min\(255,A\*min.*enable='between\(t,6.5,7.5\)'/)
    // the sound keeps to the clip, not to its handles
    expect(r.filter).toContain('atrim=start=0.5:duration=3.5')
  })
})
