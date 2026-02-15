import { useMutation } from '@tanstack/react-query'
import { CheckCheck, Pencil, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfidenceBar, ValidationBadge } from '@/components/badges'
import { ResultDetail } from '@/components/ResultDetail'
import { Badge, Button, Callout, Card, CardHeader, EmptyState, ErrorNote, Field, Input, PageHeader, Spinner, Tabs, Textarea, tableCls } from '@/components/ui'
import { useRefreshAll, useReviewQueue, useReviews, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fmtDateTime, fmtValue, snippet } from '@/lib/format'
import { useToasts, useTour } from '@/lib/store'
import type { ExtractionResult } from '@/types'

type Decision = 'approve' | 'reject' | 'correct'

const SCALES: Record<'currency' | 'emissions', [string, number][]> = {
  currency: [
    ['units', 1],
    ['thousands', 1e3],
    ['millions', 1e6],
    ['billions', 1e9],
  ],
  emissions: [
    ['tCO2e', 1],
    ['ktCO2e', 1e3],
    ['million tCO2e (MtCO2e)', 1e6],
  ],
}

function DecisionPanel({ result, unitType, onDone }: { result: ExtractionResult; unitType: 'currency' | 'emissions'; onDone: () => void }) {
  const [params] = useSearchParams()
  const refresh = useRefreshAll()
  const toast = useToasts()
  const complete = useTour((s) => s.complete)
  const [decision, setDecision] = useState<Decision>(params.get('scenario') === 'D' ? 'correct' : result.status === 'found' ? 'approve' : 'reject')
  const [printed, setPrinted] = useState(result.raw_value || '')
  const defaultScale = SCALES[unitType].find(([, m]) => m === result.scale)?.[1] ?? 1
  const [scale, setScale] = useState(defaultScale)
  const [quote, setQuote] = useState(result.evidence[0]?.quote ?? '')
  const [comment, setComment] = useState('')
  const [reviewer, setReviewer] = useState('demo-analyst')

  const parsed = Number(printed.replace(/,/g, ''))
  const normalized = Number.isFinite(parsed) && printed.trim() !== '' ? Math.round(parsed * scale * 1e6) / 1e6 : null
  const digitsOf = (s: string) => s.replace(/\D/g, '')
  const quoteHasValue = Boolean(printed.trim()) && digitsOf(quote).includes(digitsOf(printed))
  const needsComment = decision === 'approve' && result.validation_status === 'fail'
  const correctInvalid = decision === 'correct' && (normalized === null || !quote.trim() || !quoteHasValue)

  const submit = useMutation({
    mutationFn: () =>
      api.submitReview({
        result: result.id,
        decision,
        reviewer,
        comment,
        ...(decision === 'correct' ? { corrected_value: normalized, corrected_unit: unitType === 'currency' ? result.currency : 'tCO2e', evidence_quote: quote } : {}),
      }),
    onSuccess: () => {
      refresh()
      if (decision === 'correct') complete('D')
      toast.push('ok', decision === 'correct' ? 'Correction saved. See it under History.' : `Result ${decision === 'approve' ? 'approved' : 'rejected'}.`)
      onDone()
    },
  })

  const opts: { id: Decision; label: string; icon: typeof CheckCheck; disabled?: boolean; hint: string }[] = [
    { id: 'approve', label: 'Approve', icon: CheckCheck, disabled: result.status !== 'found', hint: 'Accept the extracted value' },
    { id: 'correct', label: 'Correct', icon: Pencil, hint: 'Supply the right value and quote it' },
    { id: 'reject', label: 'Reject', icon: X, hint: 'No usable value' },
  ]
  return (
    <Card className="border-brand-200">
      <CardHeader title="Your decision" subtitle="Saved to the review history and the audit log" />
      <div className="space-y-4 p-5">
        <div role="radiogroup" aria-label="Decision" className="grid grid-cols-3 gap-2">
          {opts.map((o) => (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={decision === o.id}
              disabled={o.disabled}
              onClick={() => setDecision(o.id)}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45',
                decision === o.id ? 'border-brand-600 bg-brand-50 ring-2 ring-brand-200' : 'border-line-strong hover:bg-sunken',
              )}
            >
              <span className="flex items-center gap-1.5 text-[13.5px] font-semibold">
                <o.icon className="size-3.5" /> {o.label}
              </span>
              <span className="text-[11.5px] text-muted">{o.hint}</span>
            </button>
          ))}
        </div>

        {decision === 'correct' && (
          <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Value as printed in the report" htmlFor="rv-printed">
                <Input id="rv-printed" inputMode="decimal" value={printed} onChange={(e) => setPrinted(e.target.value)} />
              </Field>
              <Field label="Unit scale" htmlFor="rv-scale">
                <select id="rv-scale" value={scale} onChange={(e) => setScale(Number(e.target.value))} className="h-9 w-full rounded-lg border border-line-strong bg-surface px-3 text-sm">
                  {SCALES[unitType].map(([label, m]) => (
                    <option key={label} value={m}>
                      {label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
            <div className="text-[13px] text-muted">
              Normalised value: <span className="tnum font-semibold text-ink">{fmtValue(normalized, { currency: result.currency, unitType })}</span>
            </div>
            <Field label="Evidence quote (must appear in the document)" htmlFor="rv-quote" hint="Copy the exact passage from the source text. The decision is rejected if the quote cannot be found.">
              <Textarea id="rv-quote" rows={3} value={quote} onChange={(e) => setQuote(e.target.value)} className="font-mono text-[12.5px]" />
            </Field>
            {quote.trim() && printed.trim() && !quoteHasValue && <p className="text-[12.5px] text-bad">The quote does not contain the value you entered.</p>}
          </div>
        )}

        <Field label={needsComment ? 'Comment (required: this result failed validation)' : 'Comment (optional)'} htmlFor="rv-comment">
          <Textarea id="rv-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Reviewer" htmlFor="rv-name">
            <Input id="rv-name" value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          </Field>
          <Button variant="primary" loading={submit.isPending} disabled={correctInvalid || (needsComment && !comment.trim())} onClick={() => submit.mutate()}>
            Save decision
          </Button>
        </div>
        <ErrorNote error={submit.error} />
      </div>
    </Card>
  )
}

export default function ReviewQueue() {
  const [params] = useSearchParams()
  const queue = useReviewQueue()
  const history = useReviews()
  const specs = useSpecifications()
  const [tab, setTab] = useState<'queue' | 'history'>('queue')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const autoSel = useRef(false)

  const items = useMemo(() => queue.data ?? [], [queue.data])
  const selected = items.find((r) => r.id === selectedId) ?? items[0]
  const specBy = new Map((specs.data ?? []).map((s) => [s.key, s]))

  useEffect(() => {
    if (params.get('scenario') === 'D' && !autoSel.current && items.length) {
      autoSel.current = true
      // Prefer a narrative-sourced, low-confidence result: a realistic "needs a human glance" case.
      const pick = items.find((r) => r.status === 'found' && r.queue_reasons?.some((x) => x.startsWith('Confidence'))) ?? items[0]
      setSelectedId(pick.id)
    }
  }, [params, items])

  return (
    <>
      <PageHeader
        eyebrow="Run & review"
        title="Review Queue"
        description="Results the system is not sure about: low confidence, failed validation, or conflicting evidence. Analysts approve, reject or correct - corrections must cite a passage that exists in the report."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-5"
        tabs={[
          { id: 'queue', label: 'Needs review', count: items.length },
          { id: 'history', label: 'History', count: history.data?.length ?? 0 },
        ]}
      />
      {tab === 'queue' && (
        <>
          <ErrorNote error={queue.error} />
          {queue.isLoading ? (
            <Spinner />
          ) : items.length === 0 ? (
            <EmptyState title="Queue is clear">Every current result is either validated with high confidence or has been reviewed. Run extraction again or reset the demo to repopulate the queue.</EmptyState>
          ) : (
            <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
              <Card className="h-fit overflow-hidden">
                <ul className="max-h-[70vh] divide-y divide-line overflow-y-auto scroll-thin" aria-label="Review items">
                  {items.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => setSelectedId(r.id)} className={cn('block w-full px-4 py-3 text-left hover:bg-canvas', selected?.id === r.id && 'bg-brand-50')} data-testid="queue-item">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[13.5px] font-semibold">
                            {r.company_name.split(' ')[0]} FY{r.fiscal_year} · {r.specification_name}
                          </span>
                          <ValidationBadge status={r.validation_status} />
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {r.status === 'found' ? <ConfidenceBar value={r.confidence} /> : <Badge tone="warn">{r.status}</Badge>}
                        </div>
                        <div className="mt-1 text-[12px] text-muted">{snippet(r.queue_reasons?.join(' · ') ?? '', 90)}</div>
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
              {selected && (
                <div className="min-w-0 space-y-5" key={selected.id}>
                  <Card className="p-5">
                    <ResultDetail result={selected} spec={specBy.get(selected.specification_key)} />
                  </Card>
                  <DecisionPanel result={selected} unitType={specBy.get(selected.specification_key)?.unit_type ?? 'currency'} onDone={() => setSelectedId(null)} />
                </div>
              )}
            </div>
          )}
        </>
      )}
      {tab === 'history' && (
        <Card>
          <CardHeader title="Review history" subtitle="Every decision, newest first" />
          {history.isLoading ? (
            <Spinner />
          ) : !history.data?.length ? (
            <div className="px-5 py-10">
              <Callout tone="info">No decisions yet. Review an item in the queue and it will appear here.</Callout>
            </div>
          ) : (
            <div className={tableCls.wrap}>
              <table className={tableCls.table} data-testid="review-history">
                <thead>
                  <tr>
                    <th className={tableCls.th}>When</th>
                    <th className={tableCls.th}>Result</th>
                    <th className={tableCls.th}>Decision</th>
                    <th className={tableCls.th}>Corrected value</th>
                    <th className={tableCls.th}>Reviewer</th>
                    <th className={tableCls.th}>Comment / evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {history.data.map((h) => (
                    <tr key={h.id}>
                      <td className={cn(tableCls.td, 'whitespace-nowrap text-muted')}>{fmtDateTime(h.created_at)}</td>
                      <td className={tableCls.td}>{h.result_summary}</td>
                      <td className={tableCls.td}>
                        <Badge tone={h.decision === 'approve' ? 'ok' : h.decision === 'reject' ? 'bad' : 'brand'}>{h.decision}</Badge>
                      </td>
                      <td className={cn(tableCls.td, 'tnum')}>{h.corrected_value !== null ? h.corrected_value.toLocaleString('en-US') : '—'}</td>
                      <td className={tableCls.td}>{h.reviewer}</td>
                      <td className={cn(tableCls.td, 'max-w-sm text-muted')}>
                        {h.comment && <div className="text-ink-2">{h.comment}</div>}
                        {h.evidence_quote && <div className="font-mono text-[11.5px]">“{snippet(h.evidence_quote, 110)}”</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
    </>
  )
}
