import { ArrowRight, Check } from 'lucide-react'
import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, Card, PageHeader } from '@/components/ui'
import { isDemoMode } from '@/lib/api'
import { WALKTHROUGH_STEPS, useTour, type StepId } from '@/lib/store'
import { useProviderStatus } from '@/hooks/queries'

interface Step {
  id: StepId
  title: string
  summary: string
  lookFor: string[]
  to: string
  cta: string
}

const STEPS: Step[] = [
  {
    id: 'A',
    title: 'Extract FY2024 Revenue for Northstar Energy',
    summary: 'Run the deterministic reader on one report and one specification.',
    lookFor: ['Value $9,967,000,000 read from the FY2024 column (not FY2023)', 'A verbatim evidence quote with exact character offsets', 'Passing validation: grounded, year-aligned, unit stated'],
    to: '/app/extraction?scenario=A',
    cta: 'Open the Extraction Workbench',
  },
  {
    id: 'B',
    title: 'Relationship retrieval: table + adjacent note',
    summary: 'Compare retrieval with and without graph expansion for Cascade Retail CapEx.',
    lookFor: ['Left: only directly matched chunks', 'Right: extra chunks pulled through the chunk graph (table → adjacent note)', 'Each graph hit shows its relation and the chunk it came from'],
    to: '/app/retrieval?scenario=B',
    cta: 'Open the Retrieval Explorer',
  },
  {
    id: 'C',
    title: 'A candidate prompt configuration changes the outcome',
    summary: 'Flip a structured control and test it against a report.',
    lookFor: ['Turn off "Respect exclusion terms" and test Cascade FY2024 Scope 2', 'Extraction flips from a clean value to an ambiguous result', 'Validation fails - free-form prompt text edits would not have changed this in mock mode'],
    to: '/app/prompts?scenario=C',
    cta: 'Open the Prompt Studio',
  },
  {
    id: 'D',
    title: 'Correct a value in the review queue',
    summary: 'Pick a flagged result, supply a value and a quote from the report, then save.',
    lookFor: ['Queue reasons (low confidence, failed validation, conflicts)', 'A correction requires an exact quote that exists in the document', 'The decision shows up in History and the audit log'],
    to: '/app/review?scenario=D',
    cta: 'Open the Review Queue',
  },
  {
    id: 'E',
    title: 'Historical replay blocks a regressing candidate',
    summary: 'Replay the pinned incident suite: candidate v3 fixes some cases and breaks others.',
    lookFor: ['Improved: Atlas "Operating revenue" and Adjusted-EBITDA false positives', 'Regressed: Cascade Scope 2 (market-based figure leaks in)', 'Accuracy goes up, but the pinned-case gate fails, so promotion is blocked'],
    to: '/app/evaluation?scenario=E',
    cta: 'Open the Evaluation Lab',
  },
  {
    id: 'F',
    title: 'Chat with citations - and "insufficient evidence"',
    summary: 'Ask a supported question, then an unsupported one.',
    lookFor: ['Supported: answer with a clickable citation into the source text', 'Unsupported (e.g. the CEO, or FY2030): the assistant refuses to guess', 'Revenue vs Net sales: a different line item is never substituted'],
    to: '/app/chat?scenario=F',
    cta: 'Open Research Chat',
  },
  {
    id: 'G',
    title: 'Works with no API keys',
    summary: 'Confirm the whole product ran without any provider, network or secret.',
    lookFor: ['Only the offline mock provider is configured', 'Paid providers refuse to run - there is no silent fallback', 'Switch your browser offline and repeat scenario A'],
    to: '/app/settings',
    cta: 'Check provider status',
  },
]

export default function Walkthrough() {
  const { done, complete, reset } = useTour()
  const providers = useProviderStatus()
  useEffect(() => {
    // G is verified, not performed: it is satisfied once the provider status confirms offline operation.
    if (isDemoMode && providers.data && providers.data.providers.filter((p) => p.configured).every((p) => !p.paid)) complete('G')
  }, [providers.data, complete])

  return (
    <>
      <PageHeader
        eyebrow="Try the demo"
        title="Guided walkthrough"
        description="Seven short scenarios covering extraction, retrieval, prompt controls, human review, release gating, grounded chat and offline operation. Each opens the real workspace page, pre-configured."
        actions={
          <Button variant="secondary" onClick={reset} disabled={!done.length}>
            Clear progress
          </Button>
        }
      />
      {isDemoMode && (
        <Callout tone="info" title="You are in Demo / Mock Mode" className="mb-6">
          Everything below runs in your browser against four fictional companies. State is saved locally; use <strong>Reset demo</strong> (top right) to start over.
        </Callout>
      )}
      <div className="mb-5 flex items-center gap-3">
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
          <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${(done.length / WALKTHROUGH_STEPS.length) * 100}%` }} />
        </div>
        <span className="tnum text-[13px] font-medium text-muted">
          {done.length} of {WALKTHROUGH_STEPS.length} complete
        </span>
      </div>
      <ol className="space-y-4">
        {STEPS.map((s) => {
          const isDone = done.includes(s.id)
          return (
            <li key={s.id}>
              <Card className="p-5">
                <div className="flex gap-4">
                  <div className={`font-display flex size-10 shrink-0 items-center justify-center rounded-full text-lg font-semibold ${isDone ? 'bg-brand-700 text-white' : 'bg-brand-50 text-brand-700'}`}>
                    {isDone ? <Check className="size-5" aria-label="Completed" /> : s.id}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-display text-[19px] font-semibold">{s.title}</h2>
                      {isDone && <Badge tone="ok">Done</Badge>}
                    </div>
                    <p className="mt-0.5 text-[14px] text-muted">{s.summary}</p>
                    <ul className="mt-3 space-y-1 text-[13.5px] text-ink-2">
                      {s.lookFor.map((l) => (
                        <li key={l} className="flex gap-2">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-brand-500" aria-hidden />
                          {l}
                        </li>
                      ))}
                    </ul>
                    <Link to={s.to} className="mt-4 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 text-sm font-medium text-white hover:bg-brand-800">
                      {s.cta} <ArrowRight className="size-3.5" />
                    </Link>
                  </div>
                </div>
              </Card>
            </li>
          )
        })}
      </ol>
    </>
  )
}
