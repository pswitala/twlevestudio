import { describe, expect, it } from 'vitest'
import { hasAllTags, normalizeTag, normalizeTags, tagCounts } from '../shared/tags'

describe('tags', () => {
  it('normalises: trim, lowercase, no #, single spaces, 30 chars', () => {
    expect(normalizeTag('  #Stajnia   Rolki ')).toBe('stajnia rolki')
    expect(normalizeTag('x'.repeat(40))).toHaveLength(30)
  })

  it('dedupes, drops junk and caps at 20', () => {
    expect(normalizeTags(['Koń', 'koń', '', 3, '#kowal'])).toEqual(['koń', 'kowal'])
    expect(normalizeTags(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20)
    expect(normalizeTags('nope')).toEqual([])
  })

  it('counts most used first and filters with AND', () => {
    const items = [{ tags: ['kon', 'stajnia'] }, { tags: ['kon'] }, {}]
    expect(tagCounts(items)).toEqual([
      ['kon', 2],
      ['stajnia', 1],
    ])
    expect(items.filter((i) => hasAllTags(i, ['kon', 'stajnia']))).toHaveLength(1)
    expect(items.filter((i) => hasAllTags(i, []))).toHaveLength(3)
  })
})
