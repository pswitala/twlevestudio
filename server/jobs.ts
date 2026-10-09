import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { costOfSeconds, estimateCost, getModel, parentInfoOf, resolveSettings } from '../shared/models'
import { composePrompt, effectiveDirectives } from '../shared/directives'
import { describeVoiceTokens, estimateSpeechSeconds, parseScript, snapshotVoices, voiceTokens } from '../shared/voices'
import { unknownTokens } from '../shared/promptCompiler'
import { DEFAULT_PROJECT_ID, type CreateGenerationRequest, type Generation } from '../shared/types'
import { enhancePrompt } from './enhance'
import { errorMessage } from './genai'
import { probe, stripAudio, thumbnail, waveform } from './media'
import * as lyria from './providers/lyria'
import * as nanobanana from './providers/nanobanana'
import * as omni from './providers/omni'
import * as openrouter from './providers/openrouter'
import * as tts from './providers/tts'
import * as veo from './providers/veo'
import { DIRS, db, findAsset, findGeneration, outputDir, persist, projectVoices, removeFile } from './store'
import { renderEdit } from './studio'
import { timelineEnd, type Edit } from '../shared/studio'

const MAX_CONCURRENT = 3
const running = new Set<string>()

export class ValidationError extends Error {}

export async function createGenerations(req: CreateGenerationRequest): Promise<Generation[]> {
  const model = getModel(req.model)
  const parent = () => (req.parentId ? findGeneration(req.parentId) : undefined)
  const mode = req.mode ?? 'create'
  const isImage = model.kind !== 'video'
  // Photo mode keeps the composer's frames / video refs for later, but never sends them.
  const refs = {
    firstFrame: (!isImage && req.refs?.firstFrame) || undefined,
    lastFrame: (!isImage && req.refs?.lastFrame) || undefined,
    images: model.kind === 'audio' ? [] : (req.refs?.images ?? []),
    videos: isImage ? [] : (req.refs?.videos ?? []),
  }
  const projectId = req.projectId && db.projects.some((p) => p.id === req.projectId) ? req.projectId : (parent()?.projectId ?? DEFAULT_PROJECT_ID)
  const r = resolveSettings(model.id, req.settings, refs, mode, parentInfoOf(parent()))
  const errors = [...r.errors]

  for (const id of [refs.firstFrame, refs.lastFrame, ...refs.images].filter(Boolean) as string[]) {
    if (findAsset(id)?.kind !== 'image') errors.push(`Image ${id} is not in the library.`)
  }
  for (const id of refs.videos) if (findAsset(id)?.kind !== 'video') errors.push(`Video ${id} is not in the library.`)

  // Voices: photos have no sound, everything else may use @voiceN of the project.
  // Speech may pick its voices from the whole library (any project); otherwise the project's voices.
  let chosen = projectVoices(projectId)
  if (model.kind === 'audio' && Array.isArray(req.voiceIds) && req.voiceIds.length) {
    chosen = req.voiceIds.map((id) => db.voices.find((v) => v.id === id)).filter((v) => !!v)
    if (chosen.length !== req.voiceIds.length) errors.push('A chosen voice no longer exists - pick the voices again.')
  }
  // photos and music have no voices; video prompts and speech may use @voiceN
  const voices = model.kind === 'image' || model.kind === 'music' ? [] : snapshotVoices(chosen)
  const bad = unknownTokens(req.prompt, {
    hasFirst: !!refs.firstFrame,
    hasLast: !!refs.lastFrame,
    imageRefs: refs.images.length,
    videoRefs: refs.videos.length,
    voices: voices.length,
  })
  if (model.kind === 'audio') {
    const turns = parseScript(req.prompt, r.settings.voice ?? 1)
    if (!turns.length) errors.push('Write the script.')
    for (const n of new Set(turns.map((t) => t.voice))) {
      const v = voices.find((x) => x.index === n)
      if (!v) errors.push(`@voice${n} does not exist in this project.`)
      else if (!v.voice) errors.push(`@voice${n} (${v.name}) has no speaking voice yet - design it or pick a prebuilt voice.`)
    }
    if (bad.some((t) => !t.startsWith('@voice'))) errors.push('Speech scripts can only reference @voiceN.')
  }
  if (bad.length) errors.push(`${bad.join(', ')} ${bad.length > 1 ? 'point' : 'points'} at media that is not attached.`)
  if (!req.prompt.trim() && mode === 'create' && !refs.firstFrame) errors.push('Write a prompt.')
  if (model.provider.startsWith('openrouter') && !openrouter.openRouterKey()) errors.push('OPENROUTER_API_KEY is not set - add it to .env.local and restart.')
  if (errors.length) throw new ValidationError(errors.join(' '))

  // Edits stay plain (short prompts edit best); everything else carries the project's directives.
  const project = db.projects.find((p) => p.id === projectId)
  const directives = mode === 'edit' ? {} : effectiveDirectives(project?.defaults, req.directiveOverrides)

  const batchId = crypto.randomUUID()
  const now = new Date().toISOString()
  const per = estimateCost(model.id, { ...r.settings, count: 1 }, estimateSpeechSeconds(req.prompt), refs.images.length)
  const usedVoices = model.kind === 'audio' ? voices : voices.filter((v) => voiceTokens(req.prompt).includes(v.index))
  const gens: Generation[] = Array.from({ length: r.settings.count }, () => ({
    id: crypto.randomUUID(),
    batchId,
    createdAt: now,
    status: 'queued',
    kind: model.kind,
    projectId,
    model: model.id,
    settings: r.settings,
    prompt: req.prompt,
    // style / camera / avoid are picture directions - speech and music never carry them
    directives: model.kind === 'audio' || model.kind === 'music' ? {} : directives,
    ...(usedVoices.length ? { voices: usedVoices } : {}),
    refs,
    mode,
    parentId: parent()?.id,
    provider: {},
    cost: { estimatedUsd: per },
  }))
  db.generations.unshift(...gens)
  await persist()
  pump()
  return gens
}

/** Queues a Studio export: renders the timeline as it is now into a gallery video of the edit's project. */
export async function createStudioExport(edit: Edit): Promise<Generation> {
  const now = new Date().toISOString()
  const snapshot: Edit = structuredClone(edit)
  const g: Generation = {
    id: crypto.randomUUID(),
    batchId: crypto.randomUUID(),
    createdAt: now,
    status: 'queued',
    kind: 'video',
    projectId: edit.projectId,
    model: 'studio-edit',
    settings: { aspectRatio: edit.aspect, resolution: edit.resolution, duration: Math.round(timelineEnd(edit)), audio: true, count: 1, enhance: false },
    prompt: '',
    title: edit.name,
    refs: { images: [], videos: [] },
    mode: 'create',
    provider: {},
    cost: { estimatedUsd: 0 },
    studio: { editId: edit.id, edit: snapshot },
  }
  db.generations.unshift(g)
  await persist()
  pump()
  return g
}

export async function retry(gen: Generation) {
  if (gen.status === 'queued' || gen.status === 'running') return
  await removeFile(outputDir(gen), gen.file)
  await removeFile(outputDir(gen), gen.originalFile)
  await removeFile(DIRS.thumbs, gen.thumb)
  Object.assign(gen, {
    status: 'queued',
    error: undefined,
    phase: undefined,
    provider: {},
    file: undefined,
    originalFile: undefined,
    thumb: undefined,
    startedAt: undefined,
    finishedAt: undefined,
    cost: { estimatedUsd: gen.cost.estimatedUsd },
  } satisfies Partial<Generation>)
  await persist()
  pump()
}

export function pump() {
  const queued = db.generations.filter((g) => g.status === 'queued' && !running.has(g.id)).reverse()
  for (const g of queued) {
    if (running.size >= MAX_CONCURRENT) break
    void run(g)
  }
}

/** Called once at startup: resumes polling of jobs that already reached Google. */
export function resume() {
  for (const g of db.generations) {
    if (g.status !== 'running') continue
    // photos and music run as one synchronous call - nothing to resume
    const resumable = g.kind !== 'image' && g.kind !== 'music' && ((g.provider.interactionId && !g.provider.sync) || g.provider.operationName || g.provider.openrouterJobId)
    if (resumable) void run(g)
    else {
      g.status = 'failed'
      g.phase = undefined
      g.error =
        g.model === 'studio-edit'
          ? 'Render interrupted by a server restart - press Retry.'
          : 'Interrupted by a server restart before the provider accepted the job - press Retry.'
    }
  }
  void persist()
  pump()
}

async function setPhase(g: Generation, phase: string) {
  g.phase = phase
  await persist()
}

async function prepare(g: Generation) {
  const provider = getModel(g.model).provider
  let text = g.prompt
  if (g.settings.enhance && g.prompt.trim()) {
    if (!g.enhancedPrompt) {
      await setPhase(g, 'enhancing prompt')
      try {
        g.enhancedPrompt = await enhancePrompt(g.model, g.prompt)
      } catch (e) {
        console.warn('[enhance] failed, using the prompt as typed:', errorMessage(e))
      }
    }
    text = g.enhancedPrompt ?? g.prompt
  }
  // Voices become words for the video models (no audio refs exist) - after Enhance, so it cannot drop them.
  text = describeVoiceTokens(text, g.voices ?? [])
  const compile = (t: string) =>
    provider === 'omni'
      ? omni.compileFor(g, t)
      : provider === 'nanobanana'
        ? nanobanana.compileFor(t)
        : provider === 'lyria'
          ? lyria.compileFor(g, t)
          : provider === 'openrouter'
            ? openrouter.compileFor(t)
            : provider === 'openrouter-image'
              ? openrouter.compileImageFor(g, t)
              : veo.compileFor(t)
  // CAMERA/STYLE join the scene before the compile, NEGATIVE goes last (see shared/directives.ts).
  // Veo also gets NEGATIVE as the negativePrompt parameter where it allows it (veo.ts).
  g.sentPrompt = composePrompt(text, g.directives ?? {}, { kind: g.kind, compile }).text
}

async function run(g: Generation) {
  running.add(g.id)
  const alive = () => db.generations.includes(g)
  try {
    if (g.status === 'queued') {
      g.status = 'running'
      g.startedAt = new Date().toISOString()
      await persist()
    }
    const provider = getModel(g.model).provider
    if (provider === 'studio') {
      if (!g.studio) throw new Error('This export has no timeline to render')
      await setPhase(g, 'rendering')
      await finalize(g, (out) =>
        renderEdit(g.studio!.edit, out, (p) => void setPhase(g, `rendering ${Math.round(p * 100)}%`), alive),
      )
    } else if (provider === 'tts') {
      g.sentPrompt = g.prompt
      const file = `${g.id}.m4a`
      const out = path.join(DIRS.audio, file)
      const usd = await tts.synthesize(g, out, (i, n) => setPhase(g, n > 1 ? `speaking ${i}/${n}` : 'speaking'))
      if (!isAlive(g)) return
      const p = await probe(out)
      Object.assign(g, {
        status: 'completed',
        phase: undefined,
        file,
        durationS: p.durationS,
        hasAudio: true,
        finishedAt: new Date().toISOString(),
        cost: { ...g.cost, actualUsd: usd ?? (p.durationS ? (getModel(g.model).pricePerAudioSecond ?? 0) * p.durationS : undefined) },
      } satisfies Partial<Generation>)
    } else if (provider === 'lyria') {
      await prepare(g)
      await setPhase(g, 'composing')
      const it = await lyria.generateMusic(g)
      if (!isAlive(g)) return
      g.provider.interactionId = it.id
      const { audio, lyrics } = lyria.extractMusic(it as Parameters<typeof lyria.extractMusic>[0])
      const file = `${g.id}${lyria.extensionFor(audio.mime_type)}`
      const out = path.join(DIRS.audio, file)
      await lyria.writeAudio(audio, out)
      const p = await probe(out)
      if (!p.hasAudio) throw new Error('The music file came back empty')
      const thumb = `${g.id}.jpg`
      await waveform(out, path.join(DIRS.thumbs, thumb))
      Object.assign(g, {
        status: 'completed',
        phase: undefined,
        file,
        thumb,
        lyrics,
        durationS: p.durationS,
        hasAudio: true,
        finishedAt: new Date().toISOString(),
        cost: { ...g.cost, actualUsd: getModel(g.model).pricePerRequest },
      } satisfies Partial<Generation>)
    } else if (provider === 'nanobanana') {
      await prepare(g)
      await setPhase(g, 'generating')
      const it = await nanobanana.generateImage(g)
      g.provider.interactionId = it.id
      const img = nanobanana.extractImage(it as Parameters<typeof nanobanana.extractImage>[0])
      await finalizeImage(g, img, nanobanana.costFromUsage(g.model, it.usage))
    } else if (provider === 'openrouter-image') {
      await prepare(g)
      await setPhase(g, g.refs.images.length || g.mode === 'edit' ? 'uploading refs' : 'generating')
      const img = await openrouter.generateImage(g)
      await finalizeImage(g, img, img.costUsd)
    } else if (provider === 'omni') {
      let it
      if (!g.provider.interactionId) {
        await prepare(g)
        const r = await omni.startOmni(g, (p) => setPhase(g, p))
        g.provider.interactionId = r.interactionId
        g.provider.sync = r.sync
        await persist()
        it = r.interaction
      }
      if (!it) {
        await setPhase(g, 'generating')
        it = await omni.pollOmni(g.provider.interactionId!, alive)
      }
      await setPhase(g, 'downloading')
      const video = omni.extractVideo(it as Parameters<typeof omni.extractVideo>[0])
      await finalize(g, (out) => omni.writeVideo(video, out), omni.costFromUsage(it.usage))
    } else if (provider === 'openrouter') {
      if (!g.provider.openrouterJobId) {
        await prepare(g)
        await setPhase(g, g.refs.videos.length || g.refs.images.length ? 'uploading refs' : 'sending')
        g.provider.openrouterJobId = await openrouter.startOpenRouter(g)
        await persist()
      }
      await setPhase(g, 'generating')
      const job = await openrouter.pollOpenRouter(g.provider.openrouterJobId, alive)
      await setPhase(g, 'downloading')
      await finalize(g, (out) => openrouter.downloadOpenRouter(job, out), openrouter.costOf(job))
    } else {
      if (!g.provider.operationName) {
        await prepare(g)
        await setPhase(g, 'sending')
        g.provider.operationName = await veo.startVeo(g)
        await persist()
      }
      await setPhase(g, 'generating')
      const r = await veo.pollVeo(g.provider.operationName, alive)
      await setPhase(g, 'downloading')
      g.provider.veoVideoUri = r.uri || undefined
      g.provider.veoVideoExpiresAt = r.uri ? new Date(Date.now() + 47 * 3600 * 1000).toISOString() : undefined
      await finalize(g, (out) => veo.downloadVeo(r, out))
    }
  } catch (e) {
    if (alive()) {
      g.status = 'failed'
      g.phase = undefined
      g.error = errorMessage(e)
      g.finishedAt = new Date().toISOString()
      console.error(`[job ${g.id}]`, g.error)
    }
  } finally {
    running.delete(g.id)
    if (alive()) await persist()
    pump()
  }
}

async function finalize(g: Generation, write: (out: string) => Promise<void>, actualUsd?: number) {
  if (!isAlive(g)) return
  const file = `${g.id}.mp4`
  const out = path.join(DIRS.videos, file)
  if (g.settings.audio) {
    await write(out)
  } else {
    const original = `${g.id}.orig.mp4`
    await write(path.join(DIRS.videos, original))
    await stripAudio(path.join(DIRS.videos, original), out)
    g.originalFile = original
  }
  const p = await probe(out)
  const thumb = `${g.id}.jpg`
  await thumbnail(out, path.join(DIRS.thumbs, thumb), Math.min(1, (p.durationS ?? 0) / 2))
  const size = (await fs.promises.stat(out)).size
  Object.assign(g, {
    status: 'completed',
    phase: undefined,
    file,
    thumb,
    durationS: p.durationS,
    width: p.width,
    height: p.height,
    hasAudio: p.hasAudio,
    finishedAt: new Date().toISOString(),
    cost: {
      ...g.cost,
      actualUsd: actualUsd ?? (p.durationS ? costOfSeconds(g.model, g.settings.resolution, p.durationS, g.settings.audio) : undefined),
    },
  } satisfies Partial<Generation>)
  if (!size) throw new Error('Downloaded video is empty')
}

async function finalizeImage(g: Generation, img: Parameters<typeof nanobanana.writeImage>[0], actualUsd?: number) {
  if (!isAlive(g)) return
  const file = `${g.id}${nanobanana.extensionFor(img.mime_type)}`
  const out = path.join(DIRS.images, file)
  await nanobanana.writeImage(img, out)
  const p = await probe(out)
  const thumb = `${g.id}.jpg`
  await thumbnail(out, path.join(DIRS.thumbs, thumb))
  Object.assign(g, {
    status: 'completed',
    phase: undefined,
    file,
    thumb,
    width: p.width,
    height: p.height,
    finishedAt: new Date().toISOString(),
    cost: { ...g.cost, actualUsd: actualUsd ?? g.cost.estimatedUsd },
  } satisfies Partial<Generation>)
}

function isAlive(g: Generation) {
  return db.generations.includes(g)
}
