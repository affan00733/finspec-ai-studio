import { useMutation } from '@tanstack/react-query'
import { ArrowRight, CheckCircle2, ShieldAlert, ShieldCheck, XCircle } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { OutcomeBadge } from '@/components/badges'
import { Badge, Button, Callout, Card, CardHeader, ErrorNote, Field, PageHeader, Select, Spinner, Stat, tableCls } from '@/components/ui'
import { useEvalDatasets, useEvalRuns, usePromptTemplates, useRefreshAll } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fmtDateTime, fmtNumber, pct, shortCompany } from '@/lib/format'
import { useToasts, useTour } from '@/lib/store'
import type { CaseChange, EvaluationComparison } from '@/types'

const CHANGE_STYLE: Record<CaseChange['change'], { tone: 'ok' | 'bad' | 'neutral' | 'warn'; label: string }> = {
  improved: { tone: 'ok', label: 'Improved' },
  regressed: { tone: 'bad', label: 'Regressed' },
  unchanged_pass: { tone: 'neutral', label: 'Unchanged · pass' },
  unchanged_fail: { tone: 'warn', label: 'Unchanged · fail' },
  changed_fail: { tone: 'warn', label: 'Still failing (different)' },
}

const val = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US', { maximumFractionDigits: 0 }))

export default function EvaluationLab() {
  const [params] = useSearchParams()
  const datasets = useEvalDatasets()
  const templates = usePromptTemplates()
  const history = useEvalRuns()
  const refresh = useRefreshAll()
  const toast = useToasts()
  const complete = useTour((s) => s.complete)

  const versions = templates.data?.find((t) => t.kind === 'extraction')?.versions ?? []
  const active = versions.find((v) => v.status === 'active')
  const candidates = versions.filter((v) => v.status === 'candidate')
  const [datasetId, setDatasetId] = useState(1)
  const [baseId, setBaseId] = useState<number | null>(null)
  const [candId, setCandId] = useState<number | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [only, setOnly] = useState<'all' | 'improved' | 'regressed' | 'pinned'>('all')
  const [cmp, setCmp] = useState<EvaluationComparison | null>(null)
  const autoRan = useRef(false)

  const baseline = baseId ?? active?.id
  const candidate = candId ?? candidates.at(-1)?.id ?? versions.find((v) => v.id !== baseline)?.id

  const replay = useMutation({
    mutationFn: async (p: { dataset: number; baseline: number; candidate: number }) => {
      const b = await api.runEvaluation({ dataset: p.dataset, prompt_version: p.baseline })
      const c = await api.runEvaluation({ dataset: p.dataset, prompt_version: p.candidate })
      return api.compareEvaluations(b.id, c.id)
    },
    onSuccess: (r) => {
      setCmp(r)
      refresh()
      if (r.summary.improved > 0 && r.summary.regressed > 0 && !r.gate.passed) complete('E')
    },
  })
  const promote = useMutation({
    mutationFn: (id: number) => api.activatePromptVersion(id),
    onSuccess: (v) => {
      refresh()
      toast.push('ok', `${v.label} is now the active production version.`)
    },
    onError: (e) => {
      refresh()
      toast.push('bad', (e as Error).message)
    },
  })

  useEffect(() => {
    if (params.get('scenario') !== 'E' || autoRan.current || !active || !candidates.length) return
    autoRan.current = true
    replay.mutate({ dataset: 1, baseline: active.id, candidate: candidates[candidates.length - 1].id })
  }, [params, active, candidates, replay])

  const shown = useMemo(() => {
    if (!cmp) return []
    let rows = cmp.changes
    if (!showAll) rows = rows.filter((c) => c.change === 'improved' || c.change === 'regressed' || c.change === 'changed_fail')
    if (only === 'improved') rows = rows.filter((c) => c.change === 'improved')
    if (only === 'regressed') rows = rows.filter((c) => c.change === 'regressed')
    if (only === 'pinned') rows = rows.filter((c) => c.pinned)
    return rows
  }, [cmp, showAll, only])

  const bySpec = useMemo(() => {
    if (!cmp) return []
    return Object.keys(cmp.baseline.metrics.by_specification).map((k) => ({
      spec: k,
      baseline: Math.round(cmp.baseline.metrics.by_specification[k].accuracy * 1000) / 10,
      candidate: Math.round((cmp.candidate.metrics.by_specification[k]?.accuracy ?? 0) * 1000) / 10,
    }))
  }, [cmp])

  const selectedCandidate = versions.find((v) => v.id === candidate)
  const canReplay = Boolean(baseline && candidate && baseline !== candidate)
  const dAcc = cmp ? cmp.deltas.accuracy * 100 : 0

  return (
    <>
      <PageHeader
        eyebrow="Govern"
        title="Evaluation Lab"
        description="Replay historical cases against a candidate prompt configuration. Better average accuracy is not enough: if a pinned incident case regresses, the release gate blocks promotion."
      />
      <Card className="mb-5">
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-[1.3fr_1fr_1fr_auto]">
          <Field label="Dataset" htmlFor="ev-ds">
            <Select id="ev-ds" value={datasetId} onChange={(e) => setDatasetId(Number(e.target.value))}>
              {datasets.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} · {d.case_count} cases
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Baseline (production)" htmlFor="ev-base">
            <Select id="ev-base" value={baseline ?? ''} onChange={(e) => setBaseId(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.status})
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Candidate" htmlFor="ev-cand">
            <Select id="ev-cand" value={candidate ?? ''} onChange={(e) => setCandId(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} ({v.status})
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" loading={replay.isPending} disabled={!canReplay} onClick={() => replay.mutate({ dataset: datasetId, baseline: baseline!, candidate: candidate! })}>
              Replay &amp; compare
            </Button>
          </div>
        </div>
        {selectedCandidate?.scenario && (
          <div className="border-t border-line px-5 py-3 text-[13px] text-muted">
            <Badge tone="warn" className="mr-2">
              demo scenario
            </Badge>
            {selectedCandidate.scenario}
          </div>
        )}
      </Card>
      <ErrorNote error={replay.error} />
      {replay.isPending && <Spinner label="Replaying historical cases" />}

      {cmp && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <Stat label={`Accuracy · ${cmp.baseline.prompt_version_label.split(' ')[0]}`} value={pct(cmp.baseline.metrics.overall.accuracy)} hint={`${cmp.baseline.metrics.overall.total} cases`} />
            <Stat label={`Accuracy · ${cmp.candidate.prompt_version_label.split(' ')[0]}`} value={pct(cmp.candidate.metrics.overall.accuracy)} tone={dAcc >= 0 ? 'ok' : 'bad'} hint={`${dAcc >= 0 ? '+' : ''}${fmtNumber(dAcc)} pp vs baseline`} />
            <Stat label="Improved" value={cmp.summary.improved} tone="ok" hint="cases that now pass" />
            <Stat label="Regressed" value={cmp.summary.regressed} tone={cmp.summary.regressed ? 'bad' : 'ok'} hint={`${cmp.changes.filter((c) => c.change === 'regressed' && c.pinned).length} on pinned incident cases`} />
            <Stat label="False positives" value={`${cmp.baseline.metrics.overall.false_positive} → ${cmp.candidate.metrics.overall.false_positive}`} tone={cmp.deltas.false_positive > 0 ? 'bad' : undefined} hint="values reported where none exist" />
          </div>

          <Card className={cn('mt-5 border-2', cmp.gate.passed ? 'border-ok/40' : 'border-bad/40')} data-testid="release-gate">
            <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-4">
              <div className="flex items-center gap-3">
                {cmp.gate.passed ? <ShieldCheck className="size-8 text-ok" aria-hidden /> : <ShieldAlert className="size-8 text-bad" aria-hidden />}
                <div>
                  <div className="font-display text-xl font-semibold">{cmp.gate.passed ? 'Release gate passed' : 'Promotion blocked'}</div>
                  <div className="text-[13.5px] text-muted">
                    {cmp.gate.passed
                      ? `${cmp.candidate.prompt_version_label} does not regress any pinned case and can replace ${cmp.baseline.prompt_version_label}.`
                      : `${cmp.candidate.prompt_version_label} cannot replace ${cmp.baseline.prompt_version_label} until the failing checks are fixed.`}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Link to="/app/prompts" className="text-[13.5px] font-medium text-brand-700 hover:underline">
                  Edit in Prompt Studio
                </Link>
                <Button
                  variant="primary"
                  disabled={!cmp.gate.passed || cmp.candidate.prompt_version === cmp.baseline.prompt_version}
                  loading={promote.isPending}
                  onClick={() => promote.mutate(cmp.candidate.prompt_version)}
                  title={cmp.gate.passed ? 'Promote to production' : 'Blocked by the release gate'}
                >
                  Promote {cmp.candidate.prompt_version_label.split(' ')[0]}
                </Button>
              </div>
            </div>
            <ul className="divide-y divide-line border-t border-line">
              {cmp.gate.checks.map((g) => (
                <li key={g.id} className="flex items-start gap-3 px-5 py-2.5 text-[13.5px]">
                  {g.passed ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-label="Passed" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-label="Failed" />}
                  <div>
                    <div className="font-medium">{g.label}</div>
                    <div className="text-muted">{g.detail}</div>
                  </div>
                </li>
              ))}
            </ul>
            {!cmp.gate.passed && (
              <div className="border-t border-line bg-canvas px-5 py-3 text-[13px] text-muted">
                <ArrowRight className="mr-1 inline size-3.5" />
                To fix: open the candidate in the Prompt Studio, restore the guardrail that regressed (see the Regressed rows below), save it as a new candidate and replay again.
              </div>
            )}
          </Card>
          {promote.error && (
            <div className="mt-3">
              <ErrorNote error={promote.error} />
            </div>
          )}

          <Card className="mt-5">
            <CardHeader title="Case-by-case changes" subtitle={`${cmp.baseline.dataset_name}`} actions={
              <div className="flex items-center gap-2">
                <Select aria-label="Filter changes" className="h-8 w-40 text-[13px]" value={only} onChange={(e) => setOnly(e.target.value as typeof only)}>
                  <option value="all">All changes</option>
                  <option value="improved">Improved only</option>
                  <option value="regressed">Regressed only</option>
                  <option value="pinned">Pinned cases only</option>
                </Select>
                <label className="flex items-center gap-1.5 text-[13px] text-muted">
                  <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} className="accent-[#243bb5]" /> include unchanged
                </label>
              </div>
            } />
            <div className={tableCls.wrap}>
              <table className={tableCls.table}>
                <thead>
                  <tr>
                    <th className={tableCls.th}>Case</th>
                    <th className={tableCls.th}>Expected</th>
                    <th className={tableCls.th}>Baseline</th>
                    <th className={tableCls.th}>Candidate</th>
                    <th className={tableCls.th}>Change</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c) => (
                    <tr key={`${c.document}-${c.specification_key}`} className={cn(c.change === 'regressed' && 'bg-bad-bg/40', c.change === 'improved' && 'bg-ok-bg/40')} data-testid="change-row" data-change={c.change}>
                      <td className={tableCls.td}>
                        <div className="font-medium">
                          {shortCompany(c.company_name)} FY{c.fiscal_year} · {c.specification_key}
                        </div>
                        {c.pinned && (
                          <div className="mt-0.5 flex items-start gap-1.5 text-[12px] text-muted">
                            <Badge tone="brand">pinned</Badge>
                            <span>{c.incident}</span>
                          </div>
                        )}
                      </td>
                      <td className={cn(tableCls.td, 'tnum')}>{c.expected_value === null ? <span className="text-muted">not reported</span> : val(c.expected_value)}</td>
                      <td className={tableCls.td}>
                        <OutcomeBadge outcome={c.baseline_outcome} />
                        <div className="tnum mt-0.5 text-[12px] text-muted">{val(c.baseline_value)}</div>
                      </td>
                      <td className={tableCls.td}>
                        <OutcomeBadge outcome={c.candidate_outcome} />
                        <div className="tnum mt-0.5 text-[12px] text-muted">{val(c.candidate_value)}</div>
                      </td>
                      <td className={tableCls.td}>
                        <Badge tone={CHANGE_STYLE[c.change].tone}>{CHANGE_STYLE[c.change].label}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">No cases match this filter.</div>}
            </div>
          </Card>

          <Card className="mt-5">
            <CardHeader title="Accuracy by specification" subtitle="Baseline vs candidate" />
            <div className="h-72 px-3 py-4">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={bySpec} margin={{ left: 0, right: 12 }}>
                  <CartesianGrid stroke="#e2e6ee" vertical={false} />
                  <XAxis dataKey="spec" tick={{ fontSize: 11, fill: '#64748b' }} interval={0} angle={-25} textAnchor="end" height={60} axisLine={false} tickLine={false} />
                  <YAxis domain={[80, 100]} unit="%" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={44} />
                  <Tooltip contentStyle={{ borderRadius: 8, border: '1px solid #e2e6ee', fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="baseline" name="Baseline" fill="#a5b4fc" radius={[3, 3, 0, 0]} />
                  <Bar dataKey="candidate" name="Candidate" fill="#243bb5" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
        </>
      )}

      {!cmp && !replay.isPending && (
        <Callout tone="info" title="Nothing replayed yet">
          Choose a baseline and a candidate and press <strong>Replay &amp; compare</strong>. The seeded candidate (v3) is built to improve some historical cases while regressing others.
        </Callout>
      )}

      <Card className="mt-5">
        <CardHeader title="Evaluation history" subtitle="Every replay is stored with its exact controls" />
        {history.isLoading ? (
          <Spinner />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Run</th>
                  <th className={tableCls.th}>Version</th>
                  <th className={tableCls.th}>Dataset</th>
                  <th className={tableCls.th}>Accuracy</th>
                  <th className={tableCls.th}>F1</th>
                  <th className={tableCls.th}>False pos.</th>
                  <th className={tableCls.th}>When</th>
                </tr>
              </thead>
              <tbody>
                {history.data?.slice(0, 10).map((r) => (
                  <tr key={r.id}>
                    <td className={tableCls.td}>#{r.id}</td>
                    <td className={tableCls.td}>{r.prompt_version_label}</td>
                    <td className={tableCls.td}>{r.dataset_name}</td>
                    <td className={cn(tableCls.td, 'tnum')}>{pct(r.metrics.overall.accuracy, 2)}</td>
                    <td className={cn(tableCls.td, 'tnum')}>{r.metrics.overall.f1.toFixed(3)}</td>
                    <td className={cn(tableCls.td, 'tnum')}>{r.metrics.overall.false_positive}</td>
                    <td className={cn(tableCls.td, 'text-muted')}>{fmtDateTime(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
