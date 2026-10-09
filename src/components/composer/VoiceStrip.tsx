import { useRef, useState } from 'react'
import { AudioLines, FolderOpen, Pause, Play, Plus, RotateCcw, Settings2, X } from 'lucide-react'
import { speakingVoice, type Voice } from '../../../shared/voices'
import { useProjects } from '../../hooks/queries'
import { fileUrl } from '../../lib/api'
import { cn } from '../../lib/utils'
import { useUi } from '../../stores/ui'

/**
 * Speech mode's top row: the voices of this script (@voice1.. in order), their samples and the default speaker.
 * Either the open project's voices, or - like image refs - voices picked from the library (any project).
 */
export function VoiceStrip({
  voices,
  explicit,
  defaultVoice,
  onDefault,
  onPick,
  onRemove,
  onUseProject,
}: {
  voices: Voice[]
  /** true = picked from the library; false = the open project's voices */
  explicit: boolean
  defaultVoice: number
  onDefault: (n: number) => void
  onPick: () => void
  onRemove: (id: string) => void
  onUseProject: () => void
}) {
  const openVoices = useUi((s) => s.openVoices)
  const projectId = useUi((s) => s.projectId)
  const { data: projects = [] } = useProjects()
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState<string>()

  function play(v: Voice) {
    const el = audio.current
    if (!el || !v.sampleFile) return
    if (playing === v.id) {
      el.pause()
      setPlaying(undefined)
      return
    }
    el.src = fileUrl('voices', v.sampleFile)!
    void el.play()
    setPlaying(v.id)
  }

  const chip = 'flex h-[60px] items-center gap-2 rounded-2xl border border-dashed border-white/15 px-4 text-[12.5px] text-white/60 hover:border-white/30 hover:text-white'

  return (
    <div className="flex flex-col gap-1 pb-1">
      <p className="px-1 text-[11px] text-white/35">
        {explicit ? 'Voices picked from the library' : 'Voices of this project'} · @voice1… in this order
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <audio ref={audio} onEnded={() => setPlaying(undefined)} hidden />
        {voices.map((v, i) => {
          const n = i + 1
          const ready = !!speakingVoice(v)
          const from = explicit && v.projectId !== (projectId || 'default') ? projects.find((p) => p.id === v.projectId)?.name : undefined
          return (
            <div
              key={v.id}
              className={cn(
                'group relative flex h-[60px] min-w-[150px] max-w-[230px] items-center gap-2 rounded-2xl px-3 text-left transition',
                defaultVoice === n ? 'bg-white/12 ring-1 ring-white/40' : 'bg-white/[0.06] hover:bg-white/10',
              )}
            >
              <button
                type="button"
                disabled={!v.sampleFile}
                onClick={() => play(v)}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 disabled:opacity-30"
                title={v.sampleFile ? 'Play sample' : 'No sample yet'}
              >
                {playing === v.id ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              </button>
              <button type="button" onClick={() => onDefault(n)} className="min-w-0 flex-1 text-left" title={`${v.description}\n\nClick: default voice for untagged lines`}>
                <span className="block truncate text-[12.5px] text-white/90">{v.name}</span>
                <span className="flex items-center gap-1 truncate font-mono text-[11px] text-white/45">
                  @voice{n}
                  {!ready && <span className="font-sans text-amber-300/90">· not designed</span>}
                  {defaultVoice === n && <span className="font-sans text-white/60">· default</span>}
                  {from && <span className="truncate font-sans text-white/35">· {from}</span>}
                </span>
              </button>
              {explicit && (
                <button
                  type="button"
                  onClick={() => onRemove(v.id)}
                  className="absolute -right-1.5 -top-1.5 rounded-full bg-neutral-800 p-0.5 text-white/60 opacity-0 shadow ring-1 ring-white/10 transition hover:text-white group-hover:opacity-100 pointer-coarse:opacity-100"
                  title="Remove from this script (@voice numbers after it shift down)"
                >
                  <X className="size-3" />
                </button>
              )}
            </div>
          )
        })}
        <button type="button" onClick={onPick} className={chip} title="Pick voices from any project">
          <FolderOpen className="size-4" /> {explicit ? 'Add from library' : 'Choose from library…'}
        </button>
        {explicit ? (
          <button type="button" onClick={onUseProject} className={chip} title="Use the open project's voices again">
            <RotateCcw className="size-4" /> Project voices
          </button>
        ) : (
          <button type="button" onClick={() => openVoices(projectId || 'default')} className={chip}>
            {voices.length ? <Settings2 className="size-4" /> : <Plus className="size-4" />}
            {voices.length ? 'Manage voices' : 'Create a voice'}
          </button>
        )}
        {!voices.length && !explicit && (
          <p className="flex items-center gap-1.5 text-[12px] text-white/40">
            <AudioLines className="size-3.5" /> Describe a voice once, then use it as @voice1 in scripts and video prompts.
          </p>
        )}
      </div>
    </div>
  )
}
