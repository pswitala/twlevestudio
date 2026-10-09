import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Loader2, RotateCw, Sparkles } from 'lucide-react'
import type { Directives } from '../../../shared/directives'
import { api } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useUi } from '../../stores/ui'
import { Popover } from '../Popover'

/**
 * AI prompt doctor: describe what went wrong in the result ("she should put the phone fully into her pocket"),
 * a Gemini text model rewrites the whole prompt with precise directions, you review and replace.
 */
export function RefinePrompt({
  prompt,
  targetModel,
  directives,
  onReplace,
}: {
  prompt: string
  targetModel: string
  directives: Directives
  /** replace the composer prompt (the caller offers Undo) */
  onReplace: (next: string) => void
}) {
  const { refineModel, refineThinking, setRefine, notify } = useUi()
  const [problem, setProblem] = useState('')
  const [result, setResult] = useState<string>()
  const models = useQuery({ queryKey: ['text-models'], queryFn: api.textModels, staleTime: 10 * 60 * 1000 })

  const run = useMutation({
    mutationFn: () => api.refine({ targetModel, prompt, problem, directives, model: refineModel, thinking: refineThinking }),
    onSuccess: (r) => setResult(r.prompt),
    onError: (e) => notify((e as Error).message, 'error'),
  })

  const field = 'rounded-lg bg-white/[0.06] px-2 py-1.5 text-[12.5px] text-white/85 focus:outline-none'

  return (
    <Popover
      align="right"
      side="top"
      className="w-[520px] p-3"
      trigger={({ toggle, open }) => (
        <button
          type="button"
          onClick={toggle}
          title="AI: fix the prompt - describe what went wrong in the result"
          className={cn('rounded-lg p-1.5 hover:bg-white/10 hover:text-fuchsia-200', open ? 'bg-white/10 text-fuchsia-200' : 'text-fuchsia-300/70')}
        >
          <Sparkles className="size-4" />
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2.5">
          <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-white/40">
            <Sparkles className="size-3.5 text-fuchsia-300" /> Fix the prompt with AI
          </p>
          <textarea
            autoFocus
            rows={3}
            value={problem}
            onChange={(e) => setProblem(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && problem.trim() && !run.isPending) run.mutate()
            }}
            placeholder="Co poprawić? np. Dziewczyna ma dokładnie wkładać telefon do prawej przedniej kieszeni i go z niej wyciągać - teraz telefon znika w dziwny sposób."
            className="w-full resize-y rounded-lg bg-white/[0.05] px-2.5 py-2 text-[13px] leading-relaxed placeholder:text-white/30 focus:bg-white/[0.08] focus:outline-none"
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
              disabled={!problem.trim() || run.isPending}
              onClick={() => run.mutate()}
              className="ml-auto flex items-center gap-1.5 rounded-full bg-fuchsia-300 px-3.5 py-1.5 text-[12.5px] font-medium text-black hover:bg-fuchsia-200 disabled:opacity-40"
              title="Ctrl+Enter"
            >
              {run.isPending ? <Loader2 className="size-3.5 animate-spin" /> : result ? <RotateCw className="size-3.5" /> : <Sparkles className="size-3.5" />}
              {run.isPending ? 'Thinking…' : result ? 'Try again' : 'Improve prompt'}
            </button>
          </div>

          {result && (
            <>
              <p className="text-[11px] uppercase tracking-wide text-white/40">Proposed prompt</p>
              <textarea
                value={result}
                onChange={(e) => setResult(e.target.value)}
                rows={10}
                className="max-h-[45vh] w-full resize-y rounded-lg bg-black/40 px-2.5 py-2 font-mono text-[12px] leading-relaxed text-white/85 focus:outline-none"
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setResult(undefined)} className="rounded-full px-3 py-1.5 text-[12.5px] text-white/60 hover:bg-white/10">
                  Discard
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onReplace(result)
                    setResult(undefined)
                    setProblem('')
                    close()
                  }}
                  className="flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-black"
                >
                  <Check className="size-3.5" /> Replace prompt
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Popover>
  )
}
