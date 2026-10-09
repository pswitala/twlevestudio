import { getModel } from '../shared/models'
import { ai } from './genai'

const COMMON = `You rewrite a user's idea into one production-ready prompt for an AI video model.
Rules:
- Output ONLY the rewritten prompt. No preamble, no quotes, no markdown, no lists.
- Write in English, even if the input is in another language.
- Keep every token that starts with @ (for example @start, @end, @img1, @vid2) EXACTLY as written, in a sensible place.
- Keep the user's intent, subjects, and any explicit timing, text, dialogue, or style. Do not add new characters or brands.
- Add what is missing: subject and action detail, setting, camera framing and movement, lighting, mood, and a short sound design line.
- Stay under 140 words.`

const OMNI = `Target model: Gemini Omni Flash.
- By default it cuts between several shots. If the idea reads like one moment, say "single continuous shot, no scene cuts".
- Timing can be given in natural language ("after 3 seconds ...") or timecodes ("[0-3s] ...") - keep any the user gave.
- Put negatives as plain sentences ("No dialogue.", "No on-screen text.").
- Describe the audio explicitly (music style, ambience, dialogue or "No dialogue").`

const VEO = `Target model: Veo 3.1.
- Structure: subject, action, style, camera (shot type, angle, movement), composition, ambiance/lighting.
- Dialogue goes in quotes ("The man says: ..."); describe sound effects and ambient noise explicitly.
- Max 1,024 tokens.`

const IMAGE = `Target model: Nano Banana (Gemini image generation). You are writing a prompt for ONE still image, not a video.
- Describe the scene as a narrative paragraph, not a keyword list: subject, setting, composition, lens/camera feel, lighting, mood, style.
- For photorealism, use photography terms (shot type, lens, depth of field, light quality). For illustration, name the medium and style.
- Spell out any text that must appear in the image, in quotes, and its typography.
- References to attached images ("image 1", @img1) describe what to take from them (subject, style, product).
- Leave out sound, motion and timing.`

const MUSIC = `Target model: Lyria (Google music generation). You are writing a prompt for a piece of MUSIC, not a picture or a video.
- Name genre and sub-genre, mood and energy, tempo (BPM or feel), key or mode if it matters, the main instruments and the production style.
- Describe the arc: intro, build, chorus / drop, outro. Timed sections like "[0:00 - 0:15] Intro: ..." are understood - keep any the user gave.
- Vocals: say whether there are any, the voice type and the language. Keep lyrics the user wrote EXACTLY, under section headers ([Verse 1], [Chorus]...).
- If the user wants background music or no singing, end with "Instrumental only, no vocals."
- Never name real artists, bands or songs - describe the sound instead.
- References to attached images ("image 1", @img1) mean: take the mood, colours and setting of that image as inspiration.
- Leave out camera, framing and visual style.`

const MUSIC_COMMON = `You rewrite a user's idea into one production-ready prompt for an AI music model.
Rules:
- Output ONLY the rewritten prompt. No preamble, no quotes, no markdown.
- Write in English, even if the input is in another language - except lyrics, which stay in their language.
- Keep every token that starts with @ (for example @img1) EXACTLY as written.
- Keep the user's intent, genre, mood, timing and lyrics.
- Add what is missing: genre, mood, tempo, instruments, structure, vocals or instrumental.
- Stay under 160 words, not counting lyrics the user wrote.`

const OPENROUTER = `Target model: a text/image-to-video model reached through OpenRouter (Seedance, MiniMax Hailuo, Kling, Wan, HappyHorse, Grok Imagine, FLUX, Runway).
- One continuous shot unless the user asks for cuts: subject and action first, then setting, camera (shot type, movement), lighting, style.
- Concrete, visible verbs; one main action per few seconds of video.
- References are plain words ("the first frame", "reference image 1", "reference video 1") - say what to take from each (character, outfit, product, style, motion).
- Dialogue in quotes with who says it; describe sound and ambience explicitly.
- Put negatives as plain sentences ("No on-screen text.").`

/** Per-provider prompting notes, also used by the AI prompt doctor (refine.ts). */
export const MODEL_GUIDE: Record<string, string> = { omni: OMNI, veo: VEO, nanobanana: IMAGE, lyria: MUSIC, openrouter: OPENROUTER, 'openrouter-image': IMAGE }

export async function enhancePrompt(modelId: string, prompt: string): Promise<string> {
  const m = getModel(modelId)
  const provider = m.provider
  const res = await ai().models.generateContent({
    model: process.env.ENHANCE_MODEL || 'gemini-flash-latest',
    contents: prompt,
    config: {
      systemInstruction:
        m.kind === 'image'
          ? `${COMMON.replace('AI video model', 'AI image model').replace(', and a short sound design line', '')}\n\n${IMAGE}`
          : m.kind === 'music'
            ? `${MUSIC_COMMON}\n\n${MUSIC}`
            : `${COMMON}\n\n${provider === 'omni' ? OMNI : provider === 'openrouter' ? `${OPENROUTER}\n- Model: ${m.label}.` : VEO}`,
      temperature: 0.7,
    },
  })
  const text = res.text?.trim()
  if (!text) throw new Error('The enhancer returned nothing')
  return text.replace(/^["“]|["”]$/g, '')
}
