import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { create } from 'zustand'

interface ConfirmRequest {
  title: string
  message?: string
  confirmLabel?: string
  resolve: (ok: boolean) => void
}

const useConfirmStore = create<{ req?: ConfirmRequest }>(() => ({}))

/** Asks before anything destructive. Resolves true only on an explicit confirm. */
export function confirmAction(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.getState().req?.resolve(false)
    useConfirmStore.setState({ req: { ...opts, resolve } })
  })
}

export function ConfirmDialog() {
  const req = useConfirmStore((s) => s.req)
  const confirmBtn = useRef<HTMLButtonElement>(null)

  const finish = (ok: boolean) => {
    req?.resolve(ok)
    useConfirmStore.setState({ req: undefined })
  }

  useEffect(() => {
    if (!req) return
    confirmBtn.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // keep the player panel / dialogs underneath from closing too
        e.stopImmediatePropagation()
        finish(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  if (!req) return null
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-2 backdrop-blur-sm sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && finish(false)}>
      <div role="alertdialog" aria-modal className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-6">
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-rose-500/15 p-2 text-rose-300">
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-medium">{req.title}</h2>
            {req.message && <p className="mt-1 text-[13px] leading-relaxed text-white/60">{req.message}</p>}
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => finish(false)} className="rounded-full px-4 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button
            ref={confirmBtn}
            type="button"
            onClick={() => finish(true)}
            className="rounded-full bg-rose-500 px-4 py-1.5 text-[13px] font-medium text-white hover:bg-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
          >
            {req.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
