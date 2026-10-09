import { GoogleGenAI } from '@google/genai'

export function apiKey(): string | undefined {
  return process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || undefined
}

let client: GoogleGenAI | undefined
let clientKey: string | undefined

export function ai(): GoogleGenAI {
  const key = apiKey()
  if (!key) throw new Error('GEMINI_API_KEY is not set - add it to twelvelabs/.env.local and restart.')
  if (!client || clientKey !== key) {
    client = new GoogleGenAI({ apiKey: key })
    clientKey = key
  }
  return client
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Turns SDK / HTTP errors into one readable line. */
export function errorMessage(e: unknown): string {
  const err = e as { status?: number; message?: string; error?: { message?: string } }
  let msg = err?.error?.message || err?.message || String(e)
  try {
    const parsed = JSON.parse(msg) as { error?: { message?: string } }
    if (parsed?.error?.message) msg = parsed.error.message
  } catch {
    /* not JSON */
  }
  if (/location|region|not available in your country/i.test(msg)) msg += ' (this feature is blocked in the EEA)'
  if (err?.status === 429 || /RESOURCE_EXHAUSTED|quota/i.test(msg)) msg = `Quota / rate limit: ${msg}`
  return msg.slice(0, 800)
}
