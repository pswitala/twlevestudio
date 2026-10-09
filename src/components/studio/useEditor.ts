import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Edit } from '../../../shared/studio'
import { api } from '../../lib/api'
import { useUi } from '../../stores/ui'

const HISTORY = 100
const SAVE_DELAY_MS = 600

/**
 * The open edit as local state: every change is instant, undoable (Ctrl+Z) and autosaved shortly after.
 * Drags call `checkpoint()` once and then `update(fn, false)` on every move, so a whole drag is one undo step.
 */
export function useEditor(source: Edit | undefined) {
  const qc = useQueryClient()
  const notify = useUi((s) => s.notify)
  const [edit, setEdit] = useState<Edit | undefined>(source)
  const past = useRef<Edit[]>([])
  const future = useRef<Edit[]>([])
  const [, bump] = useState(0)
  const dirty = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const latest = useRef(edit)
  latest.current = edit
  const [saving, setSaving] = useState<'idle' | 'pending' | 'saving' | 'error'>('idle')

  const flush = useCallback(async () => {
    clearTimeout(timer.current)
    const e = latest.current
    if (!e || !dirty.current) return
    dirty.current = false
    setSaving('saving')
    try {
      const saved = await api.saveEdit(e)
      qc.setQueryData<Edit[]>(['edits'], (list) => list?.map((x) => (x.id === saved.id ? saved : x)))
      setSaving(dirty.current ? 'pending' : 'idle')
    } catch (err) {
      dirty.current = true
      setSaving('error')
      notify(`Studio: not saved - ${(err as Error).message}`, 'error')
    }
  }, [qc, notify])

  // Another edit opened (or the first load): take it as is, without history and without saving it back.
  useEffect(() => {
    if (source?.id === latest.current?.id && latest.current) return
    void flush()
    past.current = []
    future.current = []
    setEdit(source)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.id])

  // save on leaving the page / closing the tab
  useEffect(() => {
    const onHide = () => void flush()
    window.addEventListener('pagehide', onHide)
    return () => {
      window.removeEventListener('pagehide', onHide)
      void flush()
    }
  }, [flush])

  const schedule = useCallback(() => {
    dirty.current = true
    setSaving('pending')
    clearTimeout(timer.current)
    timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS)
  }, [flush])

  const checkpoint = useCallback(() => {
    if (!latest.current) return
    past.current = [...past.current.slice(-HISTORY + 1), latest.current]
    future.current = []
    bump((x) => x + 1)
  }, [])

  /** Change the edit. `history` false = part of a gesture that already called checkpoint(). */
  const update = useCallback(
    (fn: (e: Edit) => Edit, history = true) => {
      const cur = latest.current
      if (!cur) return
      const next = fn(cur)
      if (next === cur) return
      if (history) checkpoint()
      latest.current = next
      setEdit(next)
      schedule()
    },
    [checkpoint, schedule],
  )

  /** Puts back the state saved by the last checkpoint() (a cancelled drag). */
  const revert = useCallback(() => {
    const prev = past.current.at(-1)
    if (!prev) return
    past.current = past.current.slice(0, -1)
    latest.current = prev
    setEdit(prev)
    schedule()
  }, [schedule])

  const undo = useCallback(() => {
    const prev = past.current.at(-1)
    if (!prev || !latest.current) return
    past.current = past.current.slice(0, -1)
    future.current = [latest.current, ...future.current]
    latest.current = prev
    setEdit(prev)
    schedule()
  }, [schedule])

  const redo = useCallback(() => {
    const next = future.current[0]
    if (!next || !latest.current) return
    future.current = future.current.slice(1)
    past.current = [...past.current, latest.current]
    latest.current = next
    setEdit(next)
    schedule()
  }, [schedule])

  return {
    edit,
    update,
    checkpoint,
    revert,
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saving,
    flush,
  }
}

export type Editor = ReturnType<typeof useEditor>
