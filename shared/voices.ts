/**
 * Project voices. A voice is a description ("warm female voice, 40s, slight rasp") that can be
 *  - designed into a real Gemini TTS voice (Voice design -> persistent `voice_...` id, 1-year TTL), or
 *  - mapped to a prebuilt voice (Kore, Puck...).
 * In prompts they are @voice1, @voice2... (order within the project).
 *  - Speech (TTS): the line is spoken with that voice.
 *  - Video: Omni/Veo take no audio refs, so the token becomes the voice's description in words.
 */

export interface Voice {
  id: string
  projectId: string
  name: string
  description: string
  /** BCP-47, e.g. pl-PL */
  language: string
  gender?: 'female' | 'male'
  /** TTS model the voice was designed with */
  model: string
  /** Voice design result (voice_...) */
  googleVoiceId?: string
  /** description the google voice was made from - differs after an edit = needs re-design */
  designedFrom?: string
  /** fallback: a prebuilt voice name */
  prebuilt?: string
  /** preview WAV in data/voices */
  sampleFile?: string
  error?: string
  tags?: string[]
  createdAt: string
}

/** What a generation froze about a voice it used. */
export interface VoiceSnapshot {
  /** library voice id (missing on recordings made before voices could come from any project) */
  id?: string
  index: number
  name: string
  description: string
  /** google voice id or prebuilt name - what TTS speaks with */
  voice?: string
}

export const PREBUILT_VOICES: { name: string; note: string }[] = [
  { name: 'Zephyr', note: 'bright' }, { name: 'Puck', note: 'upbeat' }, { name: 'Charon', note: 'informative' },
  { name: 'Kore', note: 'firm' }, { name: 'Fenrir', note: 'excitable' }, { name: 'Leda', note: 'youthful' },
  { name: 'Orus', note: 'firm' }, { name: 'Aoede', note: 'breezy' }, { name: 'Callirrhoe', note: 'easy-going' },
  { name: 'Autonoe', note: 'bright' }, { name: 'Enceladus', note: 'breathy' }, { name: 'Iapetus', note: 'clear' },
  { name: 'Umbriel', note: 'easy-going' }, { name: 'Algieba', note: 'smooth' }, { name: 'Despina', note: 'smooth' },
  { name: 'Erinome', note: 'clear' }, { name: 'Algenib', note: 'gravelly' }, { name: 'Rasalgethi', note: 'informative' },
  { name: 'Laomedeia', note: 'upbeat' }, { name: 'Achernar', note: 'soft' }, { name: 'Alnilam', note: 'firm' },
  { name: 'Schedar', note: 'even' }, { name: 'Gacrux', note: 'mature' }, { name: 'Pulcherrima', note: 'forward' },
  { name: 'Achird', note: 'friendly' }, { name: 'Zubenelgenubi', note: 'casual' }, { name: 'Vindemiatrix', note: 'gentle' },
  { name: 'Sadachbia', note: 'lively' }, { name: 'Sadaltager', note: 'knowledgeable' }, { name: 'Sulafat', note: 'warm' },
]

export const LANGUAGES = [
  { code: 'pl-PL', label: 'Polish' },
  { code: 'en-US', label: 'English (US)' },
  { code: 'en-GB', label: 'English (UK)' },
  { code: 'de-DE', label: 'German' },
  { code: 'es-ES', label: 'Spanish' },
  { code: 'fr-FR', label: 'French' },
  { code: 'it-IT', label: 'Italian' },
  { code: 'uk-UA', label: 'Ukrainian' },
]

/** What TTS speaks with, if anything. A designed voice wins unless its description changed since. */
export function speakingVoice(v: Voice): string | undefined {
  if (v.googleVoiceId && v.designedFrom === v.description) return v.googleVoiceId
  return v.prebuilt || undefined
}

export function snapshotVoices(voices: Voice[]): VoiceSnapshot[] {
  return voices.map((v, i) => ({ id: v.id, index: i + 1, name: v.name, description: v.description, voice: speakingVoice(v) }))
}

const VOICE_TOKEN = /@voice(\d+)\b/g

export function voiceTokens(text: string): number[] {
  return [...new Set([...text.matchAll(VOICE_TOKEN)].map((m) => Number(m[1])))]
}

/** Video prompts: @voice1 -> "(voice: warm female voice, 40s...)" - the models only understand words. */
export function describeVoiceTokens(text: string, voices: VoiceSnapshot[]): string {
  return text.replace(VOICE_TOKEN, (t, n: string) => {
    const v = voices.find((x) => x.index === Number(n))
    return v ? `(voice: ${v.description.trim().replace(/[.\s]+$/, '')})` : t
  })
}

export interface Turn {
  /** 1-based voice index */
  voice: number
  style?: string
  text: string
}

/**
 * Speech script. A line "@voice2: text" or "@voice2 (whispering): text" starts a turn for that voice
 * (a label before the tag - "Pan z głosem: @voice2: text" - is allowed and not spoken);
 * other lines continue the current turn; text before any tag uses `defaultVoice`.
 * Leading "DIALOG:" / "DIALOGUE:" labels are ignored.
 */
export function parseScript(script: string, defaultVoice: number): Turn[] {
  const turns: Turn[] = []
  let current: Turn | undefined
  for (const raw of script.replace(/^\s*DIALOG(UE)?\s*:\s*/i, '').split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) {
      current = undefined
      continue
    }
    // An optional label before the tag ("Pani z głosem: @voice1: …", "ANNA @voice1 (cicho): …") is not spoken.
    const m = /^(?:[^@]*?)@voice(\d+)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/i.exec(line)
    if (m) {
      current = { voice: Number(m[1]), style: m[2]?.trim() || undefined, text: m[3].trim() }
      turns.push(current)
    } else if (current) {
      current.text = `${current.text} ${line}`.trim()
    } else {
      current = { voice: defaultVoice, text: line }
      turns.push(current)
    }
  }
  return turns.filter((t) => t.text)
}

/** ~15 characters per second of speech - for the cost pill only. */
export function estimateSpeechSeconds(text: string): number {
  return Math.max(1, text.replace(/@voice\d+\s*(\([^)]*\))?\s*:/g, '').trim().length / 15)
}
