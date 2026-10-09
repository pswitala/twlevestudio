/**
 * Project defaults ("directives") - style, camera and negatives that ride along with every prompt.
 * A project sets them; a generation may override each one (own text) or switch it off ('').
 */

export type DirectiveKey = 'style' | 'camera' | 'negative'

export type Directives = Partial<Record<DirectiveKey, string>>

/** Per-generation overrides: missing = use the project's value, '' = off, text = this instead. */
export type DirectiveOverrides = Partial<Record<DirectiveKey, string>>

export const DIRECTIVE_KEYS: DirectiveKey[] = ['style', 'camera', 'negative']

export const DIRECTIVE_LABEL: Record<DirectiveKey, string> = {
  style: 'Style',
  camera: 'Camera',
  negative: 'Avoid',
}

export const CAMERA_PRESETS: { label: string; text: string }[] = [
  { label: 'Handheld', text: 'handheld camera, subtle natural shake' },
  { label: 'Static / tripod', text: 'static camera on a tripod, no camera movement' },
  { label: 'Wide shot', text: 'wide establishing shot' },
  { label: 'Medium shot', text: 'medium shot, waist up' },
  { label: 'Close-up', text: 'close-up shot' },
  { label: 'Slow dolly in', text: 'slow dolly-in towards the subject' },
  { label: 'Tracking shot', text: 'smooth tracking shot following the subject' },
  { label: 'Drone / aerial', text: 'aerial drone shot' },
  { label: 'POV', text: 'first-person POV shot' },
  { label: 'Gimbal', text: 'smooth gimbal-stabilised movement' },
]

const clean = (v?: string) => (v ?? '').trim()

/** What a generation actually uses: the override when given ('' switches it off), else the project's value. */
export function effectiveDirectives(project: Directives | undefined, overrides: DirectiveOverrides | undefined): Directives {
  const out: Directives = {}
  for (const k of DIRECTIVE_KEYS) {
    const v = overrides && k in overrides ? clean(overrides[k]) : clean(project?.[k])
    if (v) out[k] = v
  }
  return out
}

const flat = (v: string) => v.replace(/\s+/g, ' ').trim()
const join = (a: string, b: string) => [a.trim(), b].filter(Boolean).join('\n\n')

/**
 * Prompt layout (what Omni accepted; the same text with CAMERA after Omni's reference guidance was
 * "Input blocked"):
 *
 *   [# References …] <prompt>
 *
 *   CAMERA: …            <- withSceneDirectives: part of the scene, BEFORE the model-specific compile
 *   STYLE: …
 *
 *   Use the given image(s) as references… The video is N seconds long.   <- compile
 *
 *   NEGATIVE: …          <- withNegative: last, AFTER the compile
 *
 * Photos say FRAMING instead of CAMERA.
 */
export function withSceneDirectives(prompt: string, d: Directives, kind?: 'video' | 'image' | 'audio' | 'music'): string {
  const lines: string[] = []
  if (d.camera) lines.push(`${kind === 'image' ? 'FRAMING' : 'CAMERA'}: ${flat(d.camera)}`)
  if (d.style) lines.push(`STYLE: ${flat(d.style)}`)
  return lines.length ? join(prompt, lines.join('\n')) : prompt.trim()
}

/** NEGATIVE as the last section. `negativeAsParam` (Veo): also returned for the negativePrompt parameter. */
export function withNegative(text: string, d: Directives, negativeAsParam = false): { text: string; negativePrompt?: string } {
  return {
    text: d.negative ? join(text, `NEGATIVE: ${flat(d.negative)}`) : text.trim(),
    negativePrompt: negativeAsParam && d.negative ? d.negative : undefined,
  }
}

/** Both steps around a model-specific `compile` (identity by default) - the one place the order lives. */
export function composePrompt(
  prompt: string,
  d: Directives,
  opts: { kind?: 'video' | 'image' | 'audio' | 'music'; negativeAsParam?: boolean; compile?: (text: string) => string } = {},
): { text: string; negativePrompt?: string } {
  const compiled = (opts.compile ?? ((t) => t))(withSceneDirectives(prompt, d, opts.kind))
  return withNegative(compiled, d, opts.negativeAsParam)
}
