import { useEffect, useRef, useState } from 'react'
import { Scissors } from 'lucide-react'
import { VIDEO_REF_MAX_SECONDS } from '../../../shared/models'
import { useUi } from '../../stores/ui'

/** Video refs may be 3 s long at most: pick which 3 s window to keep. */
export function TrimDialog() {
  const { trim, closeTrim } = useUi()
  const video = useRef<HTMLVideoElement>(null)
  const [start, setStart] = useState(0)

  useEffect(() => setStart(0), [trim?.src])

  // Loop the preview inside the selected window.
  useEffect(() => {
    const v = video.current
    if (!v) return
    v.currentTime = start
    void v.play().catch(() => {})
    const onTime = () => {
      if (v.currentTime >= start + VIDEO_REF_MAX_SECONDS || v.currentTime < start) v.currentTime = start
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [start, trim?.src])

  if (!trim) return null
  const max = Math.max(0, trim.duration - VIDEO_REF_MAX_SECONDS)
  const finish = (v: number | null) => {
    trim.resolve(v)
    closeTrim()
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 p-2 backdrop-blur-sm sm:p-6">
      <div className="w-full max-w-2xl rounded-3xl border border-white/10 bg-neutral-900 p-4 shadow-2xl sm:p-5">
        <h2 className="mb-1 flex items-center gap-2 text-[15px] font-medium">
          <Scissors className="size-4" /> Choose a 3-second window
        </h2>
        <p className="mb-3 text-[12.5px] text-white/50">
          Omni accepts video references of up to 3 s (their audio is ignored). This clip is {trim.duration.toFixed(1)} s long.
        </p>
        <video ref={video} src={trim.src} muted playsInline className="mb-3 max-h-[50vh] w-full rounded-xl bg-black" />
        <input type="range" min={0} max={max} step={0.1} value={start} onChange={(e) => setStart(Number(e.target.value))} className="w-full" />
        <p className="mt-1 font-mono text-[12px] text-white/60">
          {start.toFixed(1)}s – {(start + VIDEO_REF_MAX_SECONDS).toFixed(1)}s
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={() => finish(null)} className="rounded-full px-4 py-1.5 text-[13px] text-white/70 hover:bg-white/10">
            Cancel
          </button>
          <button type="button" onClick={() => finish(start)} className="rounded-full bg-white px-4 py-1.5 text-[13px] font-medium text-black">
            Use this clip
          </button>
        </div>
      </div>
    </div>
  )
}
