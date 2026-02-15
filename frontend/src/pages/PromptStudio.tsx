import { useMutation, useQuery } from '@tanstack/react-query'
import { FlaskConical, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { StatusBadge, ValidationBadge } from '@/components/badges'
import { Badge, Button, Callout, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Spinner, Tabs, Textarea, Toggle } from '@/components/ui'
import { useDocuments, usePromptTemplates, useRefreshAll, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { BOOLEAN_CONTROLS, CONTROL_SHORT, diffControls } from '@/lib/controls'
import { fmtValue } from '@/lib/format'
import { useToasts, useTour } from '@/lib/store'
import type { ExtractionPolicy, ExtractionResult, RetrievalMode } from '@/types'

type Tab = 'prompt' | 'test' | 'text'

function ResultColumn({ title, subtitle, result, unitType, other }: { title: string; subtitle: string; result: ExtractionResult; unitType?: 'currency' | 'emissions'; other?: ExtractionResult }) {
  const failed = result.validations.filter((v) => !v.passed && v.severity !== 'info')
  const changed = other && (other.status !== result.status || other.normalized_value !== result.normalized_value || other.validation_status !== result.validation_status)
  return (
    <div className={cn('rounded-xl border p-4', changed ? 'border-warn/50 bg-warn-bg/40' : 'border-line bg-surface')}>
      <div className="text-[12px] font-semibold tracking-wider text-muted uppercase">{title}</div>
      <div className="text-[12.5px] text-muted">{subtitle}</div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusBadge status={result.status} />
        <ValidationBadge status={result.validation_status} />
      </div>
      <div className="font-display tnum mt-2 text-[26px] leading-tight font-semibold">{result.status === 'found' ? fmtValue(result.normalized_value, { currency: result.currency, unitType }) : '—'}</div>
      {result.status === 'found' && (
        <div className="text-[12.5px] text-muted">
          as reported: {result.raw_value} {result.unit_label}
        </div>
      )}
      <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{result.rationale}</p>
      {result.evidence[0] && <pre className="mt-3 rounded-lg bg-canvas p-2.5 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap">{result.evidence[0].quote}</pre>}
      {failed.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {failed.map((v) => (
            <li key={v.id} className="text-[12.5px]">
              <Badge tone={v.severity === 'error' ? 'bad' : 'warn'}>{v.rule}</Badge> <span className="text-muted">{v.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export default function PromptStudio() {
  const [params] = useSearchParams()
  const docs = useDocuments()
  const specs = useSpecifications()
  const templates = usePromptTemplates()
  const refresh = useRefreshAll()
  const toast = useToasts()
  const complete = useTour((s) => s.complete)

  const versions = templates.data?.find((t) => t.kind === 'extraction')?.versions ?? []
  const template = templates.data?.find((t) => t.kind === 'extraction')
  const active = versions.find((v) => v.status === 'active')

  const [baseId, setBaseId] = useState<number | null>(null)
  const base = versions.find((v) => v.id === (baseId ?? active?.id))
  const [controls, setControls] = useState<ExtractionPolicy | null>(null)
  const [system, setSystem] = useState<string | null>(null)
  const [userTpl, setUserTpl] = useState<string | null>(null)
  const [docId, setDocId] = useState<number | null>(null)
  const [specKey, setSpecKey] = useState<string>(params.get('spec') ?? 'revenue')
  const [tab, setTab] = useState<Tab>('prompt')
  const [label, setLabel] = useState('')
  const seededFor = useRef<number | null>(null)

  // Initialise editable state from the selected base version.
  useEffect(() => {
    if (base && seededFor.current !== base.id) {
      seededFor.current = base.id
      setControls({ ...base.controls })
      setSystem(base.system_prompt)
      setUserTpl(base.user_template)
    }
  }, [base])
  useEffect(() => {
    if (docId !== null || !docs.data) return
    const scenarioC = params.get('scenario') === 'C'
    const target = scenarioC ? docs.data.find((d) => d.company_name === 'Cascade Retail' && d.fiscal_year === 2024) : docs.data.find((d) => d.company_name === 'Northstar Energy' && d.fiscal_year === 2024)
    setDocId(target?.id ?? docs.data[0]?.id ?? null)
    if (scenarioC) setSpecKey('scope_2')
  }, [docs.data, docId, params])

  const c = controls ?? base?.controls
  const dirtyControls = base && c ? diffControls(base.controls, c) : []
  const textEdited = Boolean(base && ((system ?? base.system_prompt) !== base.system_prompt || (userTpl ?? base.user_template) !== base.user_template))
  const setC = (patch: Partial<ExtractionPolicy>) => setControls((cur) => ({ ...(cur ?? base!.controls), ...patch }))

  const promptQ = useQuery({
    queryKey: ['prompt-preview', specKey, docId, base?.id, system, userTpl, c],
    queryFn: () => api.generatePrompts({ specifications: [specKey], document: docId ?? undefined, version: base?.id, system_prompt: system ?? undefined, user_template: userTpl ?? undefined, controls: c }),
    enabled: Boolean(base && docId && specKey && c),
    retry: false,
  })

  const test = useMutation({
    mutationFn: async (override?: { controls?: Partial<ExtractionPolicy>; doc?: number; spec?: string }) => {
      const doc = override?.doc ?? docId!
      const spec = override?.spec ?? specKey
      const cand = { ...(c ?? base!.controls), ...(override?.controls ?? {}) }
      const common = { document_ids: [doc], specification_keys: [spec], dry_run: true }
      const [b, k] = await Promise.all([api.createRun({ ...common, prompt_version: base!.id, controls: base!.controls }), api.createRun({ ...common, prompt_version: base!.id, controls: cand })])
      return { baseline: b.results[0], candidate: k.results[0], cand }
    },
    onSuccess: (r) => {
      setTab('test')
      const b = r.baseline
      const k = r.candidate
      if (b.status !== k.status || b.normalized_value !== k.normalized_value || b.validation_status !== k.validation_status) complete('C')
    },
  })

  const save = useMutation({
    mutationFn: () => api.createPromptVersion(template!.id, { system_prompt: system ?? base!.system_prompt, user_template: userTpl ?? base!.user_template, controls: c!, label: label || undefined, based_on: base!.id, notes: dirtyControls.length ? `Controls changed: ${dirtyControls.join('; ')}` : 'Free-form text only' }),
    onSuccess: (v) => {
      refresh()
      toast.push('ok', `Saved ${v.label} as a candidate. Evaluate it before promotion.`)
    },
  })

  const experiments: { label: string; patch: Partial<ExtractionPolicy>; company: string; year: number; spec: string }[] = [
    { label: 'Drop exclusion terms → Cascade Scope 2', patch: { applyExclusions: false }, company: 'Cascade Retail', year: 2024, spec: 'scope_2' },
    { label: 'Ignore fiscal year → Atlas operating income', patch: { enforceFiscalYear: false }, company: 'Atlas Materials', year: 2024, spec: 'operating_income' },
    { label: 'Skip unit scaling → Northstar revenue', patch: { applyUnitScale: false }, company: 'Northstar Energy', year: 2024, spec: 'revenue' },
  ]
  const runExperiment = (e: (typeof experiments)[number]) => {
    const d = docs.data?.find((x) => x.company_name === e.company && x.fiscal_year === e.year)
    if (!d || !base) return
    setDocId(d.id)
    setSpecKey(e.spec)
    setC(e.patch)
    test.mutate({ controls: e.patch, doc: d.id, spec: e.spec })
  }
  const unitType = specs.data?.find((s) => s.key === specKey)?.unit_type

  const tplVars = useMemo(() => [...new Set([...(userTpl ?? '').matchAll(/\{\{\s*(\w+)\s*\}\}/g)].map((m) => m[1]))], [userTpl])

  if (templates.isLoading || !base || !c) return <Spinner />
  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Prompt Studio"
        description="Generate extraction prompts straight from specifications, then tune a candidate configuration. Structured controls change what the reader does and are testable immediately against any report."
      />
      <Callout tone="warn" title="Demo / Mock Mode: free-form prompt text does not change mock extraction" className="mb-5">
        The offline reader is deterministic: it is driven by the <strong>structured controls</strong> on the left. Edits in “Free-form text” update the rendered preview and are validated, but they are not interpreted by the mock
        engine. With a real model provider (backend mode) the text is sent to the model.
      </Callout>
      <div className="grid gap-5 xl:grid-cols-[400px_1fr]">
        <div className="space-y-5">
          <Card>
            <CardHeader title="Target" />
            <div className="space-y-3 p-5">
              <Field label="Report" htmlFor="ps-doc">
                <Select id="ps-doc" value={docId ?? ''} onChange={(e) => setDocId(Number(e.target.value))}>
                  {docs.data?.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.title}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Specification" htmlFor="ps-spec">
                <Select id="ps-spec" value={specKey} onChange={(e) => setSpecKey(e.target.value)}>
                  {specs.data?.map((s) => (
                    <option key={s.key} value={s.key}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Start from version" htmlFor="ps-base">
                <Select
                  id="ps-base"
                  value={base.id}
                  onChange={(e) => {
                    setBaseId(Number(e.target.value))
                  }}
                >
                  {versions.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label} ({v.status})
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </Card>

          <Card>
            <CardHeader title="Structured controls" subtitle="These drive the Demo/Mock engine" actions={dirtyControls.length ? <Badge tone="warn">{dirtyControls.length} changed</Badge> : <Badge>matches {base.label.split(' ')[0]}</Badge>} />
            <div className="divide-y divide-line px-5">
              {BOOLEAN_CONTROLS.map((def) => (
                <Toggle
                  key={def.key}
                  checked={Boolean(c[def.key])}
                  onChange={(v) => setC({ [def.key]: v } as Partial<ExtractionPolicy>)}
                  label={def.label}
                  description={
                    <>
                      {def.description}
                      <span className="mt-0.5 block text-[11.5px] text-faint">{def.effect}</span>
                    </>
                  }
                />
              ))}
              <div className="grid grid-cols-2 gap-3 py-3">
                <Field label="Top-k chunks" htmlFor="ps-k">
                  <Input id="ps-k" type="number" min={1} max={20} value={c.topK} onChange={(e) => setC({ topK: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })} />
                </Field>
                <Field label="Retrieval mode" htmlFor="ps-mode">
                  <Select id="ps-mode" value={c.retrievalMode} onChange={(e) => setC({ retrievalMode: e.target.value as RetrievalMode })}>
                    <option value="hybrid">Hybrid</option>
                    <option value="bm25">BM25</option>
                    <option value="lexical">Lexical</option>
                  </Select>
                </Field>
              </div>
              <div className="py-3">
                <Field label={`Review threshold: ${c.reviewThreshold.toFixed(2)}`} htmlFor="ps-thr" hint="Found results below this confidence are routed to the review queue.">
                  <input id="ps-thr" type="range" min={0.5} max={0.99} step={0.01} value={c.reviewThreshold} onChange={(e) => setC({ reviewThreshold: Number(e.target.value) })} className="w-full accent-[#243bb5]" />
                </Field>
              </div>
            </div>
            {dirtyControls.length > 0 && (
              <div className="border-t border-line bg-canvas px-5 py-3 text-[12px] text-muted">
                {dirtyControls.map((d) => (
                  <div key={d} className="font-mono">
                    {d.replace(/^(\w+):/, (_, k: string) => `${CONTROL_SHORT[k] ?? k}:`)}
                  </div>
                ))}
                <button type="button" className="mt-1.5 font-medium text-brand-700 hover:underline" onClick={() => setControls({ ...base.controls })}>
                  Revert to {base.label.split(' ')[0]} controls
                </button>
              </div>
            )}
          </Card>
        </div>

        <div className="min-w-0 space-y-4">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 pt-3">
              <Tabs
                value={tab}
                onChange={setTab}
                className="border-b-0"
                tabs={[
                  { id: 'prompt', label: 'Generated prompt' },
                  { id: 'test', label: 'Test candidate' },
                  { id: 'text', label: 'Free-form text', count: textEdited ? 1 : undefined },
                ]}
              />
              <div className="flex items-center gap-2 pb-2">
                <Button variant="primary" size="sm" loading={test.isPending} onClick={() => test.mutate(undefined)} disabled={!docId}>
                  <FlaskConical className="size-3.5" /> Test candidate
                </Button>
              </div>
            </div>

            {tab === 'prompt' && (
              <div className="space-y-4 p-5">
                {promptQ.isLoading && <Spinner label="Rendering prompt" />}
                <ErrorNote error={promptQ.error} />
                {promptQ.data?.[0] && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                      <Badge tone="brand">≈ {promptQ.data[0].estimated_input_tokens.toLocaleString()} input tokens</Badge>
                      <span>{promptQ.data[0].retrieved_chunk_ids.length} retrieved chunks inserted into the context</span>
                      {textEdited && <Badge tone="warn">edited text - preview only</Badge>}
                    </div>
                    <div>
                      <div className="mb-1 text-[12px] font-semibold tracking-wider text-muted uppercase">System</div>
                      <pre className="scroll-thin max-h-56 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap">{promptQ.data[0].system}</pre>
                    </div>
                    <div>
                      <div className="mb-1 text-[12px] font-semibold tracking-wider text-muted uppercase">User (rendered from the specification)</div>
                      <pre className="scroll-thin max-h-[420px] overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap" data-testid="rendered-user-prompt">
                        {promptQ.data[0].user}
                      </pre>
                    </div>
                    <details className="text-[13px]">
                      <summary className="cursor-pointer font-medium text-brand-700">Structured output schema</summary>
                      <pre className="mt-2 max-h-64 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[11.5px]">{JSON.stringify(promptQ.data[0].schema, null, 2)}</pre>
                    </details>
                  </>
                )}
              </div>
            )}

            {tab === 'test' && (
              <div className="space-y-4 p-5">
                <div>
                  <div className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Quick experiments</div>
                  <div className="flex flex-wrap gap-2">
                    {experiments.map((e) => (
                      <Button key={e.label} size="sm" variant="subtle" onClick={() => runExperiment(e)} disabled={test.isPending}>
                        {e.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <ErrorNote error={test.error} />
                {!test.data && !test.isPending && (
                  <Callout tone="info">
                    Switch a control (or run an experiment) and press <strong>Test candidate</strong>. The baseline ({base.label.split(' ')[0]}) and your candidate controls both run on the selected report and specification - nothing is saved.
                  </Callout>
                )}
                {test.isPending && <Spinner label="Running baseline and candidate" />}
                {test.data && (
                  <>
                    {(() => {
                      const { baseline, candidate } = test.data
                      const changed = baseline.status !== candidate.status || baseline.normalized_value !== candidate.normalized_value || baseline.validation_status !== candidate.validation_status
                      return changed ? (
                        <Callout tone="warn" title="The candidate configuration changes the outcome">
                          {baseline.company_name} FY{baseline.fiscal_year} · {baseline.specification_name}: extraction went from <strong>{baseline.status}</strong> / validation <strong>{baseline.validation_status}</strong> to{' '}
                          <strong>{candidate.status}</strong> / <strong>{candidate.validation_status}</strong>.
                        </Callout>
                      ) : (
                        <Callout tone="ok" title="No change for this report and specification">
                          Try another experiment, or evaluate the candidate against the historical suite in the Evaluation Lab.
                        </Callout>
                      )
                    })()}
                    <div className="grid gap-4 md:grid-cols-2">
                      <ResultColumn title="Baseline" subtitle={base.label} result={test.data.baseline} unitType={unitType} />
                      <ResultColumn
                        title="Candidate"
                        subtitle={diffControls(base.controls, test.data.cand).length ? `${diffControls(base.controls, test.data.cand).length} control(s) changed` : 'same controls as baseline'}
                        result={test.data.candidate}
                        unitType={unitType}
                        other={test.data.baseline}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === 'text' && (
              <div className="space-y-4 p-5">
                <Callout tone="info">
                  These fields are the model-facing prompt text. They are validated against the available template variables ({tplVars.length ? tplVars.map((v) => `{{${v}}}`).join(', ') : 'none'}) and rendered in the preview. In Demo/Mock Mode they do not affect extraction.
                </Callout>
                <Field label="System prompt" htmlFor="ps-sys">
                  <Textarea id="ps-sys" rows={9} value={system ?? ''} onChange={(e) => setSystem(e.target.value)} className="font-mono text-[12.5px]" />
                </Field>
                <Field label="User template" htmlFor="ps-user" hint="Use {{task_tag}}, {{company}}, {{fiscal_year}}, {{spec_name}}, {{spec_description}}, {{aliases}}, {{exclusions}}, {{unit_guidance}}, {{context}}.">
                  <Textarea id="ps-user" rows={12} value={userTpl ?? ''} onChange={(e) => setUserTpl(e.target.value)} className="font-mono text-[12.5px]" />
                </Field>
                {textEdited && (
                  <button
                    type="button"
                    className="text-[13px] font-medium text-brand-700 hover:underline"
                    onClick={() => {
                      setSystem(base.system_prompt)
                      setUserTpl(base.user_template)
                    }}
                  >
                    Revert text to {base.label.split(' ')[0]}
                  </button>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Save as candidate" subtitle="Creates a new prompt version (status: candidate). It is evaluated and gated before it can go live." />
            <div className="flex flex-wrap items-end gap-3 p-5">
              <div className="min-w-60 flex-1">
                <Field label="Label (optional)" htmlFor="ps-label">
                  <Input id="ps-label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. v4 · stricter units" />
                </Field>
              </div>
              <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()} disabled={!dirtyControls.length && !textEdited}>
                <Save className="size-3.5" /> Save candidate version
              </Button>
              <Link to="/app/versions" className="pb-2 text-[13px] font-medium text-brand-700 hover:underline">
                Version registry
              </Link>
            </div>
            {!dirtyControls.length && !textEdited && <p className="px-5 pb-4 text-[12.5px] text-muted">Change at least one control or the prompt text to enable saving.</p>}
            <div className="px-5 pb-4">
              <ErrorNote error={save.error} />
            </div>
          </Card>
        </div>
      </div>
    </>
  )
}
