import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  ArrowUp,
  AudioLines,
  Clock,
  Code2,
  RotateCcw,
  Undo2,
  Coins,
  ChevronDown,
  ChevronUp,
  Film,
  Mic,
  Music,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  RectangleHorizontal,
  RectangleVertical,
  Scan,
  Volume2,
  VolumeX,
  WandSparkles,
  X,
} from 'lucide-react'
import {
  costOfSeconds,
  estimateCost,
  formatUsd,
  getModel,
  MAX_COUNT,
  IMAGE_MODELS,
  MUSIC_MODELS,
  TTS_MODELS,
  VIDEO_MODELS,
  type ImageSize,
  parentInfoOf,
  resolveSettings,
  type AspectRatio,
  type ModelId,
  type Resolution,
} from '../../../shared/models'
import { availableTokens, compileImagePrompt, compileMusicPrompt, compileOmniPrompt, compileOpenRouterImagePrompt, compileVeoPrompt, unknownTokens, type MediaLayout } from '../../../shared/promptCompiler'
import type { Asset } from '../../../shared/types'
import { useAssets, useConfig, useGenerations, useInvalidate, useProjects, useUpload, useVoices } from '../../hooks/queries'
import { estimateSpeechSeconds, parseScript } from '../../../shared/voices'
import { VoiceStrip } from './VoiceStrip'
import { TokenHighlights } from './TokenHighlights'
import { api, fileUrl } from '../../lib/api'
import { cn, videoDuration } from '../../lib/utils'
import { useComposer, type DraftSnapshot, type Role } from '../../stores/composer'
import { activeProjectId, useUi } from '../../stores/ui'
import { Chip, ChipSelect } from '../ChipSelect'
import { Popover } from '../Popover'
import { AttachTile } from './AttachTile'
import { DirectivesBar } from './DirectivesBar'
import { composePrompt, effectiveDirectives } from '../../../shared/directives'
import { DEFAULT_PROJECT_ID } from '../../../shared/types'
import { PromptHistory } from './PromptHistory'
import { RefinePrompt } from './RefinePrompt'

const VIDEO_REF_LIMIT = 3.05
const MIN_PROMPT_PX = Math.ceil(4 * 15 * 1.625 + 16)

/** Shared by the textarea and the highlight layer behind it - they must wrap identically. */
// scrollbar-gutter: both layers reserve the scrollbar's width even when only the textarea shows one -
// otherwise a long (scrolling) prompt wraps differently and the highlights drift off their tokens.
const PROMPT_BOX =
  'whitespace-pre-wrap break-words px-2 py-2 pr-28 font-sans text-[15px] leading-relaxed [scrollbar-gutter:stable] sm:pr-36'

export function Composer() {
  const c = useComposer()
  const { byId } = useAssets()
  const { data: generations } = useGenerations()
  const { data: projects } = useProjects()
  const projectView = useUi((st) => st.projectId) || DEFAULT_PROJECT_ID
  const project = projects?.find((p) => p.id === projectView)
  const upload = useUpload()
  const invalidate = useInvalidate()
  const { requestTrim, notify, openLibrary } = useUi()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const highlights = useRef<HTMLDivElement>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [mentionIdx, setMentionIdx] = useState(0)
  const [busy, setBusy] = useState(false)
  /** what the last reset cleared - the icon offers Undo for a few seconds */
  const [undo, setUndo] = useState<DraftSnapshot>()
  useEffect(() => {
    if (!undo) return
    const t = setTimeout(() => setUndo(undefined), 6000)
    return () => clearTimeout(t)
  }, [undo])
  const draftEmpty = !c.prompt.trim() && !c.refs.firstFrame && !c.refs.lastFrame && !c.refs.images.length && !c.refs.videos.length && c.mode === 'create'

  const model = getModel(c.model)
  const parent = c.parentId ? generations?.find((g) => g.id === c.parentId) : undefined
  const resolved = resolveSettings(c.model, c.settings, c.refs, c.mode, parentInfoOf(parent))
  const s = resolved.settings
  const photo = c.kind === 'image'
  const speech = c.kind === 'audio'
  const music = c.kind === 'music'
  const { data: voiceData, project: projectVoiceList } = useVoices(projectView)
  // Speech: the voices picked from the library (any project) in their order; none picked = the project's voices.
  const pickedVoices = c.speechVoices.map((id) => voiceData?.voices.find((v) => v.id === id)).filter((v) => !!v)
  const explicitVoices = speech && c.speechVoices.length > 0
  const voices = explicitVoices ? pickedVoices : projectVoiceList
  // Photo mode keeps frames / video refs for later but only sends image refs.
  const layout: MediaLayout = {
    hasFirst: c.kind === 'video' && !!c.refs.firstFrame,
    hasLast: c.kind === 'video' && !!c.refs.lastFrame,
    imageRefs: speech ? 0 : c.refs.images.length,
    videoRefs: c.kind === 'video' ? c.refs.videos.length : 0,
    // photos and music have no voices; video prompts and speech scripts may use @voiceN
    voices: photo || music ? 0 : voices.length,
  }
  const bad = unknownTokens(c.prompt, layout)
  const { data: config } = useConfig()
  const errors = [
    ...resolved.errors,
    ...(bad.length ? [`${bad.join(', ')} not attached`] : []),
    ...(model.provider.startsWith('openrouter') && config && !config.hasOpenRouterKey ? ['OPENROUTER_API_KEY is not set - add it to .env.local and restart.'] : []),
  ]
  const cost = estimateCost(c.model, s, speech ? estimateSpeechSeconds(c.prompt) : 0, c.kind === 'video' ? c.refs.images.length : 0)

  const assetsOf = (ids: (string | undefined)[]) => ids.map((id) => (id ? byId.get(id) : undefined)).filter(Boolean) as Asset[]

  const tokenOptions = useMemo(() => {
    if (!mention) return []
    return availableTokens(layout).filter((t) => t.token.slice(1).startsWith(mention.query.toLowerCase()))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mention, layout.hasFirst, layout.hasLast, layout.imageRefs, layout.videoRefs])

  useLayoutEffect(() => {
    const el = textarea.current
    if (!el) return
    el.style.height = 'auto'
    // at least 4 lines visible (15px × 1.625 line-height + 16px padding), grows to ~9 lines, then scrolls
    el.style.height = `${Math.min(240, Math.max(MIN_PROMPT_PX, el.scrollHeight))}px`
  }, [c.prompt])

  // ---------- attachments ----------
  async function addFiles(role: Role, files: File[], source: 'upload' | 'paste' = 'upload') {
    try {
      setBusy(true)
      const ids: string[] = []
      // audio has no slot here (the models take no audio refs) - it belongs in Library > Audio / Studio
      const audio = files.filter((f) => f.type.startsWith('audio/'))
      if (audio.length) notify('Audio cannot be a reference - upload music in Library › Audio and use it in Studio.', 'error')
      files = files.filter((f) => !f.type.startsWith('audio/'))
      const images = files.filter((f) => !f.type.startsWith('video/'))
      const videos = files.filter((f) => f.type.startsWith('video/'))
      if (role !== 'videos' && videos.length) notify('Frames and image refs take images only.', 'error')
      if (role !== 'videos' && images.length) ids.push(...(await upload.mutateAsync({ files: images, source })).map((a) => a.id))
      if (role === 'videos') {
        if (images.length) notify('Video refs take videos only.', 'error')
        for (const f of videos) {
          const url = URL.createObjectURL(f)
          try {
            const d = await videoDuration(url)
            let start = 0
            if (d > VIDEO_REF_LIMIT) {
              const picked = await requestTrim(url, d)
              if (picked === null) continue
              start = picked
            }
            ids.push(...(await upload.mutateAsync({ files: [f], trimStart: start })).map((a) => a.id))
          } finally {
            URL.revokeObjectURL(url)
          }
        }
      }
      if (ids.length) c.attach(role, ids)
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  function onPaste(e: ClipboardEvent) {
    const files = [...e.clipboardData.files].filter((f) => f.type.startsWith('image/'))
    if (!files.length) return
    e.preventDefault()
    void addFiles('images', files, 'paste')
  }

  // ---------- mentions ----------
  function detectMention(el: HTMLTextAreaElement) {
    const before = el.value.slice(0, el.selectionStart)
    const m = /(^|\s)@(\w*)$/.exec(before)
    setMention(m ? { query: m[2], start: el.selectionStart - m[2].length - 1 } : null)
    setMentionIdx(0)
  }

  function insertToken(token: string) {
    const el = textarea.current
    if (!el || !mention) return
    const caret = el.selectionStart
    const next = `${c.prompt.slice(0, mention.start)}${token} ${c.prompt.slice(caret)}`
    c.setPrompt(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = mention.start + token.length + 1
      el.focus()
      el.setSelectionRange(pos, pos)
    })
  }

  const submit = useMutation({
    mutationFn: () =>
      api.createGenerations({
        model: c.model,
        prompt: c.prompt,
        refs: c.refs,
        settings: s,
        mode: c.mode,
        parentId: c.parentId,
        projectId: activeProjectId(),
        voiceIds: explicitVoices ? pickedVoices.map((v) => v.id) : undefined,
        directiveOverrides: c.overrides,
      }),
    onSuccess: async (gens) => {
      await invalidate('generations')
      if (c.mode !== 'create') c.cancelMode()
      notify(`${gens.length} ${photo ? 'photo' : music ? 'song' : speech ? 'recording' : 'video'}${gens.length > 1 ? 's' : ''} queued`)
    },
    onError: (e) => notify((e as Error).message, 'error'),
  })

  const canSend =
    !errors.length && !submit.isPending && !busy && (!!c.prompt.trim() || (c.kind === 'video' && (!!c.refs.firstFrame || c.mode === 'extend')))

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (mention && tokenOptions.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setMentionIdx((i) => (i + d + tokenOptions.length) % tokenOptions.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        insertToken(tokenOptions[mentionIdx].token)
        return
      }
      if (e.key === 'Escape') {
        setMention(null)
        return
      }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      if (canSend) submit.mutate()
      return
    }
    if (e.key === 'ArrowUp' && !c.prompt && generations?.length) {
      e.preventDefault()
      const last = generations.find((g) => g.prompt.trim())
      if (last) c.setPrompt(last.prompt)
    }
  }

  const tokenLabel = (t: ReturnType<typeof availableTokens>[number]) => {
    const a =
      t.role === 'first' ? byId.get(c.refs.firstFrame!)
      : t.role === 'last' ? byId.get(c.refs.lastFrame!)
      : t.role === 'image' ? byId.get(c.refs.images[t.index])
      : byId.get(c.refs.videos[t.index])
    if (t.role === 'voice') {
      const v = voices[t.index]
      return { a: undefined, role: `Voice · ${v?.name ?? ''}${v?.description ? ` - ${v.description.slice(0, 40)}` : ''}` }
    }
    const role = t.role === 'first' ? 'Start frame' : t.role === 'last' ? 'End frame' : t.role === 'image' ? 'Image ref' : 'Video ref'
    return { a, role }
  }

  // Same order as the server: (Enhance) -> project directives -> model-specific compile.
  // style / camera / avoid direct pictures - music never carries them
  const directives = c.mode === 'edit' || music ? {} : effectiveDirectives(project?.defaults, c.overrides)
  // Same pipeline as the server (shared/directives.composePrompt).
  const compileFor = (t: string) =>
    photo
      ? model.provider === 'openrouter-image'
        ? compileOpenRouterImagePrompt(t, { mode: c.mode, imageRefs: c.refs.images.length })
        : compileImagePrompt(t)
      : music
        ? compileMusicPrompt(t, s, model.durations.length === 1)
        : model.provider === 'omni'
        ? compileOmniPrompt(t, layout, { mode: c.mode, durationHint: c.mode === 'create' ? s.duration : 0 })
        : compileVeoPrompt(t)
  const composed = speech
    ? {
        text: parseScript(c.prompt, s.voice ?? 1)
          .map((t) => `@voice${t.voice} (${voices[t.voice - 1]?.name ?? 'missing!'})${t.style ? ` [${t.style}]` : ''}: ${t.text}`)
          .join('\n'),
        negativePrompt: undefined,
      }
    : composePrompt(c.prompt, directives, {
        kind: c.kind,
        compile: compileFor,
        negativeAsParam: model.provider === 'veo' && !c.refs.images.length && c.mode !== 'extend',
      })
  const compiled = composed.text + (composed.negativePrompt ? `\n\n[Veo negativePrompt parameter]: ${composed.negativePrompt}` : '')

  const veo = model.provider === 'veo'
  const imgTokens = c.refs.images.map((_, i) => `@img${i + 1}`)
  const vidTokens = c.refs.videos.map((_, i) => `@vid${i + 1}`)

  const collapsed = useUi((st) => st.composerCollapsed)
  const setCollapsed = useUi((st) => st.setComposerCollapsed)

  function expand(focus = true) {
    setCollapsed(false)
    if (focus) requestAnimationFrame(() => textarea.current?.focus())
  }

  if (collapsed) {
    const refCount = [
      c.kind === 'video' && (c.refs.firstFrame ? 1 : 0) + (c.refs.lastFrame ? 1 : 0),
      c.kind !== 'audio' && c.refs.images.length,
      c.kind === 'video' && c.refs.videos.length,
    ].reduce<number>((n, x) => n + (Number(x) || 0), 0)
    const summary = speech
      ? `voice ${s.voice ?? 1}`
      : music
        ? `${model.durations.length === 1 ? `${s.duration}s` : s.duration ? `~${s.duration}s` : 'full song'}${s.instrumental ? ' · instrumental' : ''}${s.count > 1 ? ` · ×${s.count}` : ''}`
        : photo
        ? `${s.aspectRatio} · ${s.imageSize ?? '1K'}${s.count > 1 ? ` · ×${s.count}` : ''}`
        : `${s.aspectRatio} · ${s.resolution} · ${s.duration ? `${s.duration}s` : 'auto'}${s.audio ? '' : ' · muted'}${s.count > 1 ? ` · ×${s.count}` : ''}`
    const KindIcon = speech ? Mic : music ? Music : photo ? ImageIcon : Film
    return (
      <div className="flex w-full max-w-[860px] lg:max-w-[1000px] 2xl:max-w-[1120px] items-center gap-2 rounded-full border border-white/10 bg-neutral-900/80 py-1.5 pl-3 pr-1.5 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl">
        <button type="button" onClick={() => expand()} className="flex min-w-0 flex-1 items-center gap-2 text-left" title="Expand (click)">
          <KindIcon className="size-4 shrink-0 text-white/60" />
          <span className="shrink-0 text-[12.5px] text-white/70">{model.label}</span>
          {c.mode !== 'create' && <span className="shrink-0 rounded bg-sky-500/20 px-1.5 text-[11px] text-sky-200">{c.mode}</span>}
          <span className={cn('min-w-0 flex-1 truncate text-[13.5px]', c.prompt.trim() ? 'text-white/90' : 'text-white/35')}>
            {c.prompt.trim().replace(/\s+/g, ' ') || 'Write a prompt…'}
          </span>
          {refCount > 0 && <span className="shrink-0 rounded-md bg-white/[0.07] px-1.5 text-[11.5px] text-white/60">{refCount} ref{refCount > 1 ? 's' : ''}</span>}
          {errors.length > 0 && (
            <span className="shrink-0 rounded-md bg-rose-500/20 px-1.5 text-[11.5px] text-rose-200" title={errors.join('\n')}>
              {errors.length} issue{errors.length > 1 ? 's' : ''}
            </span>
          )}
          <span className="hidden shrink-0 text-[12px] text-white/45 md:inline">{summary}</span>
          <span className="shrink-0 text-[12px] text-white/55">~{formatUsd(cost)}</span>
        </button>
        {/* no Generate here on purpose: a stray click on the collapsed bar must never start a paid run */}
        <button
          type="button"
          onClick={() => expand()}
          title="Expand the prompt panel"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white/[0.08] px-4 text-[13px] text-white/80 transition hover:bg-white/15 hover:text-white"
        >
          <ChevronUp className="size-4" /> Expand
        </button>
      </div>
    )
  }

  return (
    <div
      className="relative w-full max-w-[860px] lg:max-w-[1000px] 2xl:max-w-[1120px] rounded-[22px] border border-white/10 bg-neutral-900/70 p-2 sm:rounded-[28px] sm:p-3 shadow-[0_20px_80px_-20px_rgba(0,0,0,0.8)] backdrop-blur-2xl"
      onPaste={onPaste}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const files = [...e.dataTransfer.files]
        const vids = files.filter((f) => f.type.startsWith('video/'))
        const imgs = files.filter((f) => f.type.startsWith('image/'))
        if (imgs.length) void addFiles('images', imgs)
        if (vids.length && !veo && !photo) void addFiles('videos', vids)
      }}
    >
      <button
        type="button"
        onClick={() => setCollapsed(true)}
        title="Collapse to one line"
        className="absolute -top-3 left-1/2 z-10 flex h-6 -translate-x-1/2 items-center rounded-full border border-white/10 bg-neutral-900 px-3 text-white/50 shadow-lg hover:text-white"
      >
        <ChevronDown className="size-3.5" />
      </button>
      {c.mode !== 'create' && (
        <div className="mb-2 flex items-center gap-2 rounded-2xl bg-sky-500/10 px-3 py-2 text-[13px] text-sky-200">
          {parent?.thumb && <img src={fileUrl('thumbs', parent.thumb)} alt="" className="h-8 w-12 rounded object-cover" />}
          <span className="font-medium">{c.mode === 'edit' ? 'Editing' : 'Extending'}</span>
          <span className="truncate text-sky-200/70">{parent?.title || parent?.prompt || 'video'}</span>
          <button type="button" className="ml-auto rounded-full p-1 hover:bg-white/10" onClick={c.cancelMode} title="Back to a new one">
            <X className="size-3.5" />
          </button>
        </div>
      )}

      {speech ? (
        <VoiceStrip
          voices={voices}
          explicit={explicitVoices}
          defaultVoice={s.voice ?? 1}
          onDefault={(n) => c.setSetting('voice', n)}
          onPick={() => openLibrary('voices')}
          onRemove={(id) => c.detach('voices', id)}
          onUseProject={() => c.setSpeechVoices([])}
        />
      ) : (
      <div className="flex flex-wrap gap-1.5 pb-1 sm:gap-2">
        {!photo && !music && (
        <>
        <AttachTile
          label="Start frame"
          icon={<ImagePlus className="size-[18px]" />}
          items={assetsOf([c.refs.firstFrame])}
          tokens={['@start']}
          max={1}
          accept="image/*"
          disabled={
            c.mode === 'edit' ? 'Edits start from the source video'
            : c.mode === 'extend' ? 'Extensions continue the source video'
            : model.frames && !model.frames.includes('first') ? `${model.label} takes no start frame`
            : undefined
          }
          onFiles={(f) => addFiles('firstFrame', f)}
          onLibrary={() => openLibrary('firstFrame')}
          onRemove={(id) => c.detach('firstFrame', id)}
        />
        <AttachTile
          label="End frame"
          icon={<ImagePlus className="size-[18px]" />}
          items={assetsOf([c.refs.lastFrame])}
          tokens={['@end']}
          max={1}
          accept="image/*"
          disabled={
            c.mode !== 'create' ? 'Not available when continuing a video'
            : model.frames && !model.frames.includes('last') ? `${model.label} takes no end frame`
            : undefined
          }
          onFiles={(f) => addFiles('lastFrame', f)}
          onLibrary={() => openLibrary('lastFrame')}
          onRemove={(id) => c.detach('lastFrame', id)}
        />
        </>
        )}
        <AttachTile
          label={music ? 'Inspiration' : 'Image refs'}
          icon={<ImagePlus className="size-[18px]" />}
          items={assetsOf(c.refs.images)}
          tokens={imgTokens}
          max={model.maxImageRefs}
          accept="image/*"
          disabled={!model.maxImageRefs ? `${model.label} takes no image refs` : veo && c.mode === 'extend' ? 'Veo extension takes no images' : undefined}
          onFiles={(f) => addFiles('images', f)}
          onLibrary={() => openLibrary('images')}
          onRemove={(id) => c.detach('images', id)}
        />
        {music ? (
          <p className="flex max-w-[420px] items-center px-2 text-[12px] leading-snug text-white/40">
            Optional: an image whose mood, colours and setting the music should follow (@img1). Lyrics go in the prompt under [Verse] / [Chorus]; Instrumental drops the vocals.
          </p>
        ) : photo ? (
          <p className="flex max-w-[360px] items-center px-2 text-[12px] leading-snug text-white/40">
            Up to {model.maxImageRefs} reference images: subjects, products, characters, style. Reference them as @img1, @img2… or edit one in plain words.
          </p>
        ) : (
        <>
        <AttachTile
          label="Video refs"
          icon={<Film className="size-[18px]" />}
          items={assetsOf(c.refs.videos)}
          tokens={vidTokens}
          max={model.maxVideoRefs}
          accept="video/*"
          disabled={!model.maxVideoRefs ? `${model.label} takes no video refs` : undefined}
          onFiles={(f) => addFiles('videos', f)}
          onLibrary={() => openLibrary('videos')}
          onRemove={(id) => c.detach('videos', id)}
        />
        <AttachTile
          label="Audio refs"
          icon={<AudioLines className="size-[18px]" />}
          items={[]}
          max={0}
          accept="audio/*"
          disabled="Audio references are not supported by the Gemini API yet"
          onFiles={() => {}}
          onLibrary={() => {}}
          onRemove={() => {}}
        />
        </>
        )}
        {busy && (
          <div className="flex items-center gap-2 px-2 text-[12px] text-white/50">
            <Loader2 className="size-3.5 animate-spin" /> uploading…
          </div>
        )}
      </div>
      )}

      <div className="relative mt-1">
        <TokenHighlights
          ref={highlights}
          text={c.prompt}
          known={new Set(availableTokens(layout).map((t) => t.token))}
          className={`${PROMPT_BOX} pointer-events-none absolute inset-0 overflow-hidden text-transparent`}
        />
        <textarea
          ref={textarea}
          value={c.prompt}
          onScroll={(e) => {
            if (highlights.current) highlights.current.scrollTop = e.currentTarget.scrollTop
          }}
          rows={4}
          spellCheck
          placeholder={
            music ? 'Describe the music: genre, mood, tempo, instruments, structure… Add lyrics under [Verse 1] / [Chorus], or switch Instrumental on.'
            : speech ? 'Script. One speaker per line: @voice1: Dzień dobry!  @voice2 (whispering): …  Lines without a tag use the default voice.'
            : photo ? (c.mode === 'edit' ? 'Describe the change, e.g. "Make the sky stormy, keep everything else."' : 'Describe your photo or reference images by using @...')
            : c.mode === 'edit' ? 'Describe the change, e.g. "Make it night. Keep everything else the same."'
            : c.mode === 'extend' ? 'How should the scene continue? (empty = "Extend this video")'
            : 'Describe your video or reference by using @...'
          }
          onChange={(e) => {
            c.setPrompt(e.target.value)
            detectMention(e.target)
          }}
          onClick={(e) => detectMention(e.currentTarget)}
          onKeyDown={onKeyDown}
          onBlur={() => setTimeout(() => setMention(null), 150)}
          className={`${PROMPT_BOX} relative block w-full resize-none bg-transparent text-white placeholder:text-white/40 focus:outline-none`}
        />
        <div className="absolute right-1 top-1 flex items-center gap-0.5">
          {undo ? (
            <button
              type="button"
              onClick={() => {
                c.restoreDraft(undo)
                setUndo(undefined)
              }}
              title="Undo reset"
              className="flex items-center gap-1 rounded-lg px-1.5 py-1 text-[11.5px] text-amber-200 hover:bg-white/10"
            >
              <Undo2 className="size-4" /> Undo
            </button>
          ) : (
            <button
              type="button"
              disabled={draftEmpty}
              onClick={() => setUndo(c.resetDraft())}
              title="Reset: clear the prompt and attached refs (model and settings stay)"
              className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <RotateCcw className="size-4" />
            </button>
          )}
          {!speech && (
            <RefinePrompt
              prompt={c.prompt}
              targetModel={c.model}
              directives={directives}
              onReplace={(next) => {
                // same Undo as Reset: the old prompt comes back with one click
                setUndo({ prompt: c.prompt, refs: c.refs, mode: c.mode, parentId: c.parentId })
                c.setPrompt(next)
              }}
            />
          )}
          <PromptHistory />
          <Popover
            align="right"
            side="top"
            className="w-[420px] p-3"
            trigger={({ toggle }) => (
              <button type="button" onClick={toggle} title="Preview what will be sent" className="rounded-lg p-1.5 text-white/45 hover:bg-white/10 hover:text-white">
                <Code2 className="size-4" />
              </button>
            )}
          >
            <p className="mb-1 text-[11px] uppercase tracking-wide text-white/40">Prompt sent to {model.label}{s.enhance ? ' (before Enhance)' : ''}</p>
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap rounded-lg bg-black/40 p-2 text-[12px] text-white/85">{compiled || '—'}</pre>
            <p className="mb-1 mt-2 text-[11px] uppercase tracking-wide text-white/40">Settings</p>
            <pre className="overflow-auto rounded-lg bg-black/40 p-2 text-[12px] text-white/70">
              {JSON.stringify({ model: c.model, mode: c.mode, ...s, refs: { first: !!c.refs.firstFrame, last: !!c.refs.lastFrame, images: c.refs.images.length, videos: c.refs.videos.length } }, null, 1)}
            </pre>
          </Popover>
        </div>

        {mention && tokenOptions.length > 0 && (
          <div className="absolute bottom-full left-2 z-50 mb-1 w-72 rounded-xl border border-white/10 bg-neutral-900/95 p-1 shadow-2xl backdrop-blur-xl">
            {tokenOptions.map((t, i) => {
              const { a, role } = tokenLabel(t)
              return (
                <button
                  key={t.token}
                  type="button"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertToken(t.token)
                  }}
                  className={cn('flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px]', i === mentionIdx ? 'bg-white/10' : 'hover:bg-white/5')}
                >
                  {a && <img src={fileUrl('thumbs', a.thumb)} alt="" className="size-7 rounded object-cover" />}
                  <span className="font-mono text-white">{t.token}</span>
                  <span className="truncate text-white/45">{role} · {a?.label}</span>
                </button>
              )
            })}
          </div>
        )}
        {mention && !tokenOptions.length && availableTokens(layout).length === 0 && (
          <div className="absolute bottom-full left-2 z-50 mb-1 rounded-xl border border-white/10 bg-neutral-900/95 px-3 py-2 text-[12px] text-white/50">
            Attach a frame, image or video first - then reference it with @
          </div>
        )}
      </div>

      {(errors.length > 0 || resolved.warnings.length > 0) && (
        <div className="px-2 pb-1 text-[12px]">
          {errors.map((e) => (
            <p key={e} className="text-rose-300">{e}</p>
          ))}
          {resolved.warnings.map((w) => (
            <p key={w} className="text-amber-300/90">{w}</p>
          ))}
        </div>
      )}

      {!speech && !music && <DirectivesBar kind={c.kind} disabled={c.mode === 'edit' ? 'Edits use only your prompt - short, plain prompts edit best' : undefined} />}

      <div className="flex flex-wrap items-center gap-0.5">
        <div className="mr-1 flex rounded-lg bg-white/[0.06] p-0.5" role="tablist">
          {(['video', 'image', 'audio', 'music'] as const).map((k) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={c.kind === k}
              onClick={() => c.setKind(k)}
              className={cn(
                'flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] transition',
                c.kind === k ? 'bg-white text-black' : 'text-white/60 hover:text-white',
              )}
            >
              {k === 'video' ? <Film className="size-3.5" /> : k === 'image' ? <ImageIcon className="size-3.5" /> : k === 'music' ? <Music className="size-3.5" /> : <Mic className="size-3.5" />}
              {k === 'video' ? 'Video' : k === 'image' ? 'Photo' : k === 'music' ? 'Music' : 'Speech'}
            </button>
          ))}
        </div>
        <ChipSelect
          icon={photo ? <ImageIcon className="size-4" /> : speech ? <Mic className="size-4" /> : music ? <Music className="size-4" /> : <Film className="size-4" />}
          label={model.label}
          value={c.model}
          options={(photo ? IMAGE_MODELS : speech ? TTS_MODELS : music ? MUSIC_MODELS : VIDEO_MODELS).map((m) => ({
            value: m.id,
            label: m.pricePerRequest !== undefined ? `${m.label} · ${formatUsd(m.pricePerRequest)}` : m.label,
            hint:
              m.provider === 'openrouter' ? `OpenRouter · from ${formatUsd(Math.min(...Object.values(m.pricePerSecondSilent ?? m.pricePerSecond)))}/s`
              : m.provider === 'openrouter-image' ? `OpenRouter · from ${formatUsd(Math.min(...Object.values(m.pricePerImage ?? {})))}`
              : undefined,
          }))}
          onChange={(v) => c.setModel(v as ModelId)}
        />
        {music && (
          <>
            <ChipSelect
              icon={<Clock className="size-4" />}
              label={model.durations.length === 1 ? `${s.duration}s` : s.duration ? `~${s.duration >= 60 ? `${s.duration / 60} min` : `${s.duration}s`}` : 'Full song'}
              value={s.duration}
              locked={resolved.locks.duration}
              title="Lyria 3.5: the length is a hint in the prompt - the song decides the exact end"
              options={model.durations.map((d) => ({ value: d, label: d ? (d >= 60 ? `about ${d / 60} min` : `about ${d} s`) : 'Full song (model decides, ~2-3 min)' }))}
              onChange={(v) => c.setSetting('duration', Number(v))}
            />
            <Chip
              icon={s.instrumental ? <Music className="size-4" /> : <Mic className="size-4" />}
              label={s.instrumental ? 'Instrumental' : 'Vocals'}
              active={!!s.instrumental}
              title={s.instrumental ? 'Instrumental: "Instrumental only, no vocals." is added to the prompt' : 'The model may sing (it writes lyrics unless you give them). Click for instrumental.'}
              onClick={() => c.setSetting('instrumental', !s.instrumental)}
            />
          </>
        )}
        {!speech && (
        <>
        {!music && (
        <ChipSelect
          icon={['9:16', '9:21', '2:3', '3:4', '4:5'].includes(s.aspectRatio) ? <RectangleVertical className="size-4" /> : <RectangleHorizontal className="size-4" />}
          label={s.aspectRatio}
          value={s.aspectRatio}
          locked={resolved.locks.aspectRatio}
          options={model.aspectRatios.map((r) => ({
            value: r,
            label: r === '16:9' ? '16:9 landscape' : r === '9:16' ? '9:16 portrait' : r === '1:1' ? '1:1 square' : r,
          }))}
          onChange={(v) => c.setSetting('aspectRatio', v as AspectRatio)}
        />
        )}
        {music ? null : photo ? (
          <ChipSelect
            icon={<Scan className="size-4" />}
            label={s.imageSize ?? '1K'}
            value={s.imageSize ?? '1K'}
            locked={resolved.locks.imageSize}
            options={(model.imageSizes ?? []).map((z) => ({
              value: z,
              label: `${z === '512' ? '512 px' : z} · ${formatUsd(model.pricePerImage?.[z] ?? 0)}`,
            }))}
            onChange={(v) => c.setSetting('imageSize', v as ImageSize)}
          />
        ) : (
        <>
        <ChipSelect
          icon={<Scan className="size-4" />}
          label={s.resolution}
          value={s.resolution}
          locked={resolved.locks.resolution}
          options={model.resolutions.map((r) => ({
            value: r,
            label: `${r}${r === '360p' ? ' draft · ⅓ price' : ''}${model.provider === 'omni' && (r === '1080p' || r === '4k') ? ' (upscaled)' : ''}`,
          }))}
          onChange={(v) => c.setSetting('resolution', v as Resolution)}
        />
        <ChipSelect
          icon={<Clock className="size-4" />}
          label={s.duration ? `${s.duration}s` : 'Auto'}
          value={s.duration}
          locked={resolved.locks.duration}
          title={model.provider === 'omni' ? 'Omni: sent as a prompt hint, the model decides the final length (≤10 s)' : undefined}
          options={model.durations.map((d) => ({ value: d, label: d ? `${d} seconds` : 'Auto (model decides)' }))}
          onChange={(v) => c.setSetting('duration', Number(v))}
        />
        <Chip
          icon={s.audio ? <Volume2 className="size-4" /> : <VolumeX className="size-4" />}
          label={s.audio ? 'On' : 'Off'}
          active={s.audio}
          disabled={!!resolved.locks.audio}
          title={
            resolved.locks.audio ??
            (s.audio ? 'Audio on'
            : model.audio ? 'Audio off - the model is asked for a silent video (billed at its silent rate where it has one)'
            : 'Audio off - the model still generates sound, the track is removed after download (original kept)')
          }
          onClick={() => c.setSetting('audio', !s.audio)}
        />
        </>
        )}
        <ChipSelect
          icon={<Layers className="size-4" />}
          label={String(s.count)}
          value={s.count}
          locked={resolved.locks.count}
          title={`Number of ${photo ? 'photos' : music ? 'songs' : 'videos'} (separate requests)`}
          options={Array.from({ length: MAX_COUNT }, (_, i) => ({ value: i + 1, label: `${i + 1} ${photo ? 'photo' : music ? 'song' : 'video'}${i ? 's' : ''}` }))}
          onChange={(v) => c.setSetting('count', Number(v))}
        />
        {resolved.locks.enhance ? (
          <Chip icon={<WandSparkles className="size-4" />} label="Off" active={false} title={resolved.locks.enhance} onClick={() => {}} disabled />
        ) : (
          <Chip
            icon={<WandSparkles className="size-4" />}
            label={s.enhance ? 'On' : 'Off'}
            active={s.enhance}
            title="Enhance: a Gemini text model rewrites the prompt using the model's prompt guide"
            onClick={() => c.setSetting('enhance', !s.enhance)}
          />
        )}
        </>
        )}

        <div className="ml-auto flex items-center gap-2">
          <span
            className="flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[13px] text-white/75"
            title={
              speech
                ? `Estimate: ~${Math.round(estimateSpeechSeconds(c.prompt))} s of speech × ${formatUsd(model.pricePerAudioSecond ?? 0)}/s`
                : music
                ? `${s.count} × ${formatUsd(model.pricePerRequest ?? 0)} per ${model.durations.length === 1 ? '30 s clip' : 'song'} (fixed price)`
                : photo
                ? `Estimate: ${s.count} × ${formatUsd(model.pricePerImage?.[s.imageSize ?? '1K'] ?? 0)} per ${s.imageSize ?? '1K'} image${model.pricePerImageRef && c.refs.images.length ? ` + ${c.refs.images.length} × ${formatUsd(model.pricePerImageRef)} per reference image` : ''}`
                : `Estimate: ${s.count} × ${s.duration || model.autoDurationEstimate}s × ${formatUsd(costOfSeconds(c.model, s.resolution, 1, s.audio))}/s${model.pricePerImageRef && c.refs.images.length ? ` + ${c.refs.images.length} × ${formatUsd(model.pricePerImageRef)} per image ref` : ''}`
            }
          >
            <Coins className="size-4" /> ~{formatUsd(cost)}
          </span>
          <button
            type="button"
            disabled={!canSend}
            onClick={() => submit.mutate()}
            title="Generate (Ctrl+Enter)"
            className="flex size-10 items-center justify-center rounded-full bg-white text-black transition hover:bg-white/90 disabled:cursor-not-allowed disabled:bg-white/25"
          >
            {submit.isPending ? <Loader2 className="size-5 animate-spin" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
      </div>
    </div>
  )
}
