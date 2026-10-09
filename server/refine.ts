import { ThinkingLevel } from '@google/genai'
import { getModel } from '../shared/models'
import type { Directives } from '../shared/directives'
import { apiKey, ai } from './genai'
import { MODEL_GUIDE } from './enhance'

export const DEFAULT_REFINE_MODEL = 'gemini-3.8-flash'
export const THINKING_LEVELS = ['minimal', 'low', 'medium', 'high'] as const
export type Thinking = (typeof THINKING_LEVELS)[number]

const SYSTEM = `You are a prompt doctor for AI video and image generation.
You get the CURRENT PROMPT the user already generated with, and a PROBLEM the user saw in the result (often in Polish).
Rewrite the prompt so the next generation fixes that problem.

How to fix:
- Describe the problematic action as an explicit, physically precise step-by-step sequence: which hand, which object,
  where it starts and ends, what is visible to the camera, how long each step takes. Prefer timecodes ("[2-4s] ...")
  when the order of actions matters.
- State the correct outcome positively ("she slides the phone fully into the right front pocket of her jeans;
  the phone disappears completely, the pocket bulges slightly") and, where useful, add one short "Do not ..." sentence
  for the wrong outcome the user described.
- Keep everything that was not part of the problem exactly as it was: scene, subjects, wardrobe, setting, timing,
  dialogue, camera, structure and section labels (SCENE:, DIALOG:, TIMING: ...).

Hard rules:
- Output ONLY the full rewritten prompt. No preamble, no explanation, no markdown fences.
- Keep every token that starts with @ (@img1, @vid2, @voice1, @start, @end ...) EXACTLY as written and where it belongs.
- Keep quoted dialogue / on-screen text word for word in its original language. Never translate it.
- Write all descriptive text in English (the models are tuned for it), even if the current prompt is partly in Polish.
- Do NOT add STYLE:, CAMERA: or NEGATIVE: sections - the app appends the project's own (listed below for context);
  do not contradict them.
- Do not invent new characters, brands or story beats.`

/** Text models usable for refining (generateContent, not media/tts/embedding), cached for 10 min. */
let cache: { at: number; models: string[] } | undefined
export async function listTextModels(): Promise<string[]> {
  if (cache && Date.now() - cache.at < 10 * 60 * 1000) return cache.models
  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey() ?? '' },
  })
  if (!res.ok) throw new Error(`Listing models failed: HTTP ${res.status}`)
  const j = (await res.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
  const models = (j.models ?? [])
    .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini-/.test(n) && !/image|banana|tts|omni|embedding|veo|audio|live|transcribe|robotics|computer-use|customtools/.test(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
  cache = { at: Date.now(), models }
  return models
}

export async function refinePrompt(opts: {
  targetModel: string
  prompt: string
  problem: string
  directives?: Directives
  model?: string
  thinking?: Thinking
}): Promise<string> {
  const target = getModel(opts.targetModel)
  const model = opts.model && /^gemini-[\w.-]+$/.test(opts.model) ? opts.model : DEFAULT_REFINE_MODEL
  const thinking = THINKING_LEVELS.includes(opts.thinking as Thinking) ? (opts.thinking as Thinking) : 'high'
  const d = opts.directives ?? {}
  const context = [
    `TARGET MODEL: ${target.label} (${target.kind})`,
    MODEL_GUIDE[target.provider] ?? '',
    d.style || d.camera || d.negative
      ? `PROJECT DIRECTIVES the app appends on its own (context only):\n${[d.style && `STYLE: ${d.style}`, d.camera && `CAMERA: ${d.camera}`, d.negative && `NEGATIVE: ${d.negative}`].filter(Boolean).join('\n')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const res = await ai().models.generateContent({
    model,
    contents: `${context}\n\nCURRENT PROMPT:\n${opts.prompt.trim() || '(empty - write a new prompt from the problem description)'}\n\nPROBLEM TO FIX:\n${opts.problem.trim()}`,
    config: {
      systemInstruction: SYSTEM,
      thinkingConfig: { thinkingLevel: thinking.toUpperCase() as ThinkingLevel },
    },
  })
  const text = res.text?.trim().replace(/^```\w*\n?|\n?```$/g, '').trim()
  if (!text) throw new Error('The model returned no prompt')
  return text
}

const DEFAULTS_SYSTEM = `You write a project's default STYLE, CAMERA and NEGATIVE (things to avoid) for AI video and photo generation
(Gemini Omni / Veo / Nano Banana). They are appended to every prompt of the project, so they must describe the LOOK,
not a specific scene or story.

Fields:
- style: one or two sentences, max ~60 words - medium/look (e.g. phone footage, cinematic, documentary), light, colour,
  texture/grain, level of polish, overall realism.
- camera: one or two sentences, max ~45 words - how it is filmed: handheld/static/gimbal, framing, height, movement,
  lens feel, cuts. Concrete and physical.
- negative: a comma-separated list of SHORT noun phrases (max ~30 items) of what must not appear or happen
  (e.g. "on-screen text, logos, studio lighting, slow motion").

Each field separately:
- If CURRENT for that field is empty, write it fresh from the brief.
- If CURRENT has text, revise it with the brief: keep what still fits, change or add what the brief asks, drop what
  contradicts it. Do not rewrite for the sake of it.

Rules:
- English only (the user may write the brief in Polish).
- Never put gore, injury, blood, wounds, weapons, nudity or "deformed / mutilated" wording in any field, not even as
  something to avoid - Google's input filter blocks prompts that contain such words. Prefer neutral phrasing
  ("anatomically correct horses" instead of "deformed limbs").
- No @tokens, no dialogue, no subject-specific story beats.`

export async function generateDefaults(opts: {
  brief: string
  current?: Directives
  model?: string
  thinking?: Thinking
}): Promise<Required<Pick<Directives, 'style' | 'camera' | 'negative'>>> {
  const model = opts.model && /^gemini-[\w.-]+$/.test(opts.model) ? opts.model : DEFAULT_REFINE_MODEL
  const thinking = THINKING_LEVELS.includes(opts.thinking as Thinking) ? (opts.thinking as Thinking) : 'high'
  const c = opts.current ?? {}
  const res = await ai().models.generateContent({
    model,
    contents: `BRIEF (what the user wants to film):\n${opts.brief.trim()}\n\nCURRENT style:\n${c.style?.trim() || '(empty)'}\n\nCURRENT camera:\n${c.camera?.trim() || '(empty)'}\n\nCURRENT negative:\n${c.negative?.trim() || '(empty)'}`,
    config: {
      systemInstruction: DEFAULTS_SYSTEM,
      thinkingConfig: { thinkingLevel: thinking.toUpperCase() as ThinkingLevel },
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        properties: { style: { type: 'string' }, camera: { type: 'string' }, negative: { type: 'string' } },
        required: ['style', 'camera', 'negative'],
      },
    },
  })
  let parsed: Partial<Record<'style' | 'camera' | 'negative', unknown>>
  try {
    parsed = JSON.parse(res.text ?? '{}')
  } catch {
    throw new Error('The model did not return valid JSON - try again')
  }
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return { style: s(parsed.style), camera: s(parsed.camera), negative: s(parsed.negative) }
}
