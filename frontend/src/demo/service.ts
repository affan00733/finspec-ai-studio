/**
 * Browser demo API: implements the same surface as the Django backend client, entirely in TypeScript with the
 * bundled synthetic corpus. No network, no API keys. State (runs, reviews, prompt versions, audit trail,
 * evaluations) is persisted to localStorage so the guided scenarios survive a reload; "Reset demo" wipes it.
 */
import { DEMO_DATASET } from '@/data/demo-dataset'
import type { FinSpecApi, NewVersionInput, ResultFilters } from '@/lib/apiTypes'
import {
  ApiError,
  type AgentConfiguration,
  type AuditEvent,
  type ChatRequest,
  type Company,
  type DocumentDetail,
  type DocumentSummary,
  type EvaluationCaseResult,
  type EvaluationDataset,
  type EvaluationRun,
  type EvaluationRunRequest,
  type Evidence,
  type ExtractionResult,
  type ExtractionRun,
  type GeneratedPromptPayload,
  type GraphData,
  type MonitoringSummary,
  type PromptGenerateRequest,
  type PromptTemplate,
  type PromptVersion,
  type RetrievalRequest,
  type RetrievalResponse,
  type Review,
  type ReviewRequest,
  type RunRequest,
  type Specification,
} from '@/types'
import { answerQuestion } from './chat.ts'
import { getCorpus, toSpecDef } from './corpus.ts'
import { DEFAULT_POLICY, type ExtractionPolicy, type SpecDef } from './engineTypes.ts'
import { aggregate, compareValue, type EvalRow } from './evaluation.ts'
import { DeterministicExtractor } from './extraction.ts'
import { buildComparison } from './compare.ts'
import { PromptError, generateExtractionPrompt } from './prompts.ts'
import { runExtraction, type ComputedResult } from './runner.ts'
import { AGENTS, DATASETS, EXTRACTION_TEMPLATE_ID, pinnedKey, pinnedMap } from './seed.ts'
import {
  audit,
  getState,
  persist,
  resetState,
  type RunRecord,
  type StoredEvalRun,
} from './state.ts'
import { tokenize } from './retrieval.ts'

const ACTOR = 'demo-analyst'
const docById = new Map(DEMO_DATASET.documents.map((d) => [d.id, d]))
const companyById = new Map(DEMO_DATASET.companies.map((c) => [c.id, c]))

let latencyMs = 90
export function setDemoLatency(ms: number) {
  latencyMs = ms
}
const wait = () => (latencyMs > 0 ? new Promise<void>((r) => setTimeout(r, latencyMs)) : Promise.resolve())

// ---------------------------------------------------------------------------- caches

const runCache = new Map<number, ExtractionResult[]>()
const computeCache = new Map<string, ComputedResult[]>()

function specSignature(): string {
  return getState()
    .specs.filter((s) => s.is_active)
    .map((s) => `${s.key}:${s.aliases.join(',')}:${s.exclude_terms.join(',')}`)
    .join('|')
}

function activeSpecDefs(keys?: string[]): SpecDef[] {
  const specs = getState().specs.filter((s) => s.is_active && (!keys || keys.includes(s.key)))
  const order = keys ?? specs.map((s) => s.key)
  return order.map((k) => specs.find((s) => s.key === k)).filter(Boolean).map((s) => toSpecDef(s!))
}

function computeAll(controls: ExtractionPolicy): ComputedResult[] {
  const key = JSON.stringify(controls) + '#' + specSignature()
  let hit = computeCache.get(key)
  if (!hit) {
    hit = runExtraction(controls, DEMO_DATASET.documents.map((d) => d.id), activeSpecDefs())
    if (computeCache.size > 12) computeCache.clear()
    computeCache.set(key, hit)
  }
  return hit
}

function invalidateComputations() {
  runCache.clear()
  computeCache.clear()
}

// ---------------------------------------------------------------------------- lookups

function extractionVersions(): PromptVersion[] {
  return getState().templates.find((t) => t.id === EXTRACTION_TEMPLATE_ID)!.versions
}
function activeVersion(): PromptVersion {
  return extractionVersions().find((v) => v.status === 'active')!
}
function findVersion(id: number): PromptVersion {
  for (const t of getState().templates) {
    const v = t.versions.find((x) => x.id === id)
    if (v) return v
  }
  throw new ApiError(`Unknown prompt version ${id}.`, 'unknown_version', 404)
}
function findAgent(id?: number): AgentConfiguration {
  const a = AGENTS.find((x) => x.id === (id ?? 1))
  if (!a) throw new ApiError(`Unknown agent ${id}.`, 'unknown_agent', 404)
  return a
}

const resultIdOf = (run: number, doc: number, specId: number) => run * 100000 + doc * 100 + specId

// ---------------------------------------------------------------------------- results

function estimateTokens(text: string) {
  return Math.max(1, Math.round(text.length / 4))
}

function toResult(run: RunRecord, cr: ComputedResult, spec: Specification, mode: 'deterministic' | 'llm'): ExtractionResult {
  const doc = docById.get(cr.document_id)!
  const o = cr.outcome
  const b = o.best
  const id = resultIdOf(run.id, doc.id, spec.id)
  const evidence: Evidence[] = o.candidates.map((c, i) => ({
    id: id * 10 + i,
    chunk: c.chunk_id,
    role: c.role,
    method: mode === 'llm' ? 'llm' : c.method,
    quote: c.quote,
    context: c.context,
    start_char: c.start_char,
    end_char: c.end_char,
    score: c.score,
    raw_number: c.raw_number,
    normalized_value: c.normalized,
    notes: mode === 'llm' ? [...c.notes, 'provider:mock'] : c.notes,
  }))
  return {
    id,
    run: run.id,
    document: doc.id,
    document_title: doc.title,
    company: doc.company_id,
    company_name: doc.company_name,
    specification: spec.id,
    specification_key: spec.key,
    specification_name: spec.name,
    status: o.status,
    raw_value: b?.raw_number ?? '',
    value: b?.value ?? null,
    scale: b?.scale ?? 1,
    currency: b?.currency ?? '',
    unit_label: b?.unit_label ?? '',
    normalized_value: b?.normalized ?? null,
    fiscal_year: o.fiscal_year,
    confidence: o.confidence,
    method: b ? (mode === 'llm' ? 'llm' : b.method) : '',
    rationale: mode === 'llm' && o.status === 'found' ? `[mock] ${o.rationale}` : o.rationale,
    warnings: o.warnings,
    retrieved_chunk_ids: o.retrieved_chunk_ids,
    validation_status: cr.validation_status,
    review_status: 'pending',
    final_value: null,
    evidence,
    validations: cr.checks.map((c, i) => ({ id: id * 100 + i, rule: c.rule, severity: c.severity, passed: c.passed, message: c.message, details: c.details })),
    reviews: [],
  }
}

function buildBaseResults(run: RunRecord): ExtractionResult[] {
  const cached = run.id === 0 ? undefined : runCache.get(run.id)
  if (cached) return cached
  const specs = getState().specs
  const defs = activeSpecDefs(run.spec_keys.filter((k) => specs.some((s) => s.key === k && s.is_active)))
  const agent = findAgent(run.agent_id)
  const computed = runExtraction(run.controls, run.document_ids, defs)
  const out = computed.map((cr) => toResult(run, cr, specs.find((s) => s.key === cr.spec_key)!, agent.mode))
  if (run.id !== 0) runCache.set(run.id, out)
  return out
}

function queueReasons(r: ExtractionResult, threshold: number): string[] {
  const reasons: string[] = []
  if (r.status === 'ambiguous' || r.status === 'rejected') reasons.push('Conflicting or rejected evidence')
  // Queue = failed validation, conflicting evidence or low confidence. Warnings stay visible in the workbench.
  const failed = r.validations.filter((v) => !v.passed && v.severity === 'error')
  if (failed.length) reasons.push(`Validation failed: ${failed.map((v) => v.rule).join(', ')}`)
  if (r.status === 'found' && r.confidence < threshold) reasons.push(`Confidence ${r.confidence.toFixed(2)} below ${threshold.toFixed(2)}`)
  return reasons
}

function withReviews(r: ExtractionResult, controls: ExtractionPolicy): ExtractionResult {
  const reviews = getState().reviews.filter((x) => x.result === r.id)
  const last = reviews[reviews.length - 1]
  const copy: ExtractionResult = { ...r, reviews }
  if (last) {
    if (last.decision === 'approve') {
      copy.review_status = 'approved'
      copy.final_value = r.normalized_value
    } else if (last.decision === 'reject') {
      copy.review_status = 'rejected'
      copy.final_value = null
    } else {
      copy.review_status = 'corrected'
      copy.final_value = last.corrected_value
      const doc = docById.get(r.document)!
      const loc = locateQuote(last.evidence_quote, doc.raw_text)
      if (loc) {
        copy.evidence = [
          ...r.evidence,
          {
            id: r.id * 10 + 9,
            chunk: null,
            role: 'analyst',
            method: 'analyst',
            quote: doc.raw_text.slice(loc[0], loc[1]),
            context: 'Analyst correction',
            start_char: loc[0],
            end_char: loc[1],
            score: 1,
            raw_number: '',
            normalized_value: last.corrected_value,
            notes: [],
          },
        ]
      }
    }
  }
  copy.queue_reasons = copy.review_status === 'pending' ? queueReasons(copy, controls.reviewThreshold) : []
  return copy
}

function locateQuote(quote: string, text: string): [number, number] | null {
  const q = quote.trim()
  if (!q) return null
  const i = text.indexOf(q)
  if (i >= 0) return [i, i + q.length]
  const pat = q
    .split(/\s+/)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\s+')
  const m = new RegExp(pat).exec(text)
  return m ? [m.index, m.index + m[0].length] : null
}

function runResults(run: RunRecord): ExtractionResult[] {
  return buildBaseResults(run).map((r) => withReviews(r, run.controls))
}

/** Most recent extraction per (document, specification) across all stored runs. */
function latestPerPair(): ExtractionResult[] {
  const latest = new Map<string, ExtractionResult>()
  for (const run of getState().runs) {
    for (const r of runResults(run)) latest.set(`${r.document}:${r.specification_key}`, r)
  }
  return [...latest.values()]
}

const inQueue = (r: ExtractionResult) => r.review_status === 'pending' && (r.queue_reasons?.length ?? 0) > 0

function toRun(run: RunRecord): ExtractionRun {
  const agent = findAgent(run.agent_id)
  const results = buildBaseResults(run)
  const found = results.filter((r) => r.status === 'found')
  const count = (f: (r: ExtractionResult) => string) => {
    const m: Record<string, number> = {}
    for (const r of results) m[f(r)] = (m[f(r)] ?? 0) + 1
    return m
  }
  const out: ExtractionRun = {
    id: run.id,
    label: run.label,
    agent: agent.id,
    agent_name: agent.name,
    prompt_version: run.version_id,
    prompt_version_label: run.version_label,
    mode: agent.mode,
    provider: agent.provider,
    model: agent.model,
    status: 'completed',
    specification_keys: run.spec_keys,
    document_ids: run.document_ids,
    options: run.controls,
    metrics: {
      total: results.length,
      by_status: count((r) => r.status),
      by_validation: count((r) => r.validation_status),
      found_rate: results.length ? Math.round((found.length / results.length) * 10000) / 10000 : 0,
      mean_confidence: found.length ? Math.round((found.reduce((a, r) => a + r.confidence, 0) / found.length) * 10000) / 10000 : 0,
      documents: run.document_ids.length,
    },
    error: '',
    created_by: run.created_by,
    created_at: run.created_at,
    result_count: results.length,
  }
  if (agent.mode === 'llm') {
    out.usage = { calls: results.length, input_tokens: results.reduce((a, r) => a + estimateTokens(r.rationale) + 380, 0), output_tokens: found.length * 60 }
  }
  return out
}

// ---------------------------------------------------------------------------- evaluation

function datasetCases(datasetId: number) {
  const pins = pinnedMap()
  const specs = getState().specs.filter((s) => s.is_active)
  const cases: { doc: (typeof DEMO_DATASET.documents)[number]; spec: Specification; expected: number | null; pinned: boolean; incident?: string }[] = []
  for (const doc of DEMO_DATASET.documents) {
    for (const spec of specs) {
      const g = doc.gold[spec.key]
      const inc = pins.get(pinnedKey(doc.id, spec.key))
      if (datasetId === DATASETS.incidents.id && !inc) continue
      cases.push({ doc, spec, expected: g == null ? null : Number(g), pinned: Boolean(inc), incident: inc })
    }
  }
  return cases
}

function evaluate(datasetId: number, controls: ExtractionPolicy) {
  const all = computeAll(controls)
  const byKey = new Map(all.map((r) => [`${r.document_id}:${r.spec_key}`, r]))
  const results: EvaluationCaseResult[] = []
  const rows: EvalRow[] = []
  for (const c of datasetCases(datasetId)) {
    const r = byKey.get(`${c.doc.id}:${c.spec.key}`)
    const predicted = r?.outcome.status === 'found' ? (r.outcome.best?.normalized ?? null) : null
    const outcome = compareValue(c.expected, c.expected !== null, predicted, r?.outcome.status ?? 'not_found')
    const passed = outcome === 'correct' || outcome === 'correct_absent'
    const grounded = r && r.outcome.status === 'found' ? r.checks.filter((k) => ['evidence_present', 'evidence_grounded', 'evidence_offsets'].includes(k.rule)).every((k) => k.passed) : true
    results.push({
      case: c.doc.id * 100 + c.spec.id,
      document: c.doc.id,
      company_name: c.doc.company_name,
      fiscal_year: c.doc.fiscal_year,
      specification_key: c.spec.key,
      expected_value: c.expected,
      predicted_value: predicted,
      outcome,
      passed,
      pinned: c.pinned,
      incident: c.incident,
      detail: { status: r?.outcome.status ?? 'missing', confidence: r?.outcome.confidence ?? 0, rationale: r?.outcome.rationale ?? '', quote: r?.outcome.best?.quote },
    })
    rows.push({ outcome, spec_key: c.spec.key, company: c.doc.company_name, predicted_found: predicted !== null, grounded, confidence: r?.outcome.confidence ?? 0 })
  }
  return { results, metrics: aggregate(rows) }
}

function hydrateEval(s: StoredEvalRun): EvaluationRun {
  const { results, metrics } = evaluate(s.dataset, s.controls)
  const ds = s.dataset === DATASETS.incidents.id ? DATASETS.incidents : DATASETS.gold
  return {
    id: s.id,
    dataset: s.dataset,
    dataset_name: ds.name,
    prompt_version: s.prompt_version,
    prompt_version_label: s.prompt_version_label,
    controls: s.controls,
    status: 'completed',
    metrics: s.metrics ?? metrics,
    created_at: s.created_at,
    created_by: s.created_by,
    results,
  }
}

function makeEval(id: number, datasetId: number, version: PromptVersion, controls: ExtractionPolicy, createdAt?: string, actor = ACTOR): StoredEvalRun {
  const { metrics } = evaluate(datasetId, controls)
  return {
    id,
    dataset: datasetId,
    prompt_version: version.id,
    prompt_version_label: version.label,
    controls: { ...controls },
    created_at: createdAt ?? new Date().toISOString(),
    created_by: actor,
    metrics,
  }
}

function storeEval(datasetId: number, version: PromptVersion, controls: ExtractionPolicy, createdAt?: string, actor = ACTOR): StoredEvalRun {
  const s = getState()
  s.counters.evalRun += 1
  const stored = makeEval(s.counters.evalRun, datasetId, version, controls, createdAt, actor)
  s.evalRuns.unshift(stored)
  if (s.evalRuns.length > 24) s.evalRuns.length = 24
  return stored
}

function ensureSeeded() {
  const s = getState()
  if (s.counters.evalRun === 0 && s.evalRuns.length === 0) {
    const v1 = findVersion(1)
    const v2 = findVersion(2)
    storeEval(DATASETS.gold.id, v1, v1.controls, '2026-09-02T09:30:00.000Z', 'seed')
    storeEval(DATASETS.gold.id, v2, v2.controls, '2026-09-24T12:00:00.000Z', 'seed')
    persist()
  }
}

// ---------------------------------------------------------------------------- API

function toDocSummary(d: (typeof DEMO_DATASET.documents)[number]): DocumentSummary {
  return { id: d.id, company: d.company_id, company_name: d.company_name, title: d.title, doc_type: d.doc_type, fiscal_year: d.fiscal_year, source_filename: d.source_filename, status: 'indexed', chunk_count: d.chunks.length }
}

function requireSpecKeys(keys: string[]) {
  const active = new Set(getState().specs.filter((s) => s.is_active).map((s) => s.key))
  const unknown = keys.filter((k) => !active.has(k))
  if (unknown.length) throw new ApiError(`Unknown or inactive specification keys: ${unknown.join(', ')}`, 'unknown_specification', 400)
}

export const demoApi: FinSpecApi = {
  mode: 'demo',

  async health() {
    await wait()
    const s = getState()
    return { status: 'ok', mode: 'demo', version: 'demo-1.0', counts: { companies: DEMO_DATASET.companies.length, documents: DEMO_DATASET.documents.length, specifications: s.specs.length, runs: s.runs.length } }
  },

  async providerStatus() {
    await wait()
    return {
      mode: 'demo',
      default_provider: 'mock',
      providers: [
        { name: 'mock', configured: true, paid: false, note: 'Deterministic offline reader running in this browser. No network calls.' },
        { name: 'openai', configured: false, paid: true, note: 'Requires the backend with OPENAI_API_KEY. Not used in the public demo.' },
        { name: 'azure', configured: false, paid: true, note: 'Requires the backend with Azure OpenAI configuration. Not used in the public demo.' },
      ],
      fallback_policy: 'No silent fallback: a paid provider that is unconfigured or failing produces an error; the mock provider is never substituted.',
    }
  },

  async listCompanies(): Promise<Company[]> {
    await wait()
    return DEMO_DATASET.companies.map((c) => ({ ...c, document_count: DEMO_DATASET.documents.filter((d) => d.company_id === c.id).length }))
  },

  async listDocuments() {
    await wait()
    return DEMO_DATASET.documents.map(toDocSummary)
  },

  async getDocument(id): Promise<DocumentDetail> {
    await wait()
    const d = docById.get(id)
    if (!d) throw new ApiError('Document not found.', 'not_found', 404)
    return {
      ...toDocSummary(d),
      raw_text: d.raw_text,
      sections: d.sections.map((s) => ({ id: d.id * 100 + s.order, ...s })),
      chunks: d.chunks.map((c) => ({ id: c.id, document: d.id, index: c.index, chunk_type: c.chunk_type, heading: c.heading, text: c.text, start_char: c.start_char, end_char: c.end_char, token_count: tokenize(c.text).length, meta: c.meta as Record<string, unknown> })),
    }
  },

  async listSpecifications() {
    await wait()
    return getState().specs.map((s) => ({ ...s }))
  },

  async updateSpecification(key, patch) {
    await wait()
    const s = getState()
    const spec = s.specs.find((x) => x.key === key)
    if (!spec) throw new ApiError('Specification not found.', 'not_found', 404)
    if (patch.aliases && patch.aliases.filter((a) => a.trim()).length === 0) throw new ApiError('A specification needs at least one alias.', 'invalid_aliases', 400)
    Object.assign(spec, {
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.aliases ? { aliases: patch.aliases.map((a) => a.trim()).filter(Boolean) } : {}),
      ...(patch.exclude_terms ? { exclude_terms: patch.exclude_terms.map((a) => a.trim()).filter(Boolean) } : {}),
      ...(patch.is_active !== undefined ? { is_active: patch.is_active } : {}),
    })
    invalidateComputations()
    audit('specification.updated', 'specification', key, `Updated specification '${spec.name}'`, patch as Record<string, unknown>)
    persist()
    return { ...spec }
  },

  async listPromptTemplates(): Promise<PromptTemplate[]> {
    await wait()
    ensureSeeded()
    return getState().templates.map((t) => ({ ...t, versions: t.versions.map((v) => ({ ...v })) }))
  },

  async createPromptVersion(templateId, input: NewVersionInput) {
    await wait()
    const s = getState()
    const tpl = s.templates.find((t) => t.id === templateId)
    if (!tpl) throw new ApiError('Prompt template not found.', 'not_found', 404)
    const next = Math.max(...tpl.versions.map((v) => v.version)) + 1
    s.counters.version += 1
    const v: PromptVersion = {
      id: s.counters.version,
      template: templateId,
      version: next,
      label: input.label?.trim() || `v${next} · custom controls`,
      system_prompt: input.system_prompt,
      user_template: input.user_template,
      output_schema: tpl.versions[0].output_schema,
      notes: input.notes ?? '',
      status: 'candidate',
      is_active: false,
      controls: { ...input.controls },
      created_by: ACTOR,
      created_at: new Date().toISOString(),
    }
    tpl.versions.push(v)
    audit('prompt.version_created', 'prompt_version', v.id, `Created ${v.label} from structured controls`, { controls: v.controls, based_on: input.based_on })
    persist()
    return { ...v }
  },

  async activatePromptVersion(versionId) {
    await wait()
    ensureSeeded()
    const s = getState()
    const v = findVersion(versionId)
    const tpl = s.templates.find((t) => t.id === v.template)!
    if (v.status === 'active') return { ...v }
    if (tpl.kind === 'extraction') {
      const base = activeVersion()
      const baseRun = hydrateEval(makeEval(-1, DATASETS.gold.id, base, base.controls))
      const candRun = hydrateEval(makeEval(-2, DATASETS.gold.id, v, v.controls))
      const cmp = buildComparison(baseRun, candRun)
      if (!cmp.gate.passed) {
        const failed = cmp.gate.checks.filter((c) => !c.passed)
        audit('prompt.promotion_blocked', 'prompt_version', v.id, `Promotion of ${v.label} blocked by evaluation gate`, { failed: failed.map((f) => f.id) })
        persist()
        throw new ApiError(`Promotion blocked: ${failed.map((f) => f.detail).join(' | ')}`, 'promotion_blocked', 409)
      }
    }
    for (const x of tpl.versions) {
      if (x.status === 'active') {
        x.status = 'archived'
        x.is_active = false
      }
    }
    v.status = 'active'
    v.is_active = true
    tpl.active_version = v.id
    audit('prompt.activated', 'prompt_version', v.id, `Promoted ${v.label} to production`, {})
    persist()
    return { ...v }
  },

  async generatePrompts(req: PromptGenerateRequest): Promise<GeneratedPromptPayload[]> {
    await wait()
    const corpus = getCorpus()
    requireSpecKeys(req.specifications)
    const version = req.version ? findVersion(req.version) : activeVersion()
    const system = req.system_prompt ?? version.system_prompt
    const userTpl = req.user_template ?? version.user_template
    const controls = { ...version.controls, ...(req.controls ?? {}) }
    const doc = req.document ? docById.get(req.document) : undefined
    if (req.document && !doc) throw new ApiError('Document not found.', 'document_not_found', 404)
    const defs = new Map(activeSpecDefs().map((d) => [d.key, d]))
    const extractor = new DeterministicExtractor(corpus.index, { ...controls, topK: req.top_k ?? controls.topK }, [...defs.values()])
    const out: GeneratedPromptPayload[] = []
    for (const key of req.specifications) {
      const spec = defs.get(key)!
      const hits = doc ? extractor.retrieve(spec, doc.id) : []
      try {
        const p = generateExtractionPrompt(spec, doc?.company_name ?? '', doc?.fiscal_year ?? null, hits, system, userTpl, version.output_schema)
        out.push({ ...p, template_version: version.id })
      } catch (e) {
        if (e instanceof PromptError) throw new ApiError(e.message, 'invalid_template', 400)
        throw e
      }
    }
    audit('prompt.generated', 'prompt', version.id, `Generated ${out.length} prompt(s) from specifications`, { specifications: req.specifications, document: req.document })
    persist()
    return out
  },

  async listAgents() {
    await wait()
    return AGENTS.map((a) => ({ ...a }))
  },

  async createRun(req: RunRequest) {
    await wait()
    const s = getState()
    const agent = findAgent(req.agent)
    if (!agent.available) throw new ApiError(agent.unavailable_reason ?? 'Provider unavailable.', 'provider_unavailable', 503)
    const docIds = req.document_ids?.length ? req.document_ids : DEMO_DATASET.documents.map((d) => d.id)
    const missing = docIds.filter((id) => !docById.has(id))
    if (missing.length) throw new ApiError(`Unknown document ids: ${missing.join(', ')}`, 'unknown_document', 400)
    const keys = req.specification_keys?.length ? req.specification_keys : s.specs.filter((x) => x.is_active).map((x) => x.key)
    requireSpecKeys(keys)
    const version = req.prompt_version ? findVersion(req.prompt_version) : activeVersion()
    const controls: ExtractionPolicy = { ...DEFAULT_POLICY, ...version.controls, ...(req.controls ?? {}) }
    if (agent.mode === 'llm') {
      // The mock model path renders a real prompt per metric; an invalid template fails the run loudly.
      try {
        const sd = activeSpecDefs([keys[0]])[0]
        generateExtractionPrompt(sd, 'Company', 2024, [], version.system_prompt, version.user_template, version.output_schema)
      } catch (e) {
        if (e instanceof PromptError) throw new ApiError(e.message, 'invalid_template', 400)
        throw e
      }
    }
    if (!req.dry_run) s.counters.run += 1
    const record: RunRecord = {
      id: req.dry_run ? 0 : s.counters.run,
      label: req.label?.trim() || `${agent.name} · ${version.label}`,
      agent_id: agent.id,
      version_id: version.id,
      version_label: version.label,
      controls,
      document_ids: docIds,
      spec_keys: keys,
      created_at: new Date().toISOString(),
      created_by: ACTOR,
    }
    if (req.dry_run) return { run: toRun(record), results: runResults(record) }
    s.runs.push(record)
    if (s.runs.length > 30) {
      const drop = s.runs.splice(1, s.runs.length - 30)
      for (const d of drop) runCache.delete(d.id)
    }
    audit('run.created', 'extraction_run', record.id, `Run #${record.id}: ${docIds.length} document(s), ${keys.length} specification(s), mode=${agent.mode}/${agent.provider}`, { controls, version: version.id })
    persist()
    return { run: toRun(record), results: runResults(record) }
  },

  async listRuns() {
    await wait()
    return [...getState().runs].reverse().map(toRun)
  },

  async listResults(filters: ResultFilters = {}) {
    await wait()
    const s = getState()
    const run = filters.run ? s.runs.find((r) => r.id === filters.run) : s.runs[s.runs.length - 1]
    if (!run) throw new ApiError('Run not found.', 'run_not_found', 404)
    let rows = runResults(run)
    if (filters.document) rows = rows.filter((r) => r.document === filters.document)
    if (filters.company) rows = rows.filter((r) => r.company === filters.company)
    if (filters.specification) rows = rows.filter((r) => r.specification_key === filters.specification)
    if (filters.status) rows = rows.filter((r) => r.status === filters.status)
    if (filters.validation_status) rows = rows.filter((r) => r.validation_status === filters.validation_status)
    if (filters.review_status) rows = rows.filter((r) => r.review_status === filters.review_status)
    return rows
  },

  async search(req: RetrievalRequest): Promise<RetrievalResponse> {
    await wait()
    const corpus = getCorpus()
    const mode = req.mode ?? 'hybrid'
    let query = (req.query ?? '').trim()
    let extra: string[] = []
    if (req.specification) {
      const spec = getState().specs.find((x) => x.key === req.specification)
      if (!spec) throw new ApiError('Unknown specification key.', 'unknown_specification', 404)
      query = query || `${spec.name} ${spec.aliases.join(' ')}`
      extra = spec.aliases
    }
    if (!query) throw new ApiError("Provide 'query' or 'specification'.", 'invalid_request', 400)
    const docs = req.document_ids?.length ? req.document_ids : DEMO_DATASET.documents.map((d) => d.id)
    const hits = corpus.index.search(query, { topK: req.top_k ?? 8, mode, graphExpansion: req.graph_expansion ?? true, extraPhrases: extra, documentIds: docs })
    return {
      query,
      mode,
      graph_expansion: req.graph_expansion ?? true,
      documents_searched: docs,
      count: hits.length,
      hits: hits.map((h) => ({
        chunk_id: h.chunk.id,
        document_id: h.chunk.document_id,
        index: h.chunk.index,
        heading: h.chunk.heading,
        chunk_type: h.chunk.chunk_type,
        score: Math.round(h.score * 1e6) / 1e6,
        rank: h.rank,
        via: h.via,
        scores: { bm25: h.scores.bm25 !== undefined ? Math.round(h.scores.bm25 * 1e4) / 1e4 : undefined, lexical: h.scores.lexical !== undefined ? Math.round(h.scores.lexical * 1e4) / 1e4 : undefined, rrf: Math.round(h.scores.rrf * 1e6) / 1e6 },
        from_chunk_id: h.from_chunk_id,
        relation: h.relation,
        start_char: h.chunk.start_char,
        end_char: h.chunk.end_char,
        text: h.chunk.text,
        caption: h.chunk.meta.caption,
      })),
    }
  },

  async graph(params = {}): Promise<GraphData> {
    await wait()
    const docs = params.document ? DEMO_DATASET.documents.filter((d) => d.id === params.document) : DEMO_DATASET.documents
    const nodes: GraphData['nodes'] = []
    const edges: GraphData['edges'] = []
    const seen = new Set<number>()
    for (const d of docs) {
      if (!seen.has(d.company_id)) {
        seen.add(d.company_id)
        nodes.push({ id: `company:${d.company_id}`, type: 'company', label: companyById.get(d.company_id)!.name })
      }
      nodes.push({ id: `document:${d.id}`, type: 'document', label: d.title, fiscal_year: d.fiscal_year })
      edges.push({ source: `company:${d.company_id}`, target: `document:${d.id}`, type: 'published' })
      if (params.document) {
        for (const c of d.chunks) {
          nodes.push({ id: `chunk:${c.id}`, type: 'chunk', label: `${c.heading.slice(0, 60)} [${c.chunk_type}]`, chunk_type: c.chunk_type, document_id: d.id, index: c.index })
          edges.push({ source: `document:${d.id}`, target: `chunk:${c.id}`, type: 'contains' })
        }
        for (const r of d.relationships) {
          if (r.relation === 'previous' || r.relation === 'section_member') continue
          edges.push({ source: `chunk:${r.source}`, target: `chunk:${r.target}`, type: r.relation, weight: r.weight })
        }
      }
    }
    return { nodes, edges }
  },

  async reviewQueue(runId) {
    await wait()
    const s = getState()
    if (!runId) return latestPerPair().filter(inQueue)
    const run = s.runs.find((r) => r.id === runId)
    return run ? runResults(run).filter(inQueue) : []
  },

  async submitReview(req: ReviewRequest) {
    await wait()
    const s = getState()
    const run = s.runs.find((r) => Math.floor(req.result / 100000) === r.id)
    if (!run) throw new ApiError('Result not found.', 'not_found', 404)
    const base = buildBaseResults(run).find((r) => r.id === req.result)
    if (!base) throw new ApiError('Result not found.', 'not_found', 404)
    const reviewer = req.reviewer?.trim() || ACTOR
    const comment = req.comment?.trim() ?? ''
    if (req.decision === 'approve') {
      if (base.status !== 'found' || base.normalized_value === null)
        throw new ApiError("Only results with an extracted value can be approved. Use 'correct' to supply a value.", 'cannot_approve', 400)
      if (base.validation_status === 'fail' && !comment) throw new ApiError('Approving a result that failed validation requires a comment.', 'comment_required', 400)
    } else if (req.decision === 'correct') {
      if (req.corrected_value == null || Number.isNaN(req.corrected_value)) throw new ApiError("corrected_value is required when decision is 'correct'.", 'missing_value', 400)
      if (!req.evidence_quote?.trim()) throw new ApiError('A corrected value requires an evidence_quote from the document.', 'missing_evidence', 400)
      const doc = docById.get(base.document)!
      if (!locateQuote(req.evidence_quote, doc.raw_text)) throw new ApiError('evidence_quote was not found in the document text.', 'evidence_not_found', 400)
    } else if (req.decision !== 'reject') {
      throw new ApiError('decision must be approve, reject or correct.', 'invalid_decision', 400)
    }
    s.counters.review += 1
    const review: Review = {
      id: s.counters.review,
      result: req.result,
      reviewer,
      decision: req.decision,
      corrected_value: req.decision === 'correct' ? (req.corrected_value ?? null) : null,
      corrected_unit: req.corrected_unit ?? '',
      evidence_quote: req.evidence_quote?.trim() ?? '',
      comment,
      created_at: new Date().toISOString(),
    }
    s.reviews.push(review)
    audit(`review.${req.decision}`, 'extraction_result', req.result, `${req.decision} ${base.specification_key} for ${base.company_name} FY${base.fiscal_year}`, {
      review_id: review.id,
      final_value: req.decision === 'correct' ? review.corrected_value : req.decision === 'approve' ? base.normalized_value : null,
      comment,
    }, reviewer)
    persist()
    return { review, result: withReviews(base, run.controls) }
  },

  async listReviews() {
    await wait()
    const s = getState()
    return [...s.reviews].reverse().map((r) => {
      const run = s.runs.find((x) => Math.floor(r.result / 100000) === x.id)
      const base = run ? buildBaseResults(run).find((x) => x.id === r.result) : undefined
      return { ...r, document: base?.document ?? 0, specification_key: base?.specification_key ?? '', result_summary: base ? `${base.company_name} FY${base.fiscal_year} · ${base.specification_name}` : `Result ${r.result}` }
    })
  },

  async listEvaluationDatasets(): Promise<EvaluationDataset[]> {
    await wait()
    return [
      { ...DATASETS.gold, case_count: datasetCases(DATASETS.gold.id).length },
      { ...DATASETS.incidents, case_count: datasetCases(DATASETS.incidents.id).length },
    ]
  },

  async runEvaluation(req: EvaluationRunRequest) {
    await wait()
    ensureSeeded()
    const v = findVersion(req.prompt_version)
    const stored = storeEval(req.dataset, v, v.controls)
    audit('evaluation.completed', 'evaluation_run', stored.id, `Evaluation #${stored.id} of ${v.label} on '${req.dataset === DATASETS.incidents.id ? DATASETS.incidents.name : DATASETS.gold.name}': accuracy ${stored.metrics.overall.accuracy}`, { overall: stored.metrics.overall })
    persist()
    return hydrateEval(stored)
  },

  async listEvaluationRuns() {
    await wait()
    ensureSeeded()
    return getState().evalRuns.map(hydrateEval)
  },

  async compareEvaluations(baselineId, candidateId) {
    await wait()
    const s = getState()
    const b = s.evalRuns.find((r) => r.id === baselineId)
    const c = s.evalRuns.find((r) => r.id === candidateId)
    if (!b || !c) throw new ApiError('Evaluation run not found.', 'not_found', 404)
    if (b.dataset !== c.dataset) throw new ApiError('Evaluation runs use different datasets.', 'dataset_mismatch', 400)
    const cmp = buildComparison(hydrateEval(b), hydrateEval(c))
    audit('evaluation.compared', 'evaluation_run', c.id, `Compared ${c.prompt_version_label} against ${b.prompt_version_label}: ${cmp.summary.improved} improved, ${cmp.summary.regressed} regressed - gate ${cmp.gate.passed ? 'passed' : 'blocked'}`, { summary: cmp.summary })
    persist()
    return cmp
  },

  async chat(req: ChatRequest) {
    await wait()
    // Chat has its own prompt template (default guardrails) and is not affected by extraction candidates.
    const chatTpl = getState().templates.find((t) => t.kind === 'chat')
    const v = chatTpl?.versions.find((x) => x.status === 'active')
    const res = answerQuestion(req, { specs: activeSpecDefs(), policy: v?.controls ?? DEFAULT_POLICY })
    audit('chat.answered', 'chat', '', req.message.slice(0, 160), { grounded: res.grounded, citations: res.citations.length, mode: res.mode })
    persist()
    return res
  },

  async listAudit(params = {}): Promise<AuditEvent[]> {
    await wait()
    let rows = getState().audit
    if (params.action_prefix) rows = rows.filter((a) => a.action.startsWith(params.action_prefix!))
    if (params.q) {
      const q = params.q.toLowerCase()
      rows = rows.filter((a) => a.summary.toLowerCase().includes(q) || a.action.toLowerCase().includes(q))
    }
    return rows
  },

  async monitoring(): Promise<MonitoringSummary> {
    await wait()
    ensureSeeded()
    const s = getState()
    const results = latestPerPair()
    const validation: Record<string, number> = {}
    for (const r of results) validation[r.validation_status] = (validation[r.validation_status] ?? 0) + 1
    const buckets = ['<0.5', '0.5-0.7', '0.7-0.85', '0.85-0.95', '≥0.95'].map((bucket) => ({ bucket, count: 0 }))
    for (const r of results.filter((x) => x.status === 'found')) {
      const i = r.confidence < 0.5 ? 0 : r.confidence < 0.7 ? 1 : r.confidence < 0.85 ? 2 : r.confidence < 0.95 ? 3 : 4
      buckets[i].count += 1
    }
    return {
      runs: s.runs.length,
      results: results.length,
      review_backlog: results.filter(inQueue).length,
      reviewed: s.reviews.length,
      validation,
      confidence_buckets: buckets,
      run_history: s.runs.map((r) => {
        const run = toRun(r)
        return { run: r.id, label: `#${r.id}`, found_rate: run.metrics.found_rate, mean_confidence: run.metrics.mean_confidence, created_at: r.created_at }
      }),
      eval_history: [...s.evalRuns].reverse().filter((e) => e.dataset === DATASETS.gold.id).map((e) => ({ id: e.id, label: e.prompt_version_label.split(' ')[0], accuracy: e.metrics.overall.accuracy, f1: e.metrics.overall.f1, created_at: e.created_at })),
    }
  },

  async resetDemo() {
    await wait()
    invalidateComputations()
    resetState()
    audit('demo.reset', 'workspace', '', 'Demo workspace reset to its seeded state.', {}, ACTOR)
    persist()
  },
}

export function __resetDemoForTests() {
  invalidateComputations()
  resetState()
  setDemoLatency(0)
}
