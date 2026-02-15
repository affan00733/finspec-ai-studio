import { ArrowRight, BadgeCheck, FileSearch, GitBranch, ShieldCheck, UserCheck } from 'lucide-react'
import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { DEMO_DATASET } from '@/data/demo-dataset'
import { toSpecDef } from '@/demo/corpus'
import { DEFAULT_POLICY } from '@/demo/engineTypes'
import { runExtraction } from '@/demo/runner'
import { Logo } from '@/components/Logo'
import { Badge } from '@/components/ui'
import { isDemoMode } from '@/lib/api'
import { fmtValue } from '@/lib/format'

function HeroEvidenceCard() {
  // A real extraction from the bundled corpus, computed live in the browser.
  const r = useMemo(() => {
    const doc = DEMO_DATASET.documents.find((d) => d.company_name === 'Northstar Energy' && d.fiscal_year === 2024)!
    const spec = toSpecDef(DEMO_DATASET.specifications.find((s) => s.key === 'revenue')!)
    return { doc, res: runExtraction(DEFAULT_POLICY, [doc.id], [spec])[0] }
  }, [])
  const o = r.res.outcome
  const b = o.best!
  return (
    <div className="relative w-full max-w-[460px]">
      <div className="absolute -inset-3 -z-10 rounded-3xl bg-gradient-to-br from-brand-100/70 to-transparent" aria-hidden />
      <div className="rounded-2xl border border-line bg-surface shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <div className="text-[11px] font-semibold tracking-wider text-muted uppercase">Specification</div>
            <div className="text-[15px] font-semibold">Revenue · FY2024</div>
          </div>
          <Badge tone="ok">Validated</Badge>
        </div>
        <div className="px-5 py-4">
          <div className="text-[12.5px] text-muted">{r.doc.company_name} · extracted value</div>
          <div className="font-display tnum mt-0.5 text-[34px] leading-tight font-semibold">{fmtValue(b.normalized, { currency: b.currency ?? 'USD' })}</div>
          <div className="mt-0.5 text-[12.5px] text-muted">
            Reported as {b.raw_number} {b.unit_label} · confidence {o.confidence.toFixed(2)}
          </div>
          <div className="mt-4 rounded-lg border border-line bg-canvas p-3">
            <div className="mb-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Evidence from the report</div>
            <pre className="font-mono text-[12px] leading-relaxed whitespace-pre-wrap">
              <span className="text-faint">| Line item | FY2024 | FY2023 | Change % |{'\n'}</span>
              <mark className="ev ev-primary">{b.quote}</mark>
            </pre>
          </div>
          <ul className="mt-4 space-y-1.5 text-[12.5px]">
            {r.res.checks
              .filter((c) => c.passed && ['evidence_grounded', 'evidence_offsets', 'fiscal_year_alignment', 'unit_stated'].includes(c.rule))
              .map((c) => (
                <li key={c.rule} className="flex items-start gap-2 text-ink-2">
                  <BadgeCheck className="mt-0.5 size-3.5 shrink-0 text-ok" aria-hidden />
                  {c.message}
                </li>
              ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

const FEATURES = [
  { icon: FileSearch, title: 'Specification-driven', body: 'Define each metric once - aliases, exclusions, sign and unit policy. The same definition drives retrieval, prompts, extraction and validation.' },
  { icon: ShieldCheck, title: 'Evidence or nothing', body: 'Every value carries a verbatim quote and exact character offsets. If a line item is absent, ambiguous or the wrong measure, the answer says so - no guesses.' },
  { icon: UserCheck, title: 'Human-in-the-loop', body: 'Low confidence, failed validation and conflicting evidence route to a review queue. Corrections require a quote from the document and are fully audited.' },
  { icon: GitBranch, title: 'Regression-gated releases', body: 'Replay historical incident cases against every candidate prompt configuration. A change that fixes one case but breaks another cannot be promoted.' },
]

const PIPELINE = ['Ingest & parse', 'Chunk + graph', 'Hybrid retrieval', 'Grounded extraction', 'Validate', 'Review', 'Evaluate & release']

const SCENARIOS = [
  ['Extract FY2024 Revenue for Northstar Energy with evidence', '/app/extraction?scenario=A'],
  ['Compare retrieval with and without graph expansion', '/app/retrieval?scenario=B'],
  ['Change a candidate prompt control and watch validation react', '/app/prompts?scenario=C'],
  ['Correct a value in the review queue and see it in history', '/app/review?scenario=D'],
  ['Replay history: one case improves, one regresses, promotion is blocked', '/app/evaluation?scenario=E'],
  ['Ask a question with citations - or get "insufficient evidence"', '/app/chat?scenario=F'],
] as const

export default function Landing() {
  return (
    <div className="min-h-full bg-canvas">
      <header className="sticky top-0 z-30 border-b border-line/80 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-[1180px] items-center justify-between px-5">
          <Logo />
          <nav aria-label="Landing" className="flex items-center gap-1 text-[14px]">
            <a href="#how" className="hidden rounded-md px-3 py-1.5 text-ink-2 hover:bg-sunken sm:block">
              How it works
            </a>
            <a href="#scenarios" className="hidden rounded-md px-3 py-1.5 text-ink-2 hover:bg-sunken sm:block">
              Scenarios
            </a>
            <Link to="/app" className="rounded-md px-3 py-1.5 font-medium text-ink-2 hover:bg-sunken">
              Open workspace
            </Link>
            <Link to="/app/walkthrough" className="ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand-700 px-3.5 font-medium text-white shadow-card hover:bg-brand-800">
              Try the demo <ArrowRight className="size-3.5" />
            </Link>
          </nav>
        </div>
      </header>

      <section className="relative overflow-hidden">
        <div className="bg-grid absolute inset-0" aria-hidden />
        <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 px-5 pt-16 pb-20 lg:grid-cols-[1.05fr_0.95fr] lg:pt-24">
          <div>
            {isDemoMode && (
              <Badge tone="warn" className="mb-5">
                Demo / Mock Mode · synthetic data · runs in your browser
              </Badge>
            )}
            <h1 className="font-display text-[44px] leading-[1.06] font-semibold text-ink sm:text-[56px]">
              Annual reports in. <span className="text-brand-700">Audited data</span> out.
            </h1>
            <p className="mt-5 max-w-xl text-[17px] leading-relaxed text-ink-2">
              FinSpec AI Studio extracts financial and ESG metrics from annual reports against business specifications - with evidence for every number, validation rules, analyst review, and release gates that stop a prompt
              change from silently breaking yesterday's answers.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link to="/app/walkthrough" className="inline-flex h-11 items-center gap-2 rounded-lg bg-brand-700 px-5 text-[15px] font-medium text-white shadow-card hover:bg-brand-800">
                Try the guided demo <ArrowRight className="size-4" />
              </Link>
              <Link to="/app" className="inline-flex h-11 items-center rounded-lg border border-line-strong bg-surface px-5 text-[15px] font-medium text-ink hover:bg-sunken">
                Open the workspace
              </Link>
            </div>
            <p className="mt-4 max-w-lg text-[13px] text-muted">
              No sign-up, no backend and no API keys: the demo bundles four fictional companies, twelve annual reports and a full TypeScript extraction engine that runs offline.
            </p>
          </div>
          <div className="flex justify-center lg:justify-end">
            <HeroEvidenceCard />
          </div>
        </div>
      </section>

      <section className="border-y border-line bg-surface">
        <div className="mx-auto grid max-w-[1180px] gap-px bg-line px-0 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="bg-surface p-6">
              <f.icon className="size-5 text-brand-600" aria-hidden />
              <h2 className="font-display mt-3 text-lg font-semibold">{f.title}</h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="how" className="mx-auto max-w-[1180px] px-5 py-16">
        <h2 className="font-display text-[30px] font-semibold">One pipeline, inspectable at every step</h2>
        <p className="mt-2 max-w-2xl text-[15px] text-muted">
          Reports are parsed into sections and structure-aware chunks, linked in a relationship graph (table → caption → adjacent note), retrieved with BM25 plus lexical fusion, read by an evidence-grounded extractor and
          checked by a validation suite before anything reaches an analyst.
        </p>
        <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-7">
          {PIPELINE.map((step, i) => (
            <li key={step} className="rounded-xl border border-line bg-surface p-4 shadow-card">
              <div className="font-display text-[22px] font-semibold text-brand-600">{String(i + 1).padStart(2, '0')}</div>
              <div className="mt-1 text-[13.5px] font-semibold leading-snug">{step}</div>
            </li>
          ))}
        </ol>
      </section>

      <section id="scenarios" className="border-t border-line bg-surface">
        <div className="mx-auto grid max-w-[1180px] gap-10 px-5 py-16 lg:grid-cols-[0.8fr_1.2fr]">
          <div>
            <h2 className="font-display text-[30px] font-semibold">Try it in under five minutes</h2>
            <p className="mt-2 text-[15px] text-muted">Each scenario deep-links into the real workspace and runs on the in-browser engine. Reset the demo at any time to return to the seeded state.</p>
            <Link to="/app/walkthrough" className="mt-5 inline-flex items-center gap-1.5 text-[14px] font-semibold text-brand-700 hover:underline">
              Open the guided walkthrough <ArrowRight className="size-4" />
            </Link>
          </div>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {SCENARIOS.map(([label, to], i) => (
              <li key={to}>
                <Link to={to} className="group flex items-center gap-4 px-4 py-3.5 hover:bg-canvas">
                  <span className="font-display flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-[15px] font-semibold text-brand-700">{'ABCDEF'[i]}</span>
                  <span className="flex-1 text-[14.5px] text-ink">{label}</span>
                  <ArrowRight className="size-4 text-faint transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <footer className="border-t border-line bg-canvas">
        <div className="mx-auto flex max-w-[1180px] flex-wrap items-center justify-between gap-3 px-5 py-6 text-[12.5px] text-muted">
          <Logo className="scale-90" />
          <p className="max-w-xl">All companies, people and figures are fictional and were generated for software demonstration. Demo/Mock Mode never calls an external model.</p>
        </div>
      </footer>
    </div>
  )
}
