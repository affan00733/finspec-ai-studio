import { useMutation } from '@tanstack/react-query'
import { BookOpenCheck, ExternalLink, SendHorizontal, TriangleAlert } from 'lucide-react'
import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { EvidenceExcerpt } from '@/components/evidence'
import { Badge, Button, Callout, Card, ErrorNote, Input, PageHeader } from '@/components/ui'
import { api } from '@/lib/api'
import { useTour } from '@/lib/store'
import type { ChatResponse } from '@/types'

interface Turn {
  id: number
  question: string
  response?: ChatResponse
  error?: string
}

const SUGGESTIONS: { label: string; q: string; kind: 'supported' | 'unsupported' }[] = [
  { label: 'Northstar FY2024 revenue', q: 'What was Northstar Energy revenue in FY2024?', kind: 'supported' },
  { label: 'Cascade Scope 2 (location-based)', q: 'What were the Scope 2 emissions of Cascade Retail in 2024?', kind: 'supported' },
  { label: 'Meridian "Revenue" (it reports Net sales)', q: 'What was Meridian Industrial revenue in FY2023?', kind: 'supported' },
  { label: 'Atlas EBITDA FY2022', q: 'What was Atlas Materials EBITDA in 2022?', kind: 'supported' },
  { label: 'Who is the CEO? (not in the reports)', q: 'Who is the CEO of Northstar Energy?', kind: 'unsupported' },
  { label: 'Northstar revenue FY2030 (no such report)', q: 'What was Northstar Energy revenue in FY2030?', kind: 'unsupported' },
]

function AnswerBody({ text, citationIds }: { text: string; citationIds: number[] }) {
  return (
    <div className="space-y-1.5 text-[14.5px] leading-relaxed">
      {text.split('\n').map((line, i) => (
        <p key={i}>
          {line.split(/(\[chunk:\d+\])/).map((part, j) => {
            const m = /\[chunk:(\d+)\]/.exec(part)
            if (!m) return <Fragment key={j}>{part}</Fragment>
            const n = citationIds.indexOf(Number(m[1])) + 1
            return (
              <sup key={j} className="mx-0.5 inline-flex size-4 items-center justify-center rounded bg-brand-100 text-[10px] font-semibold text-brand-800" title={`Citation ${n}`}>
                {n || '•'}
              </sup>
            )
          })}
        </p>
      ))}
    </div>
  )
}

function Citations({ r }: { r: ChatResponse }) {
  const [open, setOpen] = useState<number | null>(null)
  if (!r.citations.length) return null
  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold tracking-wider text-muted uppercase">
        <BookOpenCheck className="size-3.5" /> Sources ({r.citations.length})
      </div>
      <ol className="space-y-2">
        {r.citations.map((c, i) => (
          <li key={`${c.chunk_id}-${c.start_char}-${i}`} className="rounded-lg border border-line bg-canvas px-3 py-2">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              <span className="font-semibold text-brand-800">[{i + 1}]</span>
              <span className="font-medium">
                {c.company} FY{c.fiscal_year}
              </span>
              {c.label && <Badge>{c.label}</Badge>}
              <span className="text-muted">chunk {c.chunk_id}</span>
              <button type="button" className="ml-auto font-medium text-brand-700 hover:underline" onClick={() => setOpen(open === i ? null : i)}>
                {open === i ? 'Hide context' : 'Show context'}
              </button>
              <Link to={`/app/documents/${c.document_id}?start=${c.start_char}&end=${c.end_char}`} className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                Open <ExternalLink className="size-3" />
              </Link>
            </div>
            <blockquote className="mt-1.5 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-ink-2">“{c.quote}”</blockquote>
            {open === i && (
              <div className="mt-2">
                <EvidenceExcerpt documentId={c.document_id} start={c.start_char} end={c.end_char} />
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

export default function ResearchChat() {
  const [params] = useSearchParams()
  const complete = useTour((s) => s.complete)
  const [turns, setTurns] = useState<Turn[]>([])
  const [input, setInput] = useState('')
  const seen = useRef({ grounded: false, insufficient: false })
  const bottom = useRef<HTMLDivElement>(null)
  const nextId = useRef(1)

  const ask = useMutation({
    mutationFn: ({ question }: { id: number; question: string }) => {
      const history = turns.filter((t) => t.response).slice(-3).flatMap((t) => [{ role: 'user' as const, content: t.question }, { role: 'assistant' as const, content: t.response!.answer }])
      return api.chat({ message: question, history })
    },
    onSuccess: (response, { id }) => {
      setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, response } : t)))
      if (response.grounded) seen.current.grounded = true
      if (response.mode === 'insufficient_evidence') seen.current.insufficient = true
      if (seen.current.grounded && seen.current.insufficient) complete('F')
    },
    onError: (e, { id }) => setTurns((ts) => ts.map((t) => (t.id === id ? { ...t, error: (e as Error).message } : t))),
  })

  const send = (q: string) => {
    const question = q.trim()
    if (!question || ask.isPending) return
    const id = nextId.current++
    setTurns((ts) => [...ts, { id, question }])
    setInput('')
    ask.mutate({ id, question })
  }

  useEffect(() => {
    bottom.current?.scrollIntoView?.({ behavior: 'smooth', block: 'end' })
  }, [turns])

  const autoRan = useRef(false)
  useEffect(() => {
    if (params.get('scenario') === 'F' && !autoRan.current) {
      autoRan.current = true
      send(SUGGESTIONS[0].q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])

  return (
    <>
      <PageHeader
        eyebrow="Run & review"
        title="Research Chat"
        description="Ask about the indexed annual reports. Answers are assembled only from evidence in the documents and every figure is cited. If the reports do not support an answer, the assistant says so."
      />
      <div className="grid gap-5 lg:grid-cols-[1fr_280px]">
        <div>
          <Card className="flex min-h-[520px] flex-col">
            <div className="scroll-thin flex-1 space-y-5 overflow-y-auto p-5" aria-live="polite">
              {turns.length === 0 && (
                <div className="py-10 text-center text-[14px] text-muted">
                  <div className="font-display text-xl font-semibold text-ink">Ask the reports</div>
                  <p className="mx-auto mt-1 max-w-md">Name a company, a year and a metric. Try one of the suggestions - including the ones the reports cannot answer.</p>
                </div>
              )}
              {turns.map((t) => (
                <div key={t.id} className="space-y-3">
                  <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-700 px-4 py-2.5 text-[14.5px] text-white">{t.question}</div>
                  {t.error && <ErrorNote error={new Error(t.error)} />}
                  {!t.response && !t.error && <div className="text-[13px] text-muted">Searching the reports…</div>}
                  {t.response && (
                    <div className="max-w-[92%] rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3.5 shadow-card" data-testid="assistant-answer">
                      <div className="mb-2 flex flex-wrap items-center gap-2">
                        {t.response.grounded ? (
                          <Badge tone="ok">Grounded · {t.response.citations.length} citation{t.response.citations.length === 1 ? '' : 's'}</Badge>
                        ) : (
                          <Badge tone="warn">
                            <TriangleAlert className="size-3" /> Insufficient evidence
                          </Badge>
                        )}
                        <span className="text-[12px] text-muted">
                          {t.response.scope.documents.length} report{t.response.scope.documents.length === 1 ? '' : 's'} searched · {t.response.provider}/{t.response.model}
                        </span>
                      </div>
                      <AnswerBody text={t.response.answer} citationIds={t.response.citations.map((c) => c.chunk_id)} />
                      {t.response.warnings.map((w) => (
                        <p key={w} className="mt-2 text-[12.5px] text-warn">
                          {w}
                        </p>
                      ))}
                      <Citations r={t.response} />
                    </div>
                  )}
                </div>
              ))}
              <div ref={bottom} />
            </div>
            <form
              className="flex gap-2 border-t border-line p-3"
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
            >
              <Input aria-label="Your question" value={input} onChange={(e) => setInput(e.target.value)} placeholder="e.g. What was Atlas Materials operating revenue in FY2024?" className="h-10" />
              <Button type="submit" variant="primary" className="h-10" disabled={!input.trim()} loading={ask.isPending}>
                <SendHorizontal className="size-4" /> Ask
              </Button>
            </form>
          </Card>
        </div>
        <aside className="space-y-4">
          <Card className="p-4">
            <div className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Supported questions</div>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS.filter((s) => s.kind === 'supported').map((s) => (
                <button key={s.q} type="button" onClick={() => send(s.q)} className="rounded-lg bg-brand-50 px-2.5 py-1.5 text-left text-[13px] text-brand-800 hover:bg-brand-100">
                  {s.label}
                </button>
              ))}
            </div>
            <div className="mt-4 mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Unsupported (expect refusal)</div>
            <div className="flex flex-col items-start gap-1.5">
              {SUGGESTIONS.filter((s) => s.kind === 'unsupported').map((s) => (
                <button key={s.q} type="button" onClick={() => send(s.q)} className="rounded-lg bg-warn-bg px-2.5 py-1.5 text-left text-[13px] text-[#6b3d00] hover:bg-[#fbe8c4]">
                  {s.label}
                </button>
              ))}
            </div>
          </Card>
          <Callout tone="info" title="How answers are built">
            The mock assistant detects the metric, finds the matching reports, runs the same extractor as the workbench (active prompt configuration) and quotes its evidence. Different line items are never substituted for each other.
          </Callout>
        </aside>
      </div>
    </>
  )
}
