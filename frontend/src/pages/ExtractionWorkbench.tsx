import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Play } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ConfidenceBar, ReviewBadge, StatusBadge, ValidationBadge } from '@/components/badges'
import { ResultDetail } from '@/components/ResultDetail'
import { Badge, Button, Callout, Card, CardHeader, Drawer, ErrorNote, Field, PageHeader, Select, Spinner, tableCls } from '@/components/ui'
import { useAgents, useDocuments, usePromptTemplates, useResults, useRuns, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fmtValue } from '@/lib/format'
import { useTour } from '@/lib/store'
import type { ExtractionResult } from '@/types'

const CONTROL_LABELS: [keyof import('@/demo/engineTypes').ExtractionPolicy, string][] = [
  ['graphExpansion', 'Graph expansion'],
  ['applyExclusions', 'Exclusion terms'],
  ['strictLineItemContext', 'Strict line-item context'],
  ['enforceFiscalYear', 'Fiscal-year alignment'],
  ['applyUnitScale', 'Unit scaling'],
  ['revenueFamilyFallback', 'Revenue-family fallback'],
]

export default function ExtractionWorkbench() {
  const [params] = useSearchParams()
  const qc = useQueryClient()
  const docs = useDocuments()
  const specs = useSpecifications()
  const agents = useAgents()
  const prompts = usePromptTemplates()
  const runs = useRuns()
  const complete = useTour((s) => s.complete)

  const [docSel, setDocSel] = useState<string>('all')
  const [specSel, setSpecSel] = useState<string[]>([])
  const [agentId, setAgentId] = useState<number>(1)
  const [versionId, setVersionId] = useState<number | null>(null)
  const [runId, setRunId] = useState<number | undefined>(undefined)
  const [open, setOpen] = useState<ExtractionResult | null>(null)
  const [filter, setFilter] = useState('')
  const autoRan = useRef(false)

  const versions = prompts.data?.find((t) => t.kind === 'extraction')?.versions ?? []
  const active = versions.find((v) => v.status === 'active')
  const version = versions.find((v) => v.id === (versionId ?? active?.id))

  const run = useMutation({
    mutationFn: (override?: { documentIds?: number[]; specKeys?: string[] }) =>
      api.createRun({
        document_ids: override?.documentIds ?? (docSel === 'all' ? undefined : docSel.startsWith('c') ? docs.data!.filter((d) => d.company === Number(docSel.slice(1))).map((d) => d.id) : [Number(docSel)]),
        specification_keys: override?.specKeys ?? (specSel.length ? specSel : undefined),
        agent: agentId,
        prompt_version: version?.id,
      }),
    onSuccess: ({ run: r, results }) => {
      setRunId(r.id)
      qc.invalidateQueries()
      const nstr = results.find((x) => x.specification_key === 'revenue' && x.company_name === 'Northstar Energy' && x.fiscal_year === 2024 && x.status === 'found')
      if (nstr) complete('A')
    },
  })

  // Scenario A: preselect Northstar FY2024 + Revenue and run once.
  useEffect(() => {
    if (params.get('scenario') !== 'A' || autoRan.current || !docs.data || !specs.data) return
    const d = docs.data.find((x) => x.company_name === 'Northstar Energy' && x.fiscal_year === 2024)
    if (!d) return
    autoRan.current = true
    setDocSel(String(d.id))
    setSpecSel(['revenue'])
    run.mutate({ documentIds: [d.id], specKeys: ['revenue'] })
  }, [params, docs.data, specs.data, run])

  const results = useResults({ run: runId }, runId !== undefined)
  const specByKey = useMemo(() => new Map((specs.data ?? []).map((s) => [s.key, s])), [specs.data])
  const rows = (results.data ?? []).filter((r) => !filter || r.status === filter || r.validation_status === filter)
  const companies = useMemo(() => [...new Map((docs.data ?? []).map((d) => [d.company, d.company_name])).entries()], [docs.data])
  const currentRun = runs.data?.find((r) => r.id === runId)
  const toggleSpec = (k: string) => setSpecSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]))

  return (
    <>
      <PageHeader
        eyebrow="Run & review"
        title="Extraction Workbench"
        description="Run the reader over reports and specifications. Every value comes with a quoted passage, exact offsets and a validation report - open any row to inspect the evidence."
      />
      <Card className="mb-5">
        <CardHeader title="Run configuration" />
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto]">
          <Field label="Reports" htmlFor="ex-docs">
            <Select id="ex-docs" value={docSel} onChange={(e) => setDocSel(e.target.value)}>
              <option value="all">All {docs.data?.length ?? ''} reports</option>
              <optgroup label="By company">
                {companies.map(([id, name]) => (
                  <option key={id} value={`c${id}`}>
                    {name} (all years)
                  </option>
                ))}
              </optgroup>
              <optgroup label="Single report">
                {docs.data?.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
              </optgroup>
            </Select>
          </Field>
          <Field label="Agent" htmlFor="ex-agent">
            <Select id="ex-agent" value={agentId} onChange={(e) => setAgentId(Number(e.target.value))}>
              {agents.data?.map((a) => (
                <option key={a.id} value={a.id} disabled={!a.available}>
                  {a.name}
                  {a.available ? '' : ' - unavailable'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Prompt configuration" htmlFor="ex-version">
            <Select id="ex-version" value={version?.id ?? ''} onChange={(e) => setVersionId(Number(e.target.value))}>
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label} {v.status === 'active' ? '(active)' : v.status === 'candidate' ? '(candidate)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" className="w-full" loading={run.isPending} onClick={() => run.mutate(undefined)}>
              <Play className="size-3.5" /> Run extraction
            </Button>
          </div>
        </div>
        <div className="border-t border-line px-5 py-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[12.5px] font-semibold text-ink-2">Specifications {specSel.length ? `(${specSel.length} selected)` : '(all active)'}</span>
            {specSel.length > 0 && (
              <button type="button" onClick={() => setSpecSel([])} className="text-xs font-medium text-brand-700 hover:underline">
                Clear selection (run all)
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {specs.data
              ?.filter((s) => s.is_active)
              .map((s) => (
                <label
                  key={s.key}
                  className={cn(
                    'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] transition-colors',
                    specSel.includes(s.key) ? 'border-brand-600 bg-brand-50 text-brand-800' : 'border-line-strong text-ink-2 hover:bg-sunken',
                  )}
                >
                  <input type="checkbox" checked={specSel.includes(s.key)} onChange={() => toggleSpec(s.key)} className="size-3.5 accent-[#243bb5]" />
                  {s.name}
                </label>
              ))}
          </div>
          {version && (
            <div className="mt-3 flex flex-wrap items-center gap-1">
              <span className="mr-1 text-[12px] text-muted">Controls:</span>
              <Badge>top-k {version.controls.topK}</Badge>
              <Badge>{version.controls.retrievalMode}</Badge>
              {CONTROL_LABELS.map(([k, label]) => (
                <Badge key={k} tone={version.controls[k] ? 'ok' : 'neutral'}>
                  {label}: {version.controls[k] ? 'on' : 'off'}
                </Badge>
              ))}
            </div>
          )}
          <div className="mt-2">
            <ErrorNote error={run.error} />
          </div>
        </div>
      </Card>
      <div>
        <div className="min-w-0 space-y-4">
          {runId === undefined ? (
            <Card className="p-10 text-center">
              <div className="font-display text-xl font-semibold">No run selected</div>
              <p className="mx-auto mt-1 max-w-md text-[14px] text-muted">Configure a run on the left, or pick a previous run to inspect its results.</p>
              <div className="mx-auto mt-4 max-w-xs">
                <Select aria-label="Previous runs" value="" onChange={(e) => setRunId(Number(e.target.value))}>
                  <option value="">Open a previous run…</option>
                  {runs.data?.map((r) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} · {r.label}
                    </option>
                  ))}
                </Select>
              </div>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title={`Run #${runId} results`}
                subtitle={currentRun ? `${currentRun.agent_name} · ${currentRun.prompt_version_label} · ${currentRun.metrics.documents} reports` : undefined}
                actions={
                  <div className="flex items-center gap-2">
                    <Select aria-label="Filter results" className="h-8 w-40 text-[13px]" value={filter} onChange={(e) => setFilter(e.target.value)}>
                      <option value="">All results</option>
                      <option value="found">Found</option>
                      <option value="not_found">Not reported</option>
                      <option value="ambiguous">Ambiguous</option>
                      <option value="fail">Validation failed</option>
                      <option value="warn">Validation warnings</option>
                    </Select>
                    <Select aria-label="Switch run" className="h-8 w-40 text-[13px]" value={runId} onChange={(e) => setRunId(Number(e.target.value))}>
                      {runs.data?.map((r) => (
                        <option key={r.id} value={r.id}>
                          Run #{r.id}
                        </option>
                      ))}
                    </Select>
                  </div>
                }
              />
              {currentRun && currentRun.mode === 'llm' && (
                <div className="px-5 pt-3">
                  <Callout tone="info">Mock LLM pipeline: a prompt was rendered for every metric and answered by the offline mock model (no network). Estimated usage: {currentRun.usage?.calls} calls, ~{currentRun.usage?.input_tokens.toLocaleString()} input tokens.</Callout>
                </div>
              )}
              {results.isLoading ? (
                <Spinner />
              ) : (
                <div className={tableCls.wrap}>
                  <table className={tableCls.table}>
                    <thead>
                      <tr>
                        <th className={tableCls.th}>Report</th>
                        <th className={tableCls.th}>Specification</th>
                        <th className={tableCls.th}>Value</th>
                        <th className={tableCls.th}>As reported</th>
                        <th className={tableCls.th}>Status</th>
                        <th className={tableCls.th}>Confidence</th>
                        <th className={tableCls.th}>Validation</th>
                        <th className={tableCls.th}>Review</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id} className="cursor-pointer hover:bg-canvas" onClick={() => setOpen(r)} data-testid="result-row">
                          <td className={tableCls.td}>
                            <button type="button" className="text-left font-medium text-brand-800 hover:underline" onClick={() => setOpen(r)}>
                              {r.company_name.split(' ')[0]} FY{r.fiscal_year}
                            </button>
                          </td>
                          <td className={tableCls.td}>{r.specification_name}</td>
                          <td className={cn(tableCls.td, 'tnum font-medium')}>{r.status === 'found' ? fmtValue(r.normalized_value, { currency: r.currency, unitType: specByKey.get(r.specification_key)?.unit_type }) : '—'}</td>
                          <td className={cn(tableCls.td, 'tnum text-muted')}>{r.status === 'found' ? `${r.raw_value} ${r.unit_label}` : ''}</td>
                          <td className={tableCls.td}>
                            <StatusBadge status={r.status} />
                          </td>
                          <td className={tableCls.td}>{r.status === 'found' ? <ConfidenceBar value={r.confidence} /> : <span className="text-muted">—</span>}</td>
                          <td className={tableCls.td}>
                            <ValidationBadge status={r.validation_status} />
                          </td>
                          <td className={tableCls.td}>
                            <ReviewBadge status={r.review_status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">No results match this filter.</div>}
                </div>
              )}
            </Card>
          )}
        </div>
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title="Result detail" width="max-w-2xl">
        {open && <ResultDetail result={results.data?.find((r) => r.id === open.id) ?? open} spec={specByKey.get(open.specification_key)} />}
      </Drawer>
    </>
  )
}
