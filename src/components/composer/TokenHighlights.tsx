import { forwardRef, type ReactNode } from 'react'
import { TOKEN_RE } from '../../../shared/promptCompiler'

/**
 * Sits exactly behind the prompt <textarea> (same font, padding and wrapping, transparent text) and
 * paints a background under every @token: green when it points at attached media / a project voice,
 * red when it points at nothing. The textarea keeps the real text, caret and selection on top.
 */
export const TokenHighlights = forwardRef<HTMLDivElement, { text: string; known: Set<string>; className: string }>(
  function TokenHighlights({ text, known, className }, ref) {
    const parts: ReactNode[] = []
    let last = 0
    for (const m of text.matchAll(new RegExp(TOKEN_RE.source, 'g'))) {
      const at = m.index ?? 0
      if (at > last) parts.push(text.slice(last, at))
      const ok = known.has(m[0])
      parts.push(
        <mark
          key={at}
          className={
            ok
              ? 'rounded-[4px] bg-emerald-500/25 text-transparent shadow-[0_0_0_1px_rgba(52,211,153,0.45)]'
              : 'rounded-[4px] bg-rose-500/35 text-transparent shadow-[0_0_0_1px_rgba(251,113,133,0.7)]'
          }
        >
          {m[0]}
        </mark>,
      )
      last = at + m[0].length
    }
    parts.push(text.slice(last))
    return (
      <div ref={ref} aria-hidden className={className}>
        {parts}
        {/* a trailing newline needs content to take up a line, like it does in the textarea */}
        {String.fromCharCode(0x200b)}
      </div>
    )
  },
)
