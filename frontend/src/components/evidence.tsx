import { useQuery } from '@tanstack/react-query'
import { useEffect, useMemo, useRef } from 'react'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'

export interface Highlight {
  start: number
  end: number
  kind?: 'default' | 'primary' | 'conflict'
}

/** Renders `text` with highlighted character ranges (offsets relative to `text`). */
export function Highlighted({ text, highlights, className }: { text: string; highlights: Highlight[]; className?: string }) {
  const parts = useMemo(() => {
    const hs = [...highlights].filter((h) => h.end > h.start).sort((a, b) => a.start - b.start)
    const out: { text: string; kind?: Highlight['kind']; mark: boolean }[] = []
    let cur = 0
    for (const h of hs) {
      if (h.start < cur) continue
      if (h.start > cur) out.push({ text: text.slice(cur, h.start), mark: false })
      out.push({ text: text.slice(h.start, h.end), kind: h.kind, mark: true })
      cur = h.end
    }
    if (cur < text.length) out.push({ text: text.slice(cur), mark: false })
    return out
  }, [text, highlights])
  return (
    <pre className={cn('font-mono text-[12.5px] leading-relaxed break-words whitespace-pre-wrap', className)}>
      {parts.map((p, i) =>
        p.mark ? (
          <mark key={i} data-evidence className={cn('ev', p.kind === 'primary' && 'ev-primary', p.kind === 'conflict' && 'ev-conflict')}>
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </pre>
  )
}

export function useDocument(id: number | null | undefined) {
  return useQuery({ queryKey: ['document', id], queryFn: () => api.getDocument(id!), enabled: id != null, staleTime: Infinity })
}

/** Shows the source text around an evidence span with the span highlighted. */
export function EvidenceExcerpt({ documentId, start, end, kind = 'primary', context = 260 }: { documentId: number; start: number; end: number; kind?: Highlight['kind']; context?: number }) {
  const { data: doc, isLoading } = useDocument(documentId)
  if (isLoading || !doc) return <div className="h-16 animate-pulse rounded-lg bg-sunken" />
  const from = Math.max(0, start - context)
  const to = Math.min(doc.raw_text.length, end + context)
  const windowText = doc.raw_text.slice(from, to)
  return (
    <div className="rounded-lg border border-line bg-canvas px-3 py-2.5">
      <div className="mb-1 text-[11.5px] text-muted">
        {doc.title} · characters {start.toLocaleString()}–{end.toLocaleString()}
      </div>
      <Highlighted text={windowText} highlights={[{ start: start - from, end: end - from, kind }]} />
    </div>
  )
}

/** Full-document viewer that scrolls to its first highlight. */
export function DocumentText({ text, highlights, className }: { text: string; highlights: Highlight[]; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const key = highlights.map((h) => `${h.start}-${h.end}`).join(',')
  useEffect(() => {
    const el = ref.current?.querySelector('mark[data-evidence]')
    if (el && 'scrollIntoView' in el) (el as HTMLElement).scrollIntoView?.({ block: 'center', behavior: 'smooth' })
  }, [key])
  return (
    <div ref={ref} className={cn('scroll-thin overflow-auto rounded-lg border border-line bg-surface p-4', className)}>
      <Highlighted text={text} highlights={highlights} />
    </div>
  )
}
