/** Tags on library assets and generations: lowercase, trimmed, no '#', unique, max 20 x 30 chars. */
export function normalizeTag(t: string): string {
  return t.trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase().slice(0, 30)
}

export function normalizeTags(input: unknown): string[] {
  if (!Array.isArray(input)) return []
  const out: string[] = []
  for (const t of input) {
    if (typeof t !== 'string') continue
    const n = normalizeTag(t)
    if (n && !out.includes(n)) out.push(n)
  }
  return out.slice(0, 20)
}

/** All tags used by the items, most used first. */
export function tagCounts(items: { tags?: string[] }[]): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) for (const t of i.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Item has every tag in `filter` (AND). */
export function hasAllTags(item: { tags?: string[] }, filter: string[]): boolean {
  return filter.every((t) => item.tags?.includes(t))
}
