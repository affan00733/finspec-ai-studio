import { ArrowRight, ClipboardCheck, FileText, FlaskConical, Gauge, Layers } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, CardHeader, ErrorNote, PageHeader, Spinner, Stat } from '@/components/ui'
import { useDocuments, useMonitoring, usePromptTemplates, useRuns, useSpecifications } from '@/hooks/queries'
import { fmtDateTime, pct } from '@/lib/format'
import { WALKTHROUGH_STEPS, useTour } from '@/lib/store'

const VALIDATION_COLORS: Record<string, string> = { pass: '#0f7b53', warn: '#d98a00', fail: '#b4233a', not_applicable: '#94a3b8' }
const VALIDATION_LABELS: Record<string, string> = { pass: 'Validated', warn: 'Warnings', fail: 'Failed', not_applicable: 'Not reported' }

export default function Dashboard() {
  const mon = useMonitoring()
  const runs = useRuns()
  const docs = useDocuments()
  const specs = useSpecifications()
  const prompts = usePromptTemplates()
  const done = useTour((s) => s.done)

  if (mon.isLoading || !mon.data) return <Spinner />
  const m = mon.data
  const active = prompts.data?.find((t) => t.kind === 'extraction')?.versions.find((v) => v.status === 'active')
  const candidate = prompts.data?.find((t) => t.kind === 'extraction')?.versions.find((v) => v.status === 'candidate')
  const lastEval = [...m.eval_history].reverse().find((e) => active && e.label === active.label.split(' ')[0])
  const validationData = Object.entries(m.validation).map(([k, v]) => ({ key: k, name: VALIDATION_LABELS[k] ?? k, value: v }))

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Dashboard"
        description="Health of the extraction pipeline: corpus, latest run quality, review backlog and release readiness of the active prompt configuration."
      />
      <ErrorNote error={mon.error} />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Stat label="Reports indexed" value={docs.data?.length ?? '—'} hint="4 companies · FY2022–FY2024" icon={<FileText className="size-4" />} />
        <Stat label="Specifications" value={specs.data?.filter((s) => s.is_active).length ?? '—'} hint="Active metric definitions" icon={<Layers className="size-4" />} />
        <Stat label="Latest run found rate" value={pct(m.run_history.at(-1)?.found_rate, 0)} hint={`${m.runs} run${m.runs === 1 ? '' : 's'} so far`} icon={<Gauge className="size-4" />} />
        <Stat label="Review backlog" value={m.review_backlog} tone={m.review_backlog ? 'warn' : 'ok'} hint={<Link to="/app/review" className="font-medium text-brand-700 hover:underline">Open review queue</Link>} icon={<ClipboardCheck className="size-4" />} />
        <Stat label={`Accuracy · ${active?.label.split(' ')[0] ?? 'active'}`} value={pct(lastEval?.accuracy)} hint="Demo gold set, 156 cases" icon={<FlaskConical className="size-4" />} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Accuracy by prompt version" subtitle="Evaluation on the demo gold set (company × year × specification)" />
          <div className="h-64 px-3 py-4">
            {m.eval_history.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={m.eval_history.map((e) => ({ ...e, accuracy: Math.round(e.accuracy * 1000) / 10 }))} margin={{ left: 0, right: 16, top: 8, bottom: 0 }}>
                  <CartesianGrid stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="label" padding={{ left: 24, right: 24 }} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis domain={[80, 100]} unit="%" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip formatter={(v) => [`${v}%`, 'Accuracy']} contentStyle={{ borderRadius: 8, border: '1px solid #e2e6ee', fontSize: 12 }} />
                  <Line type="monotone" dataKey="accuracy" stroke="#243bb5" strokeWidth={2.5} dot={{ r: 4, fill: '#243bb5' }} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="py-16 text-center text-sm text-muted">Run an evaluation to see accuracy history.</div>
            )}
          </div>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Validation outcomes" subtitle={`Latest result per report × spec · ${m.results}`} />
          <div className="h-64 px-3 py-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={validationData} layout="vertical" margin={{ left: 8, right: 16 }}>
                <CartesianGrid stroke="#e2e6ee" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} width={86} />
                <Tooltip cursor={{ fill: '#f1f3f9' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e6ee', fontSize: 12 }} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {validationData.map((d) => (
                    <Cell key={d.key} fill={VALIDATION_COLORS[d.key] ?? '#64748b'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title="Recent runs" actions={<Link to="/app/extraction" className="text-[13px] font-medium text-brand-700 hover:underline">New run</Link>} />
          {runs.isLoading ? (
            <Spinner />
          ) : (
            <ul className="divide-y divide-line">
              {runs.data?.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-4 px-5 py-3">
                  <div className="min-w-0">
                    <div className="truncate text-[14px] font-medium">
                      #{r.id} · {r.label}
                    </div>
                    <div className="text-[12.5px] text-muted">
                      {fmtDateTime(r.created_at)} · {r.metrics.documents} reports · {r.specification_keys.length} specs · {r.agent_name}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge tone="ok">{pct(r.metrics.found_rate, 0)} found</Badge>
                    <Badge tone={r.metrics.by_validation.fail ? 'bad' : 'neutral'}>{r.metrics.by_validation.fail ?? 0} failed</Badge>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <Card className="p-5">
            <div className="text-[12px] font-semibold tracking-wider text-muted uppercase">Release readiness</div>
            {candidate ? (
              <>
                <div className="mt-1.5 text-[15px] font-semibold">{candidate.label}</div>
                <p className="mt-1 text-[13px] text-muted">{candidate.scenario ?? candidate.notes}</p>
                <Link to="/app/evaluation?scenario=E" className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand-700 hover:underline">
                  Replay historical cases <ArrowRight className="size-3.5" />
                </Link>
              </>
            ) : (
              <p className="mt-1.5 text-[13.5px] text-muted">No candidate version is waiting for evaluation.</p>
            )}
          </Card>
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="text-[12px] font-semibold tracking-wider text-muted uppercase">Guided walkthrough</div>
              <Badge tone="brand">
                {done.length}/{WALKTHROUGH_STEPS.length}
              </Badge>
            </div>
            <div className="mt-3 flex gap-1.5">
              {WALKTHROUGH_STEPS.map((s) => (
                <span key={s} className={`flex size-7 items-center justify-center rounded-full text-xs font-semibold ${done.includes(s) ? 'bg-brand-700 text-white' : 'bg-sunken text-muted'}`}>
                  {s}
                </span>
              ))}
            </div>
            <Link to="/app/walkthrough" className="mt-3 inline-flex items-center gap-1 text-[13.5px] font-semibold text-brand-700 hover:underline">
              Continue walkthrough <ArrowRight className="size-3.5" />
            </Link>
          </Card>
        </div>
      </div>
    </>
  )
}
