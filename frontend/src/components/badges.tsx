import { AlertTriangle, CheckCircle2, CircleDashed, CircleSlash, XCircle } from 'lucide-react'
import type { CaseOutcome, ExtractionStatus, ReviewStatus, ValidationStatus } from '@/types'
import { Badge, type Tone } from './ui'

const VALIDATION: Record<ValidationStatus, [Tone, string, typeof CheckCircle2]> = {
  pass: ['ok', 'Validated', CheckCircle2],
  warn: ['warn', 'Warnings', AlertTriangle],
  fail: ['bad', 'Failed', XCircle],
  not_applicable: ['neutral', 'N/A', CircleSlash],
  pending: ['neutral', 'Pending', CircleDashed],
}

export function ValidationBadge({ status }: { status: ValidationStatus }) {
  const [tone, label, Icon] = VALIDATION[status] ?? VALIDATION.pending
  return (
    <Badge tone={tone}>
      <Icon className="size-3" aria-hidden />
      {label}
    </Badge>
  )
}

const STATUS: Record<ExtractionStatus, [Tone, string]> = {
  found: ['ok', 'Found'],
  not_found: ['neutral', 'Not reported'],
  ambiguous: ['warn', 'Ambiguous'],
  rejected: ['bad', 'Rejected'],
}
export function StatusBadge({ status }: { status: ExtractionStatus }) {
  const [tone, label] = STATUS[status]
  return <Badge tone={tone}>{label}</Badge>
}

const REVIEW: Record<ReviewStatus, [Tone, string]> = {
  pending: ['neutral', 'Unreviewed'],
  approved: ['ok', 'Approved'],
  rejected: ['bad', 'Rejected'],
  corrected: ['brand', 'Corrected'],
}
export function ReviewBadge({ status }: { status: ReviewStatus }) {
  const [tone, label] = REVIEW[status]
  return <Badge tone={tone}>{label}</Badge>
}

const OUTCOME: Record<CaseOutcome, [Tone, string]> = {
  correct: ['ok', 'Correct'],
  correct_absent: ['ok', 'Correctly absent'],
  incorrect_value: ['bad', 'Wrong value'],
  missed: ['bad', 'Missed'],
  false_positive: ['bad', 'False positive'],
  abstained: ['warn', 'Abstained'],
}
export function OutcomeBadge({ outcome }: { outcome: CaseOutcome }) {
  const [tone, label] = OUTCOME[outcome]
  return <Badge tone={tone}>{label}</Badge>
}

export function ConfidenceBar({ value }: { value: number }) {
  const tone = value >= 0.9 ? 'bg-ok' : value >= 0.75 ? 'bg-brand-500' : 'bg-warn'
  return (
    <div className="flex items-center gap-2" title={`Confidence ${value.toFixed(2)}`}>
      <div className="h-1.5 w-14 overflow-hidden rounded-full bg-sunken">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </div>
      <span className="tnum text-xs text-muted">{value.toFixed(2)}</span>
    </div>
  )
}

export function DemoModeBadge({ className }: { className?: string }) {
  return (
    <Badge tone="warn" className={className} title="Everything runs in your browser on bundled synthetic data. No backend, no API keys.">
      Demo / Mock Mode
    </Badge>
  )
}
