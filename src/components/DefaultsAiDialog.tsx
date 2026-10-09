import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Loader2, RotateCw, Sparkles, X } from 'lucide-react'
import type { Directives } from '../../shared/directives'
import { api } from '../lib/api'
import { cn } from '../lib/utils'
import { useUi } from '../stores/ui'

type Key = 'style' | 'camera' | 'negative'
const FIELDS: { key: Key; label: string }[] = [
  { key: 'style', label: 'Style' },
  { key: 'camera', label: 'Camera' },
  { key: 'negative', label: 'Avoid' },
]

/**
 * AI proposal for a project's defaults: describe what you will film, pick the text model, Generate.
 * Empty fields are written fresh; filled ones are revised (current text + brief, each field on its own).
 * Picked proposals go back into the Defaults form - saving stays a separate step.
 */
export function DefaultsAiDialog({ current, onUse, onClose }: { current: Directives; onUse: (d: Directives) => void; onClose: () => void }) {
  const { refineModel, refineThinking, setRefine, notify } = useUi()
  const [brief, setBrief] = useState('')
  const [proposal, setProposal] = useState<Record<Key, string>>()
  const [use, setUse] = useState<Record<Key, boolean>>({ style: true, camera: true, negative: true })
  const models = useQuery({ queryKey: ['text-models'], queryFn: api.textModels, staleTime: 10 * 60 * 1000 })
  const hasCurrent = FIELDS.some((f) => current[f.key]?.trim())

  const run = useMutation({
    mutationFn: () => api.defaultsAi({ brief, current, model: refineModel, thinking: refineThinking }),
    onSuccess: (r) => {
      setProposal(r)
      // a field the model left unchanged is not worth "using"
      setUse({
        style: !!r.style && r.style !== current.style?.trim(),
        camera: !!r.camera && r.camera !== current.camera?.trim(),
        negative: !!r.negative && r.negative !== current.negative?.trim(),
      })
    },
    onError: (e) => notify((e as Error).message, 'error'),
  })

  const field = 'rounded-lg bg-white/[0.06] px-2 py-1.5 text-[12.5px] text-white/85 focus:outline-none'
  const picked = FIELDS.filter((f) => use[f.key] && proposal?.[f.key])

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-3xl border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-6">
        <header className="flex items-center gap-2">
          <Sparkles className="size-4 text-fuchsia-300" />
          <h2 className="text-[15px] font-medium">Generate defaults with AI</h2>
          <button type="button" onClick={onClose} className="ml-auto rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </header>
        <p className="-mt-1 text-[12.5px] text-white/50">
          {hasCurrent
            ? 'The current Style / Camera / Avoid are sent along - each is revised with your description, empty ones are written fresh.'
            : 'The fields are empty, so the model writes all three from your description.'}
        </p>

        <textarea
          autoFocus
          rows={4}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && brief.trim() && !run.isPending) run.mutate()
          }}
          placeholder="Co będziesz kręcić? np. Krótkie pionowe rolki z życia stajni nagrywane telefonem: naturalne światło, realistyczny styl jak od właściciela konia, bez reklamowego połysku, bez tekstu na ekranie."
          className="w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 text-[13.5px] leading-relaxed placeholder:text-white/30 focus:bg-white/[0.08] focus:outline-none"
        />

        <div className="flex flex-wrap items-center gap-2 text-[12px] text-white/50">
          <label className="flex items-center gap-1.5">
            Model
            <select value={refineModel} onChange={(e) => setRefine({ model: e.target.value })} className={field}>
              {(models.data?.models ?? [refineModel]).map((m) => (
                <option key={m} value={m} className="bg-neutral-900">{m}</option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-1.5">
            Thinking
            <select value={refineThinking} onChange={(e) => setRefine({ thinking: e.target.value })} className={field}>
              {(models.data?.thinking ?? ['minimal', 'low', 'medium', 'high']).map((t) => (
                <option key={t} value={t} className="bg-neutral-900">{t}</option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!brief.trim() || run.isPending}
            onClick={() => run.mutate()}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-fuchsia-300 px-4 py-1.5 text-[13px] font-medium text-black hover:bg-fuchsia-200 disabled:opacity-40"
            title="Ctrl+Enter"
          >
            {run.isPending ? <Loader2 className="size-3.5 animate-spin" /> : proposal ? <RotateCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
            {run.isPending ? 'Thinking…' : proposal ? 'Generate again' : 'Generate'}
          </button>
        </div>

        {proposal && (
          <div className="flex flex-col gap-3 border-t border-white/10 pt-3">
            {FIELDS.map(({ key, label }) => {
              const was = current[key]?.trim()
              return (
                <div key={key} className={cn('rounded-2xl p-3 transition', use[key] ? 'bg-fuchsia-500/[0.06] ring-1 ring-fuchsia-300/30' : 'bg-white/[0.03]')}>
                  <label className="mb-1.5 flex items-center gap-2 text-[12px] uppercase tracking-wide text-white/55">
                    <input type="checkbox" checked={use[key]} onChange={(e) => setUse({ ...use, [key]: e.target.checked })} />
                    {label}
                    {!was ? <span className="normal-case tracking-normal text-white/35">· new</span> : proposal[key] === was ? <span className="normal-case tracking-normal text-white/35">· unchanged</span> : null}
                  </label>
                  <div className={cn('grid gap-2', was && 'sm:grid-cols-2')}>
                    {was && (
                      <div>
                        <p className="mb-1 text-[11px] text-white/35">Current</p>
                        <p className="rounded-lg bg-black/30 px-2.5 py-2 text-[12.5px] leading-relaxed text-white/50">{was}</p>
                      </div>
                    )}
                    <div>
                      {was && <p className="mb-1 text-[11px] text-white/35">Proposed</p>}
                      <textarea
                        rows={key === 'negative' ? 4 : 3}
                        value={proposal[key]}
                        onChange={(e) => setProposal({ ...proposal, [key]: e.target.value })}
                        className="w-full resize-y rounded-lg bg-white/[0.06] px-2.5 py-2 text-[12.5px] leading-relaxed text-white/90 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>
              )
            })}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={onClose} className="rounded-full px-4 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
                Cancel
              </button>
              <button
                type="button"
                disabled={!picked.length}
                onClick={() => {
                  onUse(Object.fromEntries(picked.map((f) => [f.key, proposal[f.key]])))
                  onClose()
                }}
                className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-black disabled:opacity-40"
              >
                <Check className="size-3.5" /> Use selected ({picked.length})
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
