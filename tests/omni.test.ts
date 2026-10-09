import { describe, expect, it } from 'vitest'
import { costFromUsage, extractVideo } from '../server/providers/omni'

describe('extractVideo', () => {
  it('reads the raw REST steps shape', () => {
    const v = extractVideo({
      status: 'completed',
      steps: [
        { type: 'user_input', content: [{ type: 'text', text: 'x' }] },
        { type: 'thought', content: [{ type: 'thought', text: '...' }] },
        { type: 'model_output', content: [{ type: 'video', mime_type: 'video/mp4', data: 'AAAA' }] },
      ],
    })
    expect(v.data).toBe('AAAA')
  })

  it('prefers output_video and supports uri delivery', () => {
    expect(extractVideo({ output_video: { uri: 'https://x/v1beta/files/abc:download?alt=media' } }).uri).toContain('files/abc')
  })

  it('explains a missing video with the model text', () => {
    expect(() =>
      extractVideo({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'Cannot make that.' }] }] }),
    ).toThrow(/Cannot make that/)
    expect(() => extractVideo({ status: 'failed' })).toThrow(/Interaction failed/)
  })
})

describe('costFromUsage', () => {
  it('prices video tokens at the video rate', () => {
    const usd = costFromUsage({
      total_input_tokens: 1000,
      total_output_tokens: 57920,
      output_tokens_by_modality: [{ modality: 'video', tokens: 57920 }],
    })
    expect(usd).toBeCloseTo(0.0015 + 1.0136, 3)
  })

  it('returns undefined without usage', () => {
    expect(costFromUsage(undefined)).toBeUndefined()
  })
})
