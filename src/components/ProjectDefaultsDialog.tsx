import { useEffect, useState } from 'react'
import { SlidersHorizontal, Sparkles, X } from 'lucide-react'
import { DefaultsAiDialog } from './DefaultsAiDialog'
import { CAMERA_PRESETS, type Directives } from '../../shared/directives'
import { useInvalidate, useProjects } from '../hooks/queries'
import { api } from '../lib/api'
import { cn, useEscape } from '../lib/utils'
import { useUi } from '../stores/ui'

/** Project defaults: style, camera and negatives added to every generation in the project. */
export function ProjectDefaultsDialog() {
  const { defaultsFor, openDefaults, notify } = useUi()
  const { data: projects = [] } = useProjects()
  const invalidate = useInvalidate()
  const project = projects.find((p) => p.id === defaultsFor)
  const [d, setD] = useState<Directives>({})
  const [saving, setSaving] = useState(false)
  const [ai, setAi] = useState(false)

  useEffect(() => setD(project?.defaults ?? {}), [project?.id, project?.defaults])
  // Esc closes the AI window first, the defaults only when it is not open
  useEscape(!!project && !ai, () => openDefaults(undefined))
  useEscape(ai, () => setAi(false))

  if (!project) return null
  const close = () => openDefaults(undefined)

  async function save() {
    setSaving(true)
    try {
      await api.updateProjectDefaults(project!.id, d)
      await invalidate('projects')
      notify(`Defaults saved for ${project!.name}`)
      close()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setSaving(false)
    }
  }

  const field = 'w-full resize-y rounded-xl bg-white/[0.05] px-3 py-2 text-[13.5px] leading-relaxed placeholder:text-white/30 focus:bg-white/[0.08] focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-full w-full max-w-2xl flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-6">
        <header className="flex items-center gap-2">
          <SlidersHorizontal className="size-4 text-fuchsia-300" />
          <h2 className="text-[15px] font-medium">Defaults · {project.name}</h2>
          <button
            type="button"
            onClick={() => setAi(true)}
            className="ml-auto flex items-center gap-1.5 rounded-full bg-fuchsia-300/15 px-3 py-1 text-[12.5px] text-fuchsia-100 hover:bg-fuchsia-300/25"
            title="Generate Style / Camera / Avoid from a description of what you will film"
          >
            <Sparkles className="size-3.5" /> AI
          </button>
          <button type="button" onClick={close} className="rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </header>
        <p className="-mt-2 text-[12.5px] text-white/50">
          Added to every video and photo in this project, after Enhance. Override or switch any of them off per generation in the composer.
          Write them in English - the models are tuned for it.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] uppercase tracking-wide text-white/45">Style</span>
          <textarea
            rows={3}
            value={d.style ?? ''}
            onChange={(e) => setD({ ...d, style: e.target.value })}
            placeholder="e.g. documentary realism, natural daylight, muted earthy colours, 35mm film grain"
            className={field}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-[12px] uppercase tracking-wide text-white/45">Camera</span>
          <div className="flex flex-wrap gap-1">
            {CAMERA_PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => setD({ ...d, camera: p.text })}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[12px] transition',
                  d.camera === p.text ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/12',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <textarea
            rows={2}
            value={d.camera ?? ''}
            onChange={(e) => setD({ ...d, camera: e.target.value })}
            placeholder="pick a preset or describe it, e.g. handheld, medium shot, slight push-in"
            className={field}
          />
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] uppercase tracking-wide text-white/45">Avoid / keep (negative)</span>
          <textarea
            rows={3}
            value={d.negative ?? ''}
            onChange={(e) => setD({ ...d, negative: e.target.value })}
            placeholder="e.g. on-screen text, logos, scene cuts, background music, cartoonish look, extra fingers"
            className={field}
          />
          <span className="text-[11.5px] text-white/35">
            Sent as the last section of the prompt (NEGATIVE: …); Veo also gets it as its negativePrompt where allowed. Keep it to
            short phrases - words like blood or wounds can trip Google's input filter even here.
          </span>
        </label>

        <footer className="flex justify-end gap-2">
          <button type="button" onClick={() => setD({})} className="mr-auto rounded-full px-3 py-1.5 text-[13px] text-white/50 hover:bg-white/10">
            Clear all
          </button>
          <button type="button" onClick={close} className="rounded-full px-4 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button type="button" disabled={saving} onClick={save} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-black disabled:opacity-50">
            Save defaults
          </button>
        </footer>
      </div>
      {ai && <DefaultsAiDialog current={d} onUse={(next) => setD({ ...d, ...next })} onClose={() => setAi(false)} />}
    </div>
  )
}
