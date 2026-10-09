import { useState } from 'react'
import { AlertTriangle, AudioLines, Loader2, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { TTS_MODELS } from '../../shared/models'
import { speakingVoice, type Voice } from '../../shared/voices'
import { useInvalidate, useProjects, useVoices } from '../hooks/queries'
import { api, fileUrl } from '../lib/api'
import { cn, useEscape } from '../lib/utils'
import { useUi } from '../stores/ui'
import { confirmAction } from './ConfirmDialog'

type Draft = Pick<Voice, 'name' | 'description' | 'language' | 'gender' | 'model' | 'prebuilt'>

const EMPTY: Draft = { name: '', description: '', language: 'pl-PL', gender: undefined, model: TTS_MODELS[0].id, prebuilt: undefined }

/**
 * A project's voices: @voice1, @voice2... in creation order. A description is turned into a real
 * Gemini voice by Voice design (free of separate charge, 1-year retention); a prebuilt voice is the fallback.
 */
export function VoicesDialog() {
  const { voicesFor, openVoices, notify } = useUi()
  const { data: projects = [] } = useProjects()
  const { data, project: voices } = useVoices(voicesFor)
  const invalidate = useInvalidate()
  const [editing, setEditing] = useState<string | 'new'>()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [busy, setBusy] = useState<string>()

  const project = projects.find((p) => p.id === voicesFor)
  useEscape(!!project, () => openVoices(undefined))
  if (!project) return null

  const close = () => {
    setEditing(undefined)
    openVoices(undefined)
  }

  async function act(id: string, fn: () => Promise<unknown>, ok?: string) {
    setBusy(id)
    try {
      await fn()
      await invalidate('voices')
      if (ok) notify(ok)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(undefined)
    }
  }

  const save = () =>
    act(
      editing ?? 'new',
      async () => {
        const body = { ...draft, gender: draft.gender ?? ('' as never), prebuilt: draft.prebuilt ?? '' }
        const v = editing === 'new' ? await api.createVoice({ ...body, projectId: project.id }) : await api.patchVoice(editing!, body)
        if (v.error) notify(`Voice design failed: ${v.error}`, 'error')
        setEditing(undefined)
      },
      editing === 'new' ? 'Voice created' : 'Saved',
    )

  const field = 'w-full rounded-xl bg-white/[0.05] px-3 py-2 text-[13.5px] placeholder:text-white/30 focus:bg-white/[0.08] focus:outline-none'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-full w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-3xl border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-6">
        <header className="flex items-center gap-2">
          <AudioLines className="size-4 text-fuchsia-300" />
          <h2 className="text-[15px] font-medium">Voices · {project.name}</h2>
          <button type="button" onClick={close} className="ml-auto rounded-full p-1 hover:bg-white/10">
            <X className="size-4" />
          </button>
        </header>
        <p className="-mt-2 text-[12.5px] leading-relaxed text-white/50">
          Use them as <span className="font-mono text-white/75">@voice1</span>, <span className="font-mono text-white/75">@voice2</span>… (creation order).
          In <b className="text-white/70">Speech</b> they speak the script; in <b className="text-white/70">Video</b> prompts the token becomes the
          voice description, because Omni and Veo accept no audio references. Deleting a voice renumbers the ones after it.
        </p>

        <div className="flex flex-col gap-2">
          {voices.map((v, i) => {
            const speaks = speakingVoice(v)
            const stale = !!v.googleVoiceId && v.designedFrom !== v.description
            return editing === v.id ? (
              <VoiceForm key={v.id} draft={draft} setDraft={setDraft} prebuilt={data?.prebuilt ?? []} languages={data?.languages ?? []} field={field} onSave={save} onCancel={() => setEditing(undefined)} busy={busy === v.id} />
            ) : (
              <div key={v.id} className="flex items-start gap-3 rounded-2xl bg-white/[0.04] p-3">
                <span className="mt-0.5 rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[12px]">@voice{i + 1}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-medium">
                    {v.name}
                    <span className="ml-2 text-[11.5px] font-normal text-white/40">
                      {v.language}
                      {v.gender ? ` · ${v.gender}` : ''} · {TTS_MODELS.find((m) => m.id === v.model)?.label}
                    </span>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-white/65">{v.description || <i className="text-white/35">no description</i>}</p>
                  <p className={cn('mt-1 text-[11.5px]', speaks ? 'text-emerald-300/80' : 'text-amber-300/90')}>
                    {v.googleVoiceId && !stale
                      ? 'Designed voice ready'
                      : v.prebuilt
                        ? `Speaks with prebuilt ${v.prebuilt}${stale ? ' (description changed - re-design to use it)' : ''}`
                        : stale
                          ? 'Description changed - re-design to hear it'
                          : 'Not designed - Speech cannot use it yet (video prompts can)'}
                  </p>
                  {v.error && (
                    <p className="mt-1 flex items-start gap-1 text-[11.5px] text-rose-300">
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" /> {v.error}
                    </p>
                  )}
                  {v.sampleFile && !stale && <audio controls src={fileUrl('voices', v.sampleFile)} className="mt-2 h-8 w-full max-w-sm" />}
                </div>
                <div className="flex shrink-0 flex-col gap-1">
                  <button
                    type="button"
                    disabled={!!busy || !v.description}
                    onClick={() => act(v.id, () => api.designVoice(v.id), 'Voice designed')}
                    className="flex items-center gap-1.5 rounded-lg bg-white/[0.07] px-2.5 py-1.5 text-[12px] hover:bg-white/12 disabled:opacity-40"
                    title="Create the Gemini voice from the description (Voice design)"
                  >
                    {busy === v.id ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />}
                    {v.googleVoiceId ? 'Re-design' : 'Design'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft({ name: v.name, description: v.description, language: v.language, gender: v.gender, model: v.model, prebuilt: v.prebuilt })
                      setEditing(v.id)
                    }}
                    className="rounded-lg px-2.5 py-1.5 text-[12px] text-white/70 hover:bg-white/10"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={async () =>
                      (await confirmAction({
                        title: `Delete voice "${v.name}"?`,
                        message: `@voice numbers after it shift down by one. The designed voice is removed from Google too.`,
                      })) && act(v.id, () => api.deleteVoice(v.id))
                    }
                    className="flex items-center justify-center rounded-lg px-2.5 py-1.5 text-white/50 hover:bg-rose-500/30 hover:text-white"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            )
          })}
          {!voices.length && editing !== 'new' && <p className="py-4 text-center text-[13px] text-white/40">No voices in this project yet.</p>}
          {editing === 'new' ? (
            <VoiceForm draft={draft} setDraft={setDraft} prebuilt={data?.prebuilt ?? []} languages={data?.languages ?? []} field={field} onSave={save} onCancel={() => setEditing(undefined)} busy={busy === 'new'} isNew />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft({ ...EMPTY, name: `Voice ${voices.length + 1}` })
                setEditing('new')
              }}
              className="flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-white/15 py-3 text-[13px] text-white/60 hover:border-white/30 hover:text-white"
            >
              <Plus className="size-4" /> New voice
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function VoiceForm({
  draft,
  setDraft,
  prebuilt,
  languages,
  field,
  onSave,
  onCancel,
  busy,
  isNew,
}: {
  draft: Draft
  setDraft: (d: Draft) => void
  prebuilt: { name: string; note: string }[]
  languages: { code: string; label: string }[]
  field: string
  onSave: () => void
  onCancel: () => void
  busy: boolean
  isNew?: boolean
}) {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl bg-white/[0.06] p-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Name, e.g. Anna (rider)" className={field} />
        <select value={draft.language} onChange={(e) => setDraft({ ...draft, language: e.target.value })} className={field}>
          {languages.map((l) => (
            <option key={l.code} value={l.code} className="bg-neutral-900">{l.label}</option>
          ))}
        </select>
        <select value={draft.gender ?? ''} onChange={(e) => setDraft({ ...draft, gender: (e.target.value || undefined) as Draft['gender'] })} className={field}>
          <option value="" className="bg-neutral-900">gender: any</option>
          <option value="female" className="bg-neutral-900">female</option>
          <option value="male" className="bg-neutral-900">male</option>
        </select>
      </div>
      <textarea
        rows={3}
        value={draft.description}
        onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        placeholder="1-2 sentences: age, timbre, texture, accent, baseline delivery. e.g. A warm, calm woman in her 40s with a slightly husky voice, speaking unhurried Polish with a gentle smile."
        className={field}
      />
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-[11.5px] text-white/45">
          TTS model
          <select value={draft.model} onChange={(e) => setDraft({ ...draft, model: e.target.value })} className={field}>
            {TTS_MODELS.map((m) => (
              <option key={m.id} value={m.id} className="bg-neutral-900">{m.label}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[11.5px] text-white/45">
          Prebuilt fallback (optional)
          <select value={draft.prebuilt ?? ''} onChange={(e) => setDraft({ ...draft, prebuilt: e.target.value || undefined })} className={field}>
            <option value="" className="bg-neutral-900">none</option>
            {prebuilt.map((p) => (
              <option key={p.name} value={p.name} className="bg-neutral-900">{p.name} - {p.note}</option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-[11.5px] text-white/40">
        Write the description in English for the most control; the voice still speaks the script's language.
        {isNew ? ' Saving runs Voice design straight away and plays you a sample.' : ' After changing the description, press Re-design.'}
      </p>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || (!draft.description.trim() && !draft.prebuilt)}
          onClick={onSave}
          className="flex items-center gap-1.5 rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-black disabled:opacity-40"
        >
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {isNew ? 'Create voice' : 'Save'}
        </button>
      </div>
    </div>
  )
}
