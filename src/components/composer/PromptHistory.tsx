import { useMemo, useState } from 'react'
import { History, Star, Trash2 } from 'lucide-react'
import { useGenerations, useInvalidate, usePrompts } from '../../hooks/queries'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useComposer } from '../../stores/composer'
import { Popover } from '../Popover'
import { confirmAction } from '../ConfirmDialog'

/** Saved (★) and recent prompts; clicking one puts it in the composer. */
export function PromptHistory() {
  const { data: gens } = useGenerations()
  const { data: saved } = usePrompts()
  const invalidate = useInvalidate()
  const setPrompt = useComposer((s) => s.setPrompt)
  const current = useComposer((s) => s.prompt)
  const [q, setQ] = useState('')

  const recent = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const g of gens ?? []) {
      const p = g.prompt.trim()
      if (p && !seen.has(p)) {
        seen.add(p)
        out.push(p)
      }
    }
    return out
  }, [gens])

  const savedTexts = new Set(saved?.map((p) => p.text))
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase())

  async function toggleSave(text: string) {
    const existing = saved?.find((p) => p.text === text)
    if (existing) await api.deletePrompt(existing.id)
    else await api.savePrompt(text)
    await invalidate('prompts')
  }

  const row = (text: string, close: () => void) => (
    <div key={text} className="group flex items-start gap-1 rounded-lg px-2 py-1.5 hover:bg-white/10">
      <button
        type="button"
        className="line-clamp-3 flex-1 text-left text-[12.5px] text-white/80"
        onClick={() => {
          setPrompt(text)
          close()
        }}
      >
        {text}
      </button>
      <button type="button" onClick={() => toggleSave(text)} title={savedTexts.has(text) ? 'Unsave' : 'Save prompt'} className="p-0.5">
        <Star className={cn('size-3.5', savedTexts.has(text) ? 'fill-amber-300 text-amber-300' : 'text-white/30 opacity-0 group-hover:opacity-100 pointer-coarse:opacity-100')} />
      </button>
    </div>
  )

  return (
    <Popover
      align="right"
      className="w-[440px] p-2"
      trigger={({ toggle }) => (
        <button type="button" onClick={toggle} title="Prompt history & saved prompts" className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
          <History className="size-4" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex max-h-[420px] flex-col">
          <div className="mb-1 flex items-center gap-1">
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search prompts…"
              className="flex-1 rounded-lg bg-white/5 px-2.5 py-1.5 text-[13px] placeholder:text-white/35 focus:outline-none"
            />
            {current.trim() && (
              <button
                type="button"
                onClick={() => toggleSave(current.trim())}
                className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[12px] text-white/70 hover:bg-white/10"
                title="Save the current prompt"
              >
                <Star className={cn('size-3.5', savedTexts.has(current.trim()) && 'fill-amber-300 text-amber-300')} /> Save current
              </button>
            )}
          </div>
          <div className="overflow-y-auto">
            {!!saved?.filter((p) => match(p.text)).length && (
              <>
                <p className="px-2 pt-1 text-[11px] uppercase tracking-wide text-white/35">Saved</p>
                {saved.filter((p) => match(p.text)).map((p) => (
                  <div key={p.id} className="group relative">
                    {row(p.text, close)}
                    <button
                      type="button"
                      onClick={async () => {
                        if (!(await confirmAction({ title: 'Delete this saved prompt?', message: p.text.slice(0, 160) }))) return
                        await api.deletePrompt(p.id)
                        await invalidate('prompts')
                      }}
                      className="absolute right-7 top-1.5 hidden p-0.5 text-white/30 hover:text-rose-300 group-hover:block pointer-coarse:block"
                      title="Delete"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </>
            )}
            <p className="px-2 pt-2 text-[11px] uppercase tracking-wide text-white/35">Recent</p>
            {recent.filter(match).slice(0, 60).map((t) => row(t, close))}
            {!recent.length && <p className="px-2 py-2 text-[12px] text-white/40">No prompts yet.</p>}
          </div>
        </div>
      )}
    </Popover>
  )
}
