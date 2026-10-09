import { useEffect } from 'react'
import { clsx, type ClassValue } from 'clsx'

export const cn = (...v: ClassValue[]) => clsx(v)

export function formatDuration(s?: number) {
  if (s === undefined) return ''
  return s < 60 ? `${s.toFixed(s < 10 ? 1 : 0)}s` : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`
}

export function elapsed(fromIso?: string, toIso?: string) {
  if (!fromIso) return ''
  const s = Math.max(0, ((toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso)) / 1000)
  return s < 60 ? `${Math.floor(s)}s` : `${Math.floor(s / 60)}m ${String(Math.floor(s % 60)).padStart(2, '0')}s`
}

export function timeAgo(iso: string) {
  const s = (Date.now() - Date.parse(iso)) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

/** Duration of a local video file, read from its metadata. */
export function videoDuration(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => resolve(v.duration)
    v.onerror = () => reject(new Error('Cannot read the video'))
    v.src = src
  })
}

/** Calls `fn` on Escape while `active`. */
export function useEscape(active: boolean, fn: () => void) {
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && fn()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}
