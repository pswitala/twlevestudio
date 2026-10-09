import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { Router, type NextFunction, type Request, type Response } from 'express'
import multer from 'multer'
import { DIRECTIVE_KEYS } from '../shared/directives'
import { normalizeTags } from '../shared/tags'
import { LANGUAGES, PREBUILT_VOICES, type Voice } from '../shared/voices'
import { designVoice, deleteGoogleVoice } from './providers/tts'
import { openRouterKey } from './providers/openrouter'
import { DEFAULT_TTS_MODEL, MODELS, TTS_MODELS } from '../shared/models'
import { DEFAULT_PROJECT_ID, type CreateGenerationRequest, type Generation } from '../shared/types'
import { copyAsset, ingest } from './assets'
import { enhancePrompt } from './enhance'
import { DEFAULT_REFINE_MODEL, generateDefaults, listTextModels, refinePrompt, THINKING_LEVELS, type Thinking } from './refine'
import { apiKey, errorMessage } from './genai'
import { createGenerations, createStudioExport, retry, ValidationError } from './jobs'
import { importMedia } from './studio'
import { newEdit, normalizeEdit, type Edit } from '../shared/studio'
import { extractFrame } from './media'
import { DIRS, db, findAsset, findGeneration, outputDir, persist, removeFile } from './store'

const upload = multer({
  storage: multer.diskStorage({
    destination: DIRS.tmp,
    filename: (_req, _file, cb) => cb(null, crypto.randomUUID()),
  }),
  limits: { fileSize: 500 * 1024 * 1024 },
})

type Handler = (req: Request, res: Response) => Promise<unknown> | unknown
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve(fn(req, res)).catch(next)
}

const param = (req: Request, name: string) => String(req.params[name])

function needGeneration(req: Request, res: Response): Generation | undefined {
  const g = findGeneration(param(req, 'id'))
  if (!g) res.status(404).json({ error: 'Generation not found' })
  return g
}

export const api = Router()

api.get('/config', (_req, res) => {
  res.json({ hasKey: !!apiKey(), hasOpenRouterKey: !!openRouterKey(), models: MODELS })
})

// ---------- folders (sidebar grouping of projects) ----------
api.get('/folders', (_req, res) => {
  res.json(db.folders)
})

api.post(
  '/folders',
  h(async (req, res) => {
    const name = String(req.body.name ?? '').trim().slice(0, 60)
    if (!name) return res.status(400).json({ error: 'Name the folder' })
    const f = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.folders.push(f)
    await persist()
    res.json(f)
  }),
)

api.patch(
  '/folders/:id',
  h(async (req, res) => {
    const f = db.folders.find((x) => x.id === param(req, 'id'))
    if (!f) return res.status(404).json({ error: 'Folder not found' })
    const name = String(req.body.name ?? '').trim().slice(0, 60)
    if (name) f.name = name
    await persist()
    res.json(f)
  }),
)

/** Deleting a folder never touches projects: they go back to the top level. */
api.delete(
  '/folders/:id',
  h(async (req, res) => {
    const id = param(req, 'id')
    const i = db.folders.findIndex((x) => x.id === id)
    if (i < 0) return res.status(404).json({ error: 'Folder not found' })
    db.folders.splice(i, 1)
    let moved = 0
    for (const p of db.projects) {
      if (p.folderId === id) {
        delete p.folderId
        moved++
      }
    }
    await persist()
    res.json({ ok: true, moved })
  }),
)

/** Saves the folder order: `ids` top to bottom. */
api.post(
  '/folders/reorder',
  h(async (req, res) => {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids.map(String) : []
    ids.forEach((id, i) => {
      const f = db.folders.find((x) => x.id === id)
      if (f) f.order = i
    })
    await persist()
    res.json(db.folders)
  }),
)

// ---------- projects ----------
const projectExists = (id: unknown) => typeof id === 'string' && db.projects.some((p) => p.id === id)

api.get('/projects', (_req, res) => {
  res.json(db.projects)
})

api.post(
  '/projects',
  h(async (req, res) => {
    const name = String(req.body.name ?? '').trim().slice(0, 60)
    if (!name) return res.status(400).json({ error: 'Name the project' })
    const p = { id: crypto.randomUUID(), name, createdAt: new Date().toISOString() }
    db.projects.push(p)
    await persist()
    res.json(p)
  }),
)

api.patch(
  '/projects/:id',
  h(async (req, res) => {
    const p = db.projects.find((x) => x.id === param(req, 'id'))
    if (!p) return res.status(404).json({ error: 'Project not found' })
    const name = String(req.body.name ?? '').trim().slice(0, 60)
    if (name) p.name = name
    // folderId: a folder id moves the project into it, null takes it back to the top level
    if (req.body.folderId === null) delete p.folderId
    else if (typeof req.body.folderId === 'string') {
      if (!db.folders.some((f) => f.id === req.body.folderId)) return res.status(400).json({ error: 'Folder not found' })
      p.folderId = req.body.folderId
    }
    if (req.body.defaults && typeof req.body.defaults === 'object') {
      const d = req.body.defaults as Record<string, unknown>
      p.defaults = {}
      for (const k of DIRECTIVE_KEYS) {
        const v = typeof d[k] === 'string' ? (d[k] as string).trim().slice(0, 1000) : ''
        if (v) p.defaults[k] = v
      }
    }
    await persist()
    res.json(p)
  }),
)

/**
 * Puts `ids` (top to bottom) into a folder (`folderId`, null = top level) in that order -
 * one call for both "reorder" and "move into a folder at this position".
 */
api.post(
  '/projects/reorder',
  h(async (req, res) => {
    const ids: string[] = Array.isArray(req.body.ids) ? req.body.ids.map(String) : []
    const folderId = req.body.folderId ?? null
    if (folderId !== null && !db.folders.some((f) => f.id === folderId)) return res.status(400).json({ error: 'Folder not found' })
    ids.forEach((id, i) => {
      const p = db.projects.find((x) => x.id === id)
      if (!p) return
      p.order = i
      if (folderId) p.folderId = folderId
      else delete p.folderId
    })
    await persist()
    res.json(db.projects)
  }),
)

/** Deleting a project never deletes media: its videos, photos and refs move to Default. */
api.delete(
  '/projects/:id',
  h(async (req, res) => {
    const id = param(req, 'id')
    if (id === DEFAULT_PROJECT_ID) return res.status(409).json({ error: 'The Default project cannot be deleted' })
    const i = db.projects.findIndex((x) => x.id === id)
    if (i < 0) return res.status(404).json({ error: 'Project not found' })
    db.projects.splice(i, 1)
    let moved = 0
    for (const x of [...db.generations, ...db.assets, ...db.voices, ...db.edits, ...db.media]) {
      if (x.projectId === id) {
        x.projectId = DEFAULT_PROJECT_ID
        moved++
      }
    }
    await persist()
    res.json({ ok: true, moved })
  }),
)

// ---------- voices ----------
function readVoiceBody(body: Record<string, unknown>, v: Partial<Voice>) {
  if (typeof body.name === 'string' && body.name.trim()) v.name = body.name.trim().slice(0, 40)
  if (typeof body.description === 'string') v.description = body.description.trim().slice(0, 600)
  if (typeof body.language === 'string' && LANGUAGES.some((l) => l.code === body.language)) v.language = body.language
  if (body.gender === 'female' || body.gender === 'male') v.gender = body.gender
  if (body.gender === '') v.gender = undefined
  if (typeof body.model === 'string' && TTS_MODELS.some((m) => m.id === body.model)) v.model = body.model
  if (typeof body.prebuilt === 'string') v.prebuilt = PREBUILT_VOICES.some((p) => p.name === body.prebuilt) ? body.prebuilt : undefined
  if (Array.isArray(body.tags)) v.tags = normalizeTags(body.tags)
}

/** A copied voice shares its Google voice - only drop it on Google's side when no copy still uses it. */
function releaseGoogleVoice(googleVoiceId: string | undefined, except?: Voice) {
  if (!googleVoiceId) return
  if (db.voices.some((x) => x !== except && x.googleVoiceId === googleVoiceId)) return
  void deleteGoogleVoice(googleVoiceId)
}

/** Runs Voice design and keeps the result; a failure is stored on the voice instead of thrown. */
async function design(v: Voice) {
  const old = v.googleVoiceId
  try {
    const r = await designVoice(v)
    if (v.sampleFile) await removeFile(DIRS.voices, v.sampleFile)
    Object.assign(v, { googleVoiceId: r.googleVoiceId, sampleFile: r.sampleFile, designedFrom: v.description, error: undefined })
    if (old && old !== r.googleVoiceId) releaseGoogleVoice(old, v)
  } catch (e) {
    v.error = errorMessage(e)
  }
  await persist()
}

api.get('/voices', (_req, res) => {
  res.json({ voices: db.voices, prebuilt: PREBUILT_VOICES, languages: LANGUAGES })
})

api.post(
  '/voices',
  h(async (req, res) => {
    const v: Voice = {
      id: crypto.randomUUID(),
      projectId: projectExists(req.body.projectId) ? req.body.projectId : DEFAULT_PROJECT_ID,
      name: 'Voice',
      description: '',
      language: 'pl-PL',
      model: DEFAULT_TTS_MODEL,
      createdAt: new Date().toISOString(),
    }
    readVoiceBody(req.body, v)
    if (!v.description && !v.prebuilt) return res.status(400).json({ error: 'Describe the voice or pick a prebuilt one' })
    db.voices.push(v)
    await persist()
    if (v.description && req.body.design !== false) await design(v)
    res.json(v)
  }),
)

api.patch(
  '/voices/:id',
  h(async (req, res) => {
    const v = db.voices.find((x) => x.id === param(req, 'id'))
    if (!v) return res.status(404).json({ error: 'Voice not found' })
    readVoiceBody(req.body, v)
    if (projectExists(req.body.projectId)) v.projectId = req.body.projectId
    await persist()
    res.json(v)
  }),
)

/** (Re)creates the Google voice from the current description. */
api.post(
  '/voices/:id/design',
  h(async (req, res) => {
    const v = db.voices.find((x) => x.id === param(req, 'id'))
    if (!v) return res.status(404).json({ error: 'Voice not found' })
    if (!v.description) return res.status(400).json({ error: 'Describe the voice first' })
    await design(v)
    res.json(v)
  }),
)

api.delete(
  '/voices/:id',
  h(async (req, res) => {
    const v = db.voices.find((x) => x.id === param(req, 'id'))
    if (!v) return res.status(404).json({ error: 'Voice not found' })
    db.voices.splice(db.voices.indexOf(v), 1)
    await persist()
    if (!db.voices.some((x) => x.sampleFile === v.sampleFile)) await removeFile(DIRS.voices, v.sampleFile)
    releaseGoogleVoice(v.googleVoiceId)
    res.json({ ok: true })
  }),
)

/**
 * Bulk copy / move of voices to another project. A copy shares the designed Google voice and gets its own
 * sample file; it is added at the end of the target's @voiceN list (a move keeps its creation time, so it
 * may land between existing voices - the client warns that numbers shift).
 */
api.post(
  '/voices/transfer',
  h(async (req, res) => {
    const { ids, projectId, mode } = req.body as { ids?: unknown; projectId?: unknown; mode?: unknown }
    if (!projectExists(projectId)) return res.status(400).json({ error: 'Pick a target project' })
    if (mode !== 'copy' && mode !== 'move') return res.status(400).json({ error: 'mode must be copy or move' })
    let done = 0
    let skipped = 0
    for (const id of Array.isArray(ids) ? ids.map(String) : []) {
      const v = db.voices.find((x) => x.id === id)
      if (!v) continue
      if (v.projectId === projectId) {
        skipped++
        continue
      }
      if (mode === 'move') v.projectId = projectId as string
      else {
        const copy: Voice = { ...v, id: crypto.randomUUID(), projectId: projectId as string, tags: v.tags ? [...v.tags] : undefined, createdAt: new Date().toISOString() }
        if (v.sampleFile) {
          copy.sampleFile = `${copy.id}-${Date.now()}.wav`
          await fs.promises.copyFile(path.join(DIRS.voices, v.sampleFile), path.join(DIRS.voices, copy.sampleFile))
        }
        db.voices.push(copy)
      }
      done++
    }
    await persist()
    res.json({ done, skipped })
  }),
)

// ---------- assets ----------
api.get('/assets', (req, res) => {
  const kind = req.query.kind
  res.json(kind ? db.assets.filter((a) => a.kind === kind) : db.assets)
})

api.post(
  '/assets',
  upload.array('files', 20),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? []
    if (!files.length) return res.status(400).json({ error: 'No files' })
    const trimStart = Number(req.body.trimStart ?? 0) || 0
    const source = req.body.source === 'paste' ? 'paste' : 'upload'
    const projectId = projectExists(req.body.projectId) ? req.body.projectId : DEFAULT_PROJECT_ID
    const out = []
    for (const f of files) {
      out.push(await ingest(f.path, { originalName: f.originalname, mime: f.mimetype, source, trimStart, projectId }))
    }
    res.json(out)
  }),
)

api.patch(
  '/assets/:id',
  h(async (req, res) => {
    const a = findAsset(param(req, 'id'))
    if (!a) return res.status(404).json({ error: 'Asset not found' })
    if (typeof req.body.label === 'string') a.label = req.body.label.slice(0, 80)
    if (projectExists(req.body.projectId)) a.projectId = req.body.projectId
    if (Array.isArray(req.body.tags)) a.tags = normalizeTags(req.body.tags)
    await persist()
    res.json(a)
  }),
)

api.delete(
  '/assets/:id',
  h(async (req, res) => {
    const a = findAsset(param(req, 'id'))
    if (!a) return res.status(404).json({ error: 'Asset not found' })
    const usedBy = db.generations.filter((g) =>
      [g.refs.firstFrame, g.refs.lastFrame, ...g.refs.images, ...g.refs.videos].includes(a.id),
    ).length
    if (usedBy && req.query.force !== '1') {
      return res.status(409).json({ error: `Used by ${usedBy} generation(s) - delete anyway?`, usedBy })
    }
    db.assets.splice(db.assets.indexOf(a), 1)
    await persist()
    await removeFile(DIRS.assets, a.file)
    await removeFile(DIRS.thumbs, a.thumb)
    res.json({ ok: true })
  }),
)

/** Bulk copy / move of library files to another project. */
api.post(
  '/assets/transfer',
  h(async (req, res) => {
    const { ids, projectId, mode } = req.body as { ids?: unknown; projectId?: unknown; mode?: unknown }
    if (!projectExists(projectId)) return res.status(400).json({ error: 'Pick a target project' })
    if (mode !== 'copy' && mode !== 'move') return res.status(400).json({ error: 'mode must be copy or move' })
    const list = (Array.isArray(ids) ? ids : []).map((id) => findAsset(String(id))).filter(Boolean) as NonNullable<ReturnType<typeof findAsset>>[]
    if (!list.length) return res.status(400).json({ error: 'Nothing selected' })
    let done = 0
    let skipped = 0
    for (const a of list) {
      if ((a.projectId ?? DEFAULT_PROJECT_ID) === projectId) {
        skipped++
        continue
      }
      if (mode === 'move') {
        a.projectId = projectId as string
        done++
      } else {
        const r = await copyAsset(a, projectId as string)
        if (r.created) done++
        else skipped++
      }
    }
    await persist()
    res.json({ done, skipped })
  }),
)

/**
 * Bulk copy / move of generations (videos, photos, speech) to another project. A copy is an independent
 * record with its own files; it keeps the prompt, settings and result, and is never "running".
 */
api.post(
  '/generations/transfer',
  h(async (req, res) => {
    const { ids, projectId, mode } = req.body as { ids?: unknown; projectId?: unknown; mode?: unknown }
    if (!projectExists(projectId)) return res.status(400).json({ error: 'Pick a target project' })
    if (mode !== 'copy' && mode !== 'move') return res.status(400).json({ error: 'mode must be copy or move' })
    let done = 0
    let skipped = 0
    for (const id of Array.isArray(ids) ? ids.map(String) : []) {
      const g = findGeneration(id)
      if (!g) continue
      if ((g.projectId ?? DEFAULT_PROJECT_ID) === projectId || (mode === 'copy' && g.status !== 'completed')) {
        skipped++
        continue
      }
      if (mode === 'move') g.projectId = projectId as string
      else {
        const nid = crypto.randomUUID()
        const dup = async (dir: string, name?: string) => {
          if (!name) return undefined
          const next = name.replace(g.id, nid) === name ? `${nid}-${name}` : name.replace(g.id, nid)
          await fs.promises.copyFile(path.join(dir, name), path.join(dir, next))
          return next
        }
        const copy = structuredClone(g)
        Object.assign(copy, {
          id: nid,
          batchId: crypto.randomUUID(),
          projectId: projectId as string,
          parentId: undefined,
          file: await dup(outputDir(g), g.file),
          originalFile: await dup(outputDir(g), g.originalFile),
          thumb: await dup(DIRS.thumbs, g.thumb),
          favorite: undefined,
        })
        db.generations.unshift(copy)
      }
      done++
    }
    await persist()
    res.json({ done, skipped })
  }),
)

// ---------- generations ----------
api.get('/generations', (_req, res) => {
  res.json(db.generations)
})

api.post(
  '/generations',
  h(async (req, res) => {
    try {
      res.json(await createGenerations(req.body as CreateGenerationRequest))
    } catch (e) {
      if (e instanceof ValidationError) return res.status(400).json({ error: e.message })
      throw e
    }
  }),
)

api.patch(
  '/generations/:id',
  h(async (req, res) => {
    const g = needGeneration(req, res)
    if (!g) return
    if (typeof req.body.favorite === 'boolean') g.favorite = req.body.favorite
    if (typeof req.body.title === 'string') g.title = req.body.title.slice(0, 120) || undefined
    if (projectExists(req.body.projectId)) g.projectId = req.body.projectId
    if (Array.isArray(req.body.tags)) g.tags = normalizeTags(req.body.tags)
    await persist()
    res.json(g)
  }),
)

api.delete(
  '/generations/:id',
  h(async (req, res) => {
    const g = needGeneration(req, res)
    if (!g) return
    db.generations.splice(db.generations.indexOf(g), 1)
    await persist()
    await removeFile(outputDir(g), g.file)
    await removeFile(outputDir(g), g.originalFile)
    await removeFile(DIRS.thumbs, g.thumb)
    res.json({ ok: true })
  }),
)

api.post(
  '/generations/:id/retry',
  h(async (req, res) => {
    const g = needGeneration(req, res)
    if (!g) return
    await retry(g)
    res.json(g)
  }),
)

/** Grabs a frame of a generated video as a new image asset ("use as start frame"). */
api.post(
  '/generations/:id/frame',
  h(async (req, res) => {
    const g = needGeneration(req, res)
    if (!g?.file) return g && res.status(409).json({ error: 'Video not ready' })
    if (g.kind === 'image') {
      const tmp = path.join(DIRS.tmp, crypto.randomUUID())
      await fs.promises.copyFile(path.join(DIRS.images, g.file), tmp)
      const label = g.title || g.prompt.slice(0, 40) || 'photo'
      return res.json(
        await ingest(tmp, { originalName: g.file, mime: 'image/png', source: 'generation', fromGenerationId: g.id, label, projectId: g.projectId }),
      )
    }
    const at = req.body.at === 'last' ? 'last' : Number(req.body.at) || 0
    const tmp = path.join(DIRS.tmp, `${crypto.randomUUID()}.png`)
    await extractFrame(path.join(DIRS.videos, g.file), at, tmp)
    const label = `${g.title || 'frame'} @ ${at === 'last' ? 'end' : `${at.toFixed(1)}s`}`
    res.json(
      await ingest(tmp, { originalName: 'frame.png', mime: 'image/png', source: 'frame', fromGenerationId: g.id, label, projectId: g.projectId }),
    )
  }),
)

/** Copies a 3 s window of a generated video into the library as a video ref. */
api.post(
  '/generations/:id/to-asset',
  h(async (req, res) => {
    const g = needGeneration(req, res)
    if (!g?.file) return g && res.status(409).json({ error: 'Video not ready' })
    if (g.kind === 'image') return res.status(400).json({ error: 'Use /frame for photos' })
    const tmp = path.join(DIRS.tmp, crypto.randomUUID())
    await fs.promises.copyFile(path.join(DIRS.videos, g.file), tmp)
    const asset = await ingest(tmp, {
      originalName: 'clip.mp4',
      mime: 'video/mp4',
      source: 'generation',
      fromGenerationId: g.id,
      trimStart: Number(req.body.trimStart) || 0,
      label: g.title || g.prompt.slice(0, 40) || 'clip',
      projectId: g.projectId,
    })
    res.json(asset)
  }),
)

// ---------- prompts ----------
api.post(
  '/enhance',
  h(async (req, res) => {
    res.json({ prompt: await enhancePrompt(String(req.body.model), String(req.body.prompt ?? '')) })
  }),
)

/** AI prompt doctor: rewrites the prompt to fix a problem the user saw in the result. */
api.post(
  '/refine',
  h(async (req, res) => {
    const problem = String(req.body.problem ?? '').trim()
    if (!problem) return res.status(400).json({ error: 'Describe what to fix' })
    const prompt = await refinePrompt({
      targetModel: String(req.body.targetModel),
      prompt: String(req.body.prompt ?? ''),
      problem,
      directives: req.body.directives,
      model: req.body.model ? String(req.body.model) : undefined,
      thinking: req.body.thinking as Thinking,
    })
    res.json({ prompt })
  }),
)

/** AI proposal for a project's style / camera / avoid; revises the current values when there are any. */
api.post(
  '/defaults-ai',
  h(async (req, res) => {
    const brief = String(req.body.brief ?? '').trim()
    if (!brief) return res.status(400).json({ error: 'Describe what you want to film' })
    res.json(
      await generateDefaults({
        brief,
        current: req.body.current,
        model: req.body.model ? String(req.body.model) : undefined,
        thinking: req.body.thinking as Thinking,
      }),
    )
  }),
)

api.get(
  '/text-models',
  h(async (_req, res) => {
    let models: string[] = []
    try {
      models = await listTextModels()
    } catch (e) {
      console.warn('[refine] model list failed:', errorMessage(e))
    }
    if (!models.includes(DEFAULT_REFINE_MODEL)) models.unshift(DEFAULT_REFINE_MODEL)
    res.json({ models, default: DEFAULT_REFINE_MODEL, thinking: THINKING_LEVELS })
  }),
)

api.get('/prompts', (_req, res) => {
  res.json(db.prompts)
})

api.post(
  '/prompts',
  h(async (req, res) => {
    const text = String(req.body.text ?? '').trim()
    if (!text) return res.status(400).json({ error: 'Empty prompt' })
    const existing = db.prompts.find((p) => p.text === text)
    if (existing) return res.json(existing)
    const p = { id: crypto.randomUUID(), text, createdAt: new Date().toISOString() }
    db.prompts.unshift(p)
    await persist()
    res.json(p)
  }),
)

api.delete(
  '/prompts/:id',
  h(async (req, res) => {
    db.prompts = db.prompts.filter((p) => p.id !== param(req, 'id'))
    await persist()
    res.json({ ok: true })
  }),
)

// ---------- studio: timelines ("edits") and imported media ----------
function needEdit(req: Request, res: Response): Edit | undefined {
  const e = db.edits.find((x) => x.id === param(req, 'id'))
  if (!e) res.status(404).json({ error: 'Edit not found' })
  return e
}

api.get('/edits', (_req, res) => {
  res.json(db.edits)
})

api.post(
  '/edits',
  h(async (req, res) => {
    const projectId = projectExists(req.body.projectId) ? req.body.projectId : DEFAULT_PROJECT_ID
    const name = String(req.body.name ?? '').trim().slice(0, 80) || `Edit ${db.edits.filter((e) => e.projectId === projectId).length + 1}`
    const e = newEdit(crypto.randomUUID(), projectId, name)
    db.edits.unshift(e)
    await persist()
    res.json(e)
  }),
)

/** Saves the whole timeline (the editor autosaves); also renames and moves between projects. */
api.put(
  '/edits/:id',
  h(async (req, res) => {
    const e = needEdit(req, res)
    if (!e) return
    const next = normalizeEdit(req.body ?? {}, e)
    if (projectExists(req.body.projectId)) next.projectId = req.body.projectId
    next.updatedAt = new Date().toISOString()
    db.edits[db.edits.indexOf(e)] = next
    await persist()
    res.json(next)
  }),
)

api.post(
  '/edits/:id/duplicate',
  h(async (req, res) => {
    const e = needEdit(req, res)
    if (!e) return
    const now = new Date().toISOString()
    const copy: Edit = { ...structuredClone(e), id: crypto.randomUUID(), name: `${e.name} (copy)`.slice(0, 80), createdAt: now, updatedAt: now }
    db.edits.unshift(copy)
    await persist()
    res.json(copy)
  }),
)

/** Deletes the timeline only - its clips' sources and earlier exports stay. */
api.delete(
  '/edits/:id',
  h(async (req, res) => {
    const e = needEdit(req, res)
    if (!e) return
    db.edits.splice(db.edits.indexOf(e), 1)
    await persist()
    res.json({ ok: true })
  }),
)

/** Renders the timeline into a new gallery video (a queued job like any generation). */
api.post(
  '/edits/:id/export',
  h(async (req, res) => {
    const e = needEdit(req, res)
    if (!e) return
    if (!e.clips.length) return res.status(400).json({ error: 'The timeline is empty - put some clips on it first.' })
    res.json(await createStudioExport(e))
  }),
)

api.get('/studio/media', (_req, res) => {
  res.json(db.media)
})

api.post(
  '/studio/media',
  upload.array('files', 20),
  h(async (req, res) => {
    const files = (req.files as Express.Multer.File[]) ?? []
    if (!files.length) return res.status(400).json({ error: 'No files' })
    const projectId = projectExists(req.body.projectId) ? req.body.projectId : DEFAULT_PROJECT_ID
    const out = []
    const errors: string[] = []
    for (const f of files) {
      try {
        out.push(await importMedia(f.path, f.originalname, f.mimetype, projectId))
      } catch (e) {
        errors.push(errorMessage(e))
      }
    }
    if (!out.length) return res.status(400).json({ error: errors.join(' · ') || 'Nothing imported' })
    res.json({ media: out, errors })
  }),
)

api.patch(
  '/studio/media/:id',
  h(async (req, res) => {
    const m = db.media.find((x) => x.id === param(req, 'id'))
    if (!m) return res.status(404).json({ error: 'Media not found' })
    if (typeof req.body.label === 'string' && req.body.label.trim()) m.label = req.body.label.trim().slice(0, 80)
    if (projectExists(req.body.projectId)) m.projectId = req.body.projectId
    await persist()
    res.json(m)
  }),
)

api.delete(
  '/studio/media/:id',
  h(async (req, res) => {
    const m = db.media.find((x) => x.id === param(req, 'id'))
    if (!m) return res.status(404).json({ error: 'Media not found' })
    db.media.splice(db.media.indexOf(m), 1)
    await persist()
    await removeFile(DIRS.studio, m.file)
    await removeFile(DIRS.thumbs, m.thumb)
    res.json({ ok: true })
  }),
)

api.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const msg = errorMessage(err)
  console.error('[api]', msg)
  res.status(500).json({ error: msg })
})
