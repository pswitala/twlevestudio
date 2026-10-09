import fs from 'node:fs'
import path from 'node:path'
import { DEFAULT_PROJECT_ID, type Asset, type Folder, type Generation, type Project, type SavedPrompt } from '../shared/types'
import type { Voice } from '../shared/voices'
import type { Edit, StudioMedia } from '../shared/studio'

export const ROOT = path.resolve(import.meta.dirname, '..')
export const DATA = path.join(ROOT, 'data')
export const DIRS = {
  videos: path.join(DATA, 'videos'),
  images: path.join(DATA, 'images'),
  audio: path.join(DATA, 'audio'),
  voices: path.join(DATA, 'voices'),
  assets: path.join(DATA, 'assets'),
  thumbs: path.join(DATA, 'thumbs'),
  tmp: path.join(DATA, 'tmp'),
  /** Studio imports: full-length footage, music, voice-over */
  studio: path.join(DATA, 'studio'),
}
for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true })

const DB_FILE = path.join(DATA, 'library.json')

interface Db {
  folders: Folder[]
  projects: Project[]
  assets: Asset[]
  generations: Generation[]
  prompts: SavedPrompt[]
  voices: Voice[]
  /** Studio timelines */
  edits: Edit[]
  /** Studio imports */
  media: StudioMedia[]
}

function load(): Db {
  try {
    const raw = JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) as Partial<Db>
    return migrate({
      folders: raw.folders ?? [],
      projects: raw.projects ?? [],
      assets: raw.assets ?? [],
      generations: raw.generations ?? [],
      prompts: raw.prompts ?? [],
      voices: raw.voices ?? [],
      edits: raw.edits ?? [],
      media: raw.media ?? [],
    })
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    return migrate({ folders: [], projects: [], assets: [], generations: [], prompts: [], voices: [], edits: [], media: [] })
  }
}

/** Every item belongs to a project; records from before projects existed land in "Default". */
function migrate(d: Db): Db {
  if (!d.projects.some((p) => p.id === DEFAULT_PROJECT_ID)) {
    d.projects.unshift({ id: DEFAULT_PROJECT_ID, name: 'Default', createdAt: new Date().toISOString() })
  }
  const known = new Set(d.projects.map((p) => p.id))
  for (const x of [...d.assets, ...d.generations, ...d.voices, ...d.edits, ...d.media]) if (!x.projectId || !known.has(x.projectId)) x.projectId = DEFAULT_PROJECT_ID
  for (const g of d.generations) g.kind ??= 'video'
  const folders = new Set(d.folders.map((f) => f.id))
  for (const p of d.projects) if (p.folderId && !folders.has(p.folderId)) delete p.folderId
  return d
}

export const db: Db = load()

/** Directory holding a generation's output file. */
export function outputDir(g: Generation): string {
  return g.kind === 'image' ? DIRS.images : g.kind === 'audio' || g.kind === 'music' ? DIRS.audio : DIRS.videos
}

let chain: Promise<void> = Promise.resolve()

/** Writes the whole library atomically (tmp + rename); calls are serialised. */
export function persist(): Promise<void> {
  chain = chain.then(async () => {
    const tmp = `${DB_FILE}.tmp`
    await fs.promises.writeFile(tmp, JSON.stringify(db, null, 1))
    await fs.promises.rename(tmp, DB_FILE)
  })
  return chain
}

export function findGeneration(id: string): Generation | undefined {
  return db.generations.find((g) => g.id === id)
}

/** A project's voices in @voiceN order (creation order). */
export function projectVoices(projectId: string): Voice[] {
  return db.voices.filter((v) => v.projectId === projectId).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function findAsset(id: string): Asset | undefined {
  return db.assets.find((a) => a.id === id)
}

export async function removeFile(dir: string, name?: string) {
  if (!name) return
  await fs.promises.rm(path.join(dir, name), { force: true })
}
