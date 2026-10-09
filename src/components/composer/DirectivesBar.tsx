import { useState } from 'react'
import { Ban, Camera, Palette, RotateCcw, SlidersHorizontal } from 'lucide-react'
import {
  CAMERA_PRESETS,
  DIRECTIVE_KEYS,
  DIRECTIVE_LABEL,
  effectiveDirectives,
  type DirectiveKey,
} from '../../../shared/directives'
import type { MediaKind } from '../../../shared/models'
import { DEFAULT_PROJECT_ID } from '../../../shared/types'
import { useProjects } from '../../hooks/queries'
import { cn } from '../../lib/utils'
import { useComposer } from '../../stores/composer'
import { useUi } from '../../stores/ui'
import { Popover } from '../Popover'

const ICON: Record<DirectiveKey, typeof Palette> = { style: Palette, camera: Camera, negative: Ban }

/**
 * The open project's style / camera / negatives, as they will be sent with the next generation.
 * Each can follow the project, be overridden with own text, or be switched off - until "Reset".
 */
export function DirectivesBar({ kind, disabled }: { kind: MediaKind; disabled?: string }) {
  const { data: projects = [] } = useProjects()
  const projectId = useUi((s) => s.projectId) || DEFAULT_PROJECT_ID
  const openDefaults = useUi((s) => s.openDefaults)
  const { overrides, setOverride, resetOverrides } = useComposer()
  const project = projects.find((p) => p.id === projectId)
  const effective = effectiveDirectives(project?.defaults, overrides)
  const anyOverride = Object.keys(overrides).length > 0
  const anything = DIRECTIVE_KEYS.some((k) => effective[k] || project?.defaults?.[k])

  if (disabled) {
    return anything ? <p className="px-2 pb-1 text-[11.5px] text-white/35">{disabled}</p> : null
  }

  return (
    <div className="flex flex-wrap items-center gap-1 px-1 pb-1.5">
      {DIRECTIVE_KEYS.map((k) => (
        <DirectiveChip
          key={k}
          k={k}
          kind={kind}
          projectValue={project?.defaults?.[k]}
          value={effective[k]}
          override={overrides[k]}
          onChange={(v) => setOverride(k, v)}
        />
      ))}
      {anyOverride && (
        <button
          type="button"
          onClick={resetOverrides}
          title="Back to the project defaults"
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-white/45 hover:bg-white/10 hover:text-white"
        >
          <RotateCcw className="size-3" /> Reset
        </button>
      )}
      <button
        type="button"
        onClick={() => openDefaults(projectId)}
        title={`Edit the defaults of ${project?.name ?? 'this project'}`}
        className="ml-auto flex h-6 items-center gap-1 rounded-md px-1.5 text-[11.5px] text-white/40 hover:bg-white/10 hover:text-white"
      >
        <SlidersHorizontal className="size-3" /> {project?.name ?? 'Project'} defaults
      </button>
    </div>
  )
}

function DirectiveChip({
  k,
  kind,
  projectValue,
  value,
  override,
  onChange,
}: {
  k: DirectiveKey
  kind: MediaKind
  projectValue?: string
  value?: string
  /** undefined = following the project, '' = off, text = own */
  override?: string
  onChange: (v: string | undefined) => void
}) {
  const Icon = ICON[k]
  const [draft, setDraft] = useState('')
  const state = override === undefined ? 'project' : override === '' ? 'off' : 'custom'
  const label = k === 'camera' && kind === 'image' ? 'Framing' : DIRECTIVE_LABEL[k]

  return (
    <Popover
      className="w-[380px] p-3"
      trigger={({ toggle }) => (
        <button
          type="button"
          onClick={() => {
            setDraft(override || projectValue || '')
            toggle()
          }}
          title={value ? `${label}: ${value}` : `${label}: none`}
          className={cn(
            'flex h-6 max-w-[240px] items-center gap-1.5 rounded-md px-2 text-[11.5px] transition',
            value ? 'bg-white/[0.07] text-white/75 hover:bg-white/12' : 'text-white/35 hover:bg-white/[0.06] hover:text-white/60',
            state !== 'project' && 'ring-1 ring-amber-300/50',
          )}
        >
          <Icon className="size-3 shrink-0" />
          <span className="shrink-0">{label}</span>
          {value ? <span className="truncate text-white/50">{value}</span> : <span>{state === 'off' ? 'off' : '—'}</span>}
        </button>
      )}
    >
      {(close) => (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] uppercase tracking-wide text-white/40">{label} for the next generations</p>
          <div className="flex gap-1 rounded-lg bg-white/[0.05] p-0.5 text-[12px]">
            {(
              [
                ['project', 'Project default'],
                ['custom', 'Override'],
                ['off', 'Off'],
              ] as const
            ).map(([s, text]) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  if (s === 'project') onChange(undefined)
                  if (s === 'off') onChange('')
                  if (s === 'custom') onChange(draft.trim() || projectValue || ' ')
                }}
                className={cn('flex-1 rounded-md py-1', state === s ? 'bg-white/15 text-white' : 'text-white/55 hover:text-white')}
              >
                {text}
              </button>
            ))}
          </div>

          {state === 'project' && (
            <p className="rounded-lg bg-black/30 p-2 text-[12.5px] text-white/70">
              {projectValue || <span className="text-white/35">The project has no {label.toLowerCase()} default.</span>}
            </p>
          )}

          {state === 'custom' && (
            <>
              {k === 'camera' && (
                <div className="flex flex-wrap gap-1">
                  {CAMERA_PRESETS.map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        setDraft(p.text)
                        onChange(p.text)
                      }}
                      className={cn('rounded-full px-2 py-0.5 text-[11.5px]', override === p.text ? 'bg-white text-black' : 'bg-white/[0.06] text-white/70 hover:bg-white/12')}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              )}
              <textarea
                autoFocus
                rows={3}
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value)
                  onChange(e.target.value.trim() ? e.target.value : ' ')
                }}
                placeholder={`Your ${label.toLowerCase()} for the next generations`}
                className="w-full resize-y rounded-lg bg-white/[0.05] px-2.5 py-2 text-[13px] placeholder:text-white/30 focus:outline-none"
              />
            </>
          )}

          {state === 'off' && <p className="text-[12.5px] text-white/50">Nothing is added for {label.toLowerCase()}.</p>}

          <button type="button" onClick={close} className="self-end rounded-full bg-white px-3 py-1 text-[12px] font-medium text-black">
            Done
          </button>
        </div>
      )}
    </Popover>
  )
}
