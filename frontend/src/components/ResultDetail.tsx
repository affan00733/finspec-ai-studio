import { CheckCircle2, CircleAlert, Info, ExternalLink, XCircle } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import { fmtValue } from '@/lib/format'
import type { ExtractionResult, Specification } from '@/types'
import { ConfidenceBar, ReviewBadge, StatusBadge, ValidationBadge } from './badges'
import { EvidenceExcerpt } from './evidence'
import { Badge } from './ui'

const ROLE_TONE = { primary: 'brand', supporting: 'ok', conflicting: 'bad', analyst: 'warn' } as const

export function CheckList({ checks }: { checks: ExtractionResult['validations'] }) {
  return (
    <ul className="divide-y divide-line rounded-lg border border-line">
      {checks.map((c) => {
        const Icon = c.passed ? CheckCircle2 : c.severity === 'error' ? XCircle : c.severity === 'warning' ? CircleAlert : Info
        const color = c.passed ? 'text-ok' : c.severity === 'error' ? 'text-bad' : c.severity === 'warning' ? 'text-warn' : 'text-faint'
        return (
          <li key={c.id} className="flex gap-2.5 px-3 py-2 text-[13px]">
            <Icon className={cn('mt-0.5 size-4 shrink-0', color)} aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[12px] font-medium text-ink-2">{c.rule}</span>
                <Badge tone={c.passed ? 'ok' : c.severity === 'error' ? 'bad' : c.severity === 'warning' ? 'warn' : 'neutral'}>{c.passed ? 'passed' : `${c.severity}`}</Badge>
              </div>
              <div className="text-muted">{c.message}</div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}

export function ResultDetail({ result, spec, showDocLink = true }: { result: ExtractionResult; spec?: Pick<Specification, 'unit_type'>; showDocLink?: boolean }) {
  const value = fmtValue(result.normalized_value, { currency: result.currency, unitType: spec?.unit_type })
  return (
    <div className="space-y-5">
      <div>
        <div className="text-[12.5px] text-muted">
          {result.company_name} · FY{result.fiscal_year}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2">
          <h3 className="text-[16px] font-semibold">{result.specification_name}</h3>
          <StatusBadge status={result.status} />
          <ValidationBadge status={result.validation_status} />
          <ReviewBadge status={result.review_status} />
        </div>
        {result.status === 'found' ? (
          <div className="mt-3">
            <div className="font-display tnum text-[32px] leading-none font-semibold">{value}</div>
            <div className="mt-1.5 text-[13px] text-muted">
              Reported as <span className="font-medium text-ink-2">{result.raw_value}</span> {result.unit_label} · {result.method} · <ConfidenceBar value={result.confidence} />
            </div>
          </div>
        ) : null}
        {result.final_value !== null && result.review_status !== 'pending' && (
          <div className="mt-3 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-[13px]">
            Final (after review): <span className="font-semibold">{fmtValue(result.final_value, { currency: result.currency, unitType: spec?.unit_type })}</span>
          </div>
        )}
        <p className="mt-3 text-[13.5px] leading-relaxed text-ink-2">{result.rationale}</p>
        {result.queue_reasons && result.queue_reasons.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {result.queue_reasons.map((r) => (
              <Badge key={r} tone="warn">
                {r}
              </Badge>
            ))}
          </ul>
        )}
      </div>

      <section>
        <h4 className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Evidence ({result.evidence.length})</h4>
        {result.evidence.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line-strong px-3 py-3 text-[13px] text-muted">No supporting passage was found - the engine does not guess a value.</p>
        ) : (
          <div className="space-y-3">
            {result.evidence.map((e) => (
              <div key={e.id}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-[12px]">
                  <Badge tone={ROLE_TONE[e.role]}>{e.role}</Badge>
                  <span className="text-muted">
                    {e.method} · score {e.score.toFixed(2)}
                    {e.raw_number ? ` · ${e.raw_number}` : ''}
                  </span>
                  {e.notes.map((n) => (
                    <Badge key={n} tone="neutral">
                      {n}
                    </Badge>
                  ))}
                  {showDocLink && (
                    <Link to={`/app/documents/${result.document}?start=${e.start_char}&end=${e.end_char}`} className="ml-auto inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                      Open in document <ExternalLink className="size-3" />
                    </Link>
                  )}
                </div>
                <EvidenceExcerpt documentId={result.document} start={e.start_char} end={e.end_char} kind={e.role === 'conflicting' ? 'conflict' : 'primary'} context={180} />
                {e.context && <div className="mt-1 text-[11.5px] text-muted">Context: {e.context}</div>}
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Validation ({result.validations.length} checks)</h4>
        <CheckList checks={result.validations} />
      </section>

      <p className="text-[12px] text-muted">
        Retrieved {result.retrieved_chunk_ids.length} chunks: <span className="font-mono">{result.retrieved_chunk_ids.join(', ') || '—'}</span>
      </p>
    </div>
  )
}
