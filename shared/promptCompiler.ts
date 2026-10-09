import type { GenerationMode } from './types'

/**
 * The composer writes media references as tokens: @start, @end, @img1.., @vid1..
 * Omni binds media to roles with prompt tags (docs: "Using tags in prompts to set image and video roles"):
 *   [# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2] [# References <IMAGE_REF_0>@Image3 <VIDEO_REF_0>@Video1]
 * where ImageN / VideoN is the Nth image / video part of `input` (1-based) and IMAGE_REF_N is 0-based.
 * Image parts are always sent in the order [firstFrame, lastFrame, ...imageRefs].
 */

export const TOKEN_RE = /@(start|end|img(\d+)|vid(\d+)|voice(\d+))\b/g

export interface MediaLayout {
  hasFirst: boolean
  hasLast: boolean
  imageRefs: number
  videoRefs: number
  /** project voices (@voice1..) */
  voices?: number
}

export interface TokenInfo {
  token: string
  role: 'first' | 'last' | 'image' | 'video' | 'voice'
  /** 0-based index within its role */
  index: number
}

export function availableTokens(l: MediaLayout): TokenInfo[] {
  const out: TokenInfo[] = []
  if (l.hasFirst) out.push({ token: '@start', role: 'first', index: 0 })
  if (l.hasLast) out.push({ token: '@end', role: 'last', index: 0 })
  for (let i = 0; i < l.imageRefs; i++) out.push({ token: `@img${i + 1}`, role: 'image', index: i })
  for (let i = 0; i < l.videoRefs; i++) out.push({ token: `@vid${i + 1}`, role: 'video', index: i })
  for (let i = 0; i < (l.voices ?? 0); i++) out.push({ token: `@voice${i + 1}`, role: 'voice', index: i })
  return out
}

/** Tokens in the prompt that point at media which is not attached. */
export function unknownTokens(prompt: string, l: MediaLayout): string[] {
  const known = new Set(availableTokens(l).map((t) => t.token))
  const bad = new Set<string>()
  for (const m of prompt.matchAll(TOKEN_RE)) if (!known.has(m[0])) bad.add(m[0])
  return [...bad]
}

function omniTag(token: string): string {
  if (token === '@start') return '<FIRST_FRAME>'
  if (token === '@end') return '<LAST_FRAME>'
  const img = /^@img(\d+)$/.exec(token)
  if (img) return `<IMAGE_REF_${Number(img[1]) - 1}>`
  const vid = /^@vid(\d+)$/.exec(token)
  if (vid) return `<VIDEO_REF_${Number(vid[1]) - 1}>`
  return token
}

export interface CompileOptions {
  mode?: GenerationMode
  /** seconds, 0/undefined = no hint */
  durationHint?: number
}

export function compileOmniPrompt(prompt: string, l: MediaLayout, opts: CompileOptions = {}): string {
  let body = prompt.trim().replace(TOKEN_RE, (t) => omniTag(t))

  if (opts.mode === 'extend' && !/^(extend|continue)\b/i.test(body)) {
    body = body ? `Extend this video: ${body}` : 'Extend this video.'
  }

  const sources: string[] = []
  const references: string[] = []
  const guidance: string[] = []
  let image = 0
  if (l.hasFirst) {
    image++
    sources.push(`<FIRST_FRAME>@Image${image}`)
  }
  if (l.hasLast) {
    image++
    sources.push(`<LAST_FRAME>@Image${image}`)
  }
  if (l.hasFirst && l.hasLast) guidance.push('Use Image1 as the first frame and Image2 as the last frame.')
  else if (l.hasFirst) guidance.push('Use Image1 as the starting frame.')
  for (let i = 0; i < l.imageRefs; i++) {
    image++
    references.push(`<IMAGE_REF_${i}>@Image${image}`)
  }
  for (let i = 0; i < l.videoRefs; i++) references.push(`<VIDEO_REF_${i}>@Video${i + 1}`)
  if (l.imageRefs) {
    guidance.push('Use the given image(s) as references for video generation. The images should not be used as literal initial frames.')
  }
  if (l.videoRefs) guidance.push('Use the given video(s) as references. Do not use them as a source for video editing.')

  const header = [
    sources.length ? `[# Sources ${sources.join(' ')}]` : '',
    references.length ? `[# References ${references.join(' ')}]` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const tail: string[] = [...guidance]
  if (opts.durationHint) tail.push(`The video is ${opts.durationHint} seconds long.`)

  const head = [header, body].filter(Boolean).join(' ')
  const t = tail.join(' ')
  // a multi-paragraph prompt (e.g. with CAMERA / STYLE sections) gets the guidance as its own paragraph
  return (t ? (head.includes('\n') ? `${head}\n\n${t}` : [head, t].filter(Boolean).join(' ')) : head).trim()
}

/** Veo and the OpenRouter models have no role tags: tokens become plain words. */
export function compileVeoPrompt(prompt: string): string {
  return prompt
    .trim()
    .replace(TOKEN_RE, (t) => {
      if (t === '@start') return 'the first frame'
      if (t === '@end') return 'the last frame'
      const img = /^@img(\d+)$/.exec(t)
      if (img) return `reference image ${img[1]}`
      const vid = /^@vid(\d+)$/.exec(t)
      return vid ? `reference video ${vid[1]}` : t
    })
    .replace(/[ \t]+/g, ' ')
}

/**
 * Lyria: images are just "image N" in words; the length (Lyria 3.5) and "instrumental" are plain sentences, which is
 * how the docs steer them (there are no parameters for either).
 */
export function compileMusicPrompt(prompt: string, s: { duration?: number; instrumental?: boolean }, fixedLength = false): string {
  const lines = [compileImagePrompt(prompt)]
  if (s.duration && !fixedLength) lines.push(`Length: about ${s.duration >= 60 ? `${Math.floor(s.duration / 60)}:${String(s.duration % 60).padStart(2, '0')} minutes` : `${s.duration} seconds`}.`)
  if (s.instrumental) lines.push('Instrumental only, no vocals.')
  return lines.filter(Boolean).join('\n\n')
}

/** Nano Banana takes images as plain input parts: @imgN becomes "image N" (the Nth attached image). */
export function compileImagePrompt(prompt: string): string {
  return prompt
    .trim()
    .replace(TOKEN_RE, (t) => {
      const img = /^@img(\d+)$/.exec(t)
      return img ? `image ${img[1]}` : t
    })
    .replace(/[ \t]+/g, ' ')
}

/**
 * OpenRouter photo models: like Nano Banana, plus Edit - the photo being edited is sent AFTER the refs,
 * so @imgN keeps meaning "image N" and the prompt names the last image as the one to change.
 */
export function compileOpenRouterImagePrompt(prompt: string, o: { mode?: GenerationMode; imageRefs: number }): string {
  const body = compileImagePrompt(prompt)
  if (o.mode !== 'edit') return body
  const target = o.imageRefs ? `image ${o.imageRefs + 1} (the last image)` : 'this image'
  return `Edit ${target}: ${body || 'improve it.'}${o.imageRefs ? ' Keep everything else in it unchanged; the other images are references.' : ' Keep everything else unchanged.'}`
}

/** Lyria's text without its bare section markers ([[A0]], [[B1]]...); undefined when nothing readable is left (instrumental). */
export function readableLyrics(text?: string): string | undefined {
  const t = (text ?? '')
    .split('\n')
    .filter((line) => !/^\s*\[\[[A-Z]\d+\]\]\s*$/.test(line))
    .join('\n')
    .replace(/\[\[[A-Z]\d+\]\]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return t || undefined
}
