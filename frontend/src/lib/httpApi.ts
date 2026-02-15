/**
 * Django REST backend client. Used only when VITE_API_URL is set.
 * Maps backend serializers onto the UI's domain types. Capabilities that exist only in the browser demo
 * (structured prompt controls, pinned incident suite) degrade gracefully: controls fall back to defaults.
 */
import { DEFAULT_POLICY } from '@/demo/engineTypes'
import { buildComparison } from '@/demo/compare'
import { aggregate, compareValue, type EvalRow } from '@/demo/evaluation'
import type { FinSpecApi, NewVersionInput, ResultFilters } from './apiTypes'
import {
  ApiError,
  type AgentConfiguration,
  type ChatResponse,
  type DocumentDetail,
  type EvaluationCaseResult,
  type EvaluationRun,
  type ExtractionResult,
  type ExtractionRun,
  type PromptTemplate,
  type PromptVersion,
  type RetrievalHit,
  type Specification,
} from '@/types'

type Json = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function createHttpApi(baseUrl: string): FinSpecApi {
  const root = baseUrl.replace(/\/+$/, '')

  async function req<T = Json>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', 'X-Actor': 'frontend' }
    let body: BodyInit | undefined
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    let res: Response
    try {
      res = await fetch(`${root}${path}`, { ...init, headers: { ...headers, ...(init.headers as Record<string, string>) }, body })
    } catch (e) {
      throw new ApiError(`Cannot reach the backend at ${root}. ${(e as Error).message}`, 'network_error', 0)
    }
    const text = await res.text()
    const data = text ? JSON.parse(text) : null
    if (!res.ok) {
      const msg = data?.error?.message ?? data?.detail ?? (typeof data === 'object' && data ? JSON.stringify(data) : res.statusText)
      throw new ApiError(msg, data?.error?.code ?? 'http_error', res.status)
    }
    return data as T
  }

  async function all(path: string): Promise<Json[]> {
    const sep = path.includes('?') ? '&' : '?'
    const data = await req<Json>(`${path}${sep}page_size=500`)
    return Array.isArray(data) ? data : (data.results ?? [])
  }

  const mapSpec = (s: Json): Specification => ({
    id: s.id,
    key: s.key,
    name: s.name,
    category: s.category,
    unit_type: s.unit_type,
    sign_policy: s.sign_policy,
    description: s.description ?? '',
    aliases: s.aliases ?? [],
    exclude_terms: s.exclude_terms ?? [],
    rules: s.rules ?? {},
    is_active: s.is_active ?? true,
  })

  const mapVersion = (v: Json, activeId: number | null): PromptVersion => ({
    id: v.id,
    template: v.template,
    version: v.version,
    label: `v${v.version}${v.is_active ? ' · active' : ''}`,
    system_prompt: v.system_prompt,
    user_template: v.user_template,
    output_schema: v.output_schema ?? {},
    notes: v.notes ?? '',
    status: v.is_active || v.id === activeId ? 'active' : 'archived',
    is_active: Boolean(v.is_active),
    controls: { ...DEFAULT_POLICY },
    created_by: v.created_by ?? '',
    created_at: v.created_at,
  })

  const mapResult = (r: Json): ExtractionResult => ({
    id: r.id,
    run: r.run,
    document: r.document,
    document_title: r.document_title,
    company: r.company,
    company_name: r.company_name,
    specification: r.specification,
    specification_key: r.specification_key,
    specification_name: r.specification_name,
    status: r.status,
    raw_value: r.raw_value ?? '',
    value: num(r.value),
    scale: Number(r.scale ?? 1),
    currency: r.currency ?? '',
    unit_label: r.unit_label ?? '',
    normalized_value: num(r.normalized_value),
    fiscal_year: r.fiscal_year,
    confidence: Number(r.confidence ?? 0),
    method: r.method ?? '',
    rationale: r.rationale ?? '',
    warnings: r.warnings ?? [],
    retrieved_chunk_ids: r.retrieved_chunk_ids ?? [],
    validation_status: r.validation_status,
    review_status: r.review_status,
    final_value: num(r.final_value),
    evidence: (r.evidence ?? []).map((e: Json) => ({ ...e, normalized_value: num(e.normalized_value), score: Number(e.score ?? 0), notes: e.notes ?? [] })),
    validations: r.validations ?? [],
    reviews: (r.reviews ?? []).map((x: Json) => ({ ...x, corrected_value: num(x.corrected_value) })),
    queue_reasons: queueReasons(r),
  })

  function queueReasons(r: Json): string[] {
    if (r.review_status !== 'pending') return []
    const out: string[] = []
    if (r.status === 'ambiguous' || r.status === 'rejected') out.push('Conflicting or rejected evidence')
    if (r.validation_status === 'fail') out.push('Validation failed')
    if (r.validation_status === 'warn') out.push('Validation warning')
    if (r.status === 'found' && Number(r.confidence) < DEFAULT_POLICY.reviewThreshold) out.push(`Confidence ${Number(r.confidence).toFixed(2)} below ${DEFAULT_POLICY.reviewThreshold.toFixed(2)}`)
    return out
  }

  const mapRun = (r: Json): ExtractionRun => ({
    id: r.id,
    label: `Run #${r.id}`,
    agent: r.agent,
    agent_name: r.agent_name ?? '',
    prompt_version: r.prompt_version ?? null,
    prompt_version_label: r.prompt_version ? `version ${r.prompt_version}` : 'n/a',
    mode: r.mode,
    provider: r.provider,
    model: r.model,
    status: r.status,
    specification_keys: r.specification_keys ?? [],
    document_ids: r.document_ids ?? [],
    options: { ...DEFAULT_POLICY, topK: r.options?.top_k ?? 8, retrievalMode: r.options?.retrieval_mode ?? 'hybrid', graphExpansion: r.options?.graph_expansion ?? true },
    metrics: {
      total: r.metrics?.total ?? 0,
      by_status: r.metrics?.by_status ?? {},
      by_validation: r.metrics?.by_validation ?? {},
      found_rate: r.metrics?.found_rate ?? 0,
      mean_confidence: r.metrics?.mean_confidence ?? 0,
      documents: r.metrics?.documents ?? 0,
    },
    error: r.error ?? '',
    created_by: r.created_by ?? '',
    created_at: r.created_at,
    result_count: r.result_count ?? 0,
  })

  const mapHit = (h: Json): RetrievalHit => ({
    chunk_id: h.chunk_id,
    document_id: h.document_id,
    index: h.index,
    heading: h.heading,
    chunk_type: h.chunk_type,
    score: h.score,
    rank: h.rank,
    via: h.via,
    scores: h.scores,
    from_chunk_id: h.from_chunk_id ?? null,
    relation: h.relation ?? null,
    start_char: h.start_char,
    end_char: h.end_char,
    text: h.text ?? '',
  })

  async function evalResults(id: number): Promise<EvaluationCaseResult[]> {
    const rows = await all(`/evaluations/runs/${id}/results/`)
    return rows.map((r) => ({
      case: r.case,
      document: r.document,
      company_name: r.company_name,
      fiscal_year: r.fiscal_year,
      specification_key: r.specification_key,
      expected_value: num(r.expected_value),
      predicted_value: num(r.predicted_value),
      outcome: r.outcome,
      passed: r.passed,
      pinned: false,
      detail: { status: r.detail?.status ?? '', confidence: r.detail?.confidence ?? 0, rationale: r.detail?.rationale ?? '' },
    }))
  }

  async function hydrateEval(er: Json): Promise<EvaluationRun> {
    const results = await evalResults(er.id)
    const rows: EvalRow[] = results.map((r) => ({
      outcome: compareValue(r.expected_value, r.expected_value !== null, r.predicted_value, r.detail.status) ?? r.outcome,
      spec_key: r.specification_key,
      company: r.company_name,
      predicted_found: r.predicted_value !== null,
      grounded: true,
      confidence: r.detail.confidence,
    }))
    return {
      id: er.id,
      dataset: er.dataset,
      dataset_name: er.dataset_name,
      prompt_version: 0,
      prompt_version_label: er.agent_name ?? `Evaluation #${er.id}`,
      controls: { ...DEFAULT_POLICY },
      status: er.status === 'completed' ? 'completed' : 'failed',
      metrics: er.metrics?.overall ? er.metrics : aggregate(rows),
      created_at: er.created_at,
      created_by: er.created_by ?? '',
      results,
    }
  }

  const unsupported = (what: string) => new ApiError(`${what} is only available in the browser demo; the backend API does not expose it.`, 'unsupported', 501)

  const api: FinSpecApi = {
    mode: 'backend',
    async health() {
      const h = await req<Json>('/health/')
      return { status: h.status, mode: 'backend', version: h.version, counts: h.counts }
    },
    async providerStatus() {
      const p = await req<Json>('/provider-status/')
      const provs = Array.isArray(p.providers) ? p.providers : Object.entries(p.providers ?? {}).map(([name, v]) => ({ name, ...(v as Json) }))
      return {
        mode: 'backend',
        default_provider: p.default_provider,
        fallback_policy: p.fallback_policy,
        providers: provs.map((x: Json) => ({ name: x.name, configured: Boolean(x.configured ?? x.available ?? x.offline), paid: Boolean(x.paid ?? x.is_paid), note: x.note ?? x.reason ?? '' })),
      }
    },
    async listCompanies() {
      return (await all('/companies/')).map((c) => ({ ...c }) as never)
    },
    async listDocuments() {
      return (await all('/documents/')).map((d) => ({ ...d }) as never)
    },
    async getDocument(id): Promise<DocumentDetail> {
      const [d, chunks] = await Promise.all([req<Json>(`/documents/${id}/`), all(`/documents/${id}/chunks/`)])
      return Object.assign({}, d, { chunks, sections: d.sections ?? [] }) as unknown as DocumentDetail
    },
    async listSpecifications() {
      return (await all('/specifications/')).map(mapSpec)
    },
    async updateSpecification(key, patch) {
      const specs = await all('/specifications/')
      const s = specs.find((x) => x.key === key)
      if (!s) throw new ApiError('Specification not found.', 'not_found', 404)
      return mapSpec(await req<Json>(`/specifications/${s.id}/`, { method: 'PATCH', json: patch }))
    },
    async listPromptTemplates(): Promise<PromptTemplate[]> {
      const tpls = await all('/prompts/')
      return Promise.all(
        tpls.map(async (t) => {
          const versions = (await req<Json[]>(`/prompts/${t.id}/versions/`)).map((v) => mapVersion(v, t.active_version?.id ?? null))
          return { id: t.id, name: t.name, kind: t.kind, description: t.description, active_version: t.active_version?.id ?? null, versions }
        }),
      )
    },
    async createPromptVersion(templateId, input: NewVersionInput) {
      const v = await req<Json>(`/prompts/${templateId}/versions/`, { method: 'POST', json: { system_prompt: input.system_prompt, user_template: input.user_template, notes: input.notes ?? '' } })
      return mapVersion(v, null)
    },
    async activatePromptVersion(id) {
      return mapVersion(await req<Json>(`/prompts/versions/${id}/activate/`, { method: 'POST' }), id)
    },
    async generatePrompts(r) {
      const out = await req<Json>('/prompts/generate/', { method: 'POST', json: { specifications: r.specifications, document: r.document, version: r.version, top_k: r.top_k ?? 6 } })
      return out.prompts
    },
    async listAgents(): Promise<AgentConfiguration[]> {
      return (await all('/agents/')).map((a) => ({ id: a.id, name: a.name, description: a.description, mode: a.mode, provider: a.provider, model: a.model, is_default: a.is_default, top_k: a.top_k, available: true }))
    },
    async createRun(r) {
      const run = await req<Json>('/runs/', {
        method: 'POST',
        json: {
          document_ids: r.document_ids,
          specification_keys: r.specification_keys,
          agent: r.agent,
          prompt_version: r.prompt_version,
          top_k: r.controls?.topK,
          retrieval_mode: r.controls?.retrievalMode,
          graph_expansion: r.controls?.graphExpansion,
        },
      })
      const results = (await all(`/extractions/?run=${run.id}`)).map(mapResult)
      return { run: mapRun(run), results }
    },
    async listRuns() {
      return (await all('/runs/')).map(mapRun)
    },
    async listResults(f: ResultFilters = {}) {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(f)) if (v !== undefined && v !== '') q.set(k, String(v))
      if (!f.run) q.set('latest', 'true')
      return (await all(`/extractions/?${q}`)).map(mapResult)
    },
    async search(r) {
      const out = await req<Json>('/retrieval/search/', { method: 'POST', json: { query: r.query, specification: r.specification, document_ids: r.document_ids, top_k: r.top_k ?? 8, mode: r.mode ?? 'hybrid', graph_expansion: r.graph_expansion ?? true } })
      return { query: out.query, mode: out.mode, graph_expansion: out.graph_expansion, documents_searched: out.documents_searched, count: out.count, hits: out.hits.map(mapHit) }
    },
    async graph(p = {}) {
      const q = new URLSearchParams()
      if (p.document) q.set('document', String(p.document))
      if (p.run) q.set('run', String(p.run))
      return req(`/graph/?${q}`)
    },
    async reviewQueue(runId) {
      const rows = await api.listResults({ run: runId, review_status: 'pending' })
      return rows.filter((r) => (r.queue_reasons?.length ?? 0) > 0)
    },
    async submitReview(r) {
      const review = await req<Json>('/reviews/', { method: 'POST', json: r })
      const result = mapResult(await req<Json>(`/extractions/${r.result}/`))
      return { review: { ...review, corrected_value: num(review.corrected_value) } as never, result }
    },
    async listReviews() {
      return (await all('/reviews/')).map((r) => ({ ...r, corrected_value: num(r.corrected_value), document: 0, specification_key: '', result_summary: `Result ${r.result}` }) as never)
    },
    async listEvaluationDatasets() {
      return all('/evaluations/datasets/') as never
    },
    async runEvaluation(r) {
      const er = await req<Json>('/evaluations/runs/', { method: 'POST', json: { dataset: r.dataset } })
      return hydrateEval(er)
    },
    async listEvaluationRuns() {
      return Promise.all((await all('/evaluations/runs/')).map(hydrateEval))
    },
    async compareEvaluations(b, c) {
      const [bb, cc] = await Promise.all([req<Json>(`/evaluations/runs/${b}/`), req<Json>(`/evaluations/runs/${c}/`)])
      return buildComparison(await hydrateEval(bb), await hydrateEval(cc))
    },
    async chat(r): Promise<ChatResponse> {
      const out = await req<Json>('/chat/', { method: 'POST', json: { message: r.message, document_ids: r.document_ids, history: r.history } })
      const cites = (out.citations ?? []) as ChatResponse['citations']
      const grounded = cites.length > 0
      return {
        answer: grounded ? out.answer : out.answer || 'Insufficient evidence in the indexed documents.',
        grounded,
        citations: cites,
        extractions: out.extractions ?? [],
        mode: grounded ? (out.mode === 'llm' ? 'llm' : 'extractive') : 'insufficient_evidence',
        provider: out.provider,
        model: out.model,
        warnings: out.warnings ?? [],
        scope: out.scope ?? { type: 'all', documents: [] },
      }
    },
    async listAudit(p = {}) {
      const q = new URLSearchParams()
      if (p.q) q.set('q', p.q)
      if (p.action_prefix) q.set('action_prefix', p.action_prefix)
      return all(`/audit/?${q}`) as never
    },
    async monitoring() {
      const runs = await all('/runs/')
      const latest = runs[0]
      const results = latest ? (await all(`/extractions/?run=${latest.id}`)).map(mapResult) : []
      const validation: Record<string, number> = {}
      for (const r of results) validation[r.validation_status] = (validation[r.validation_status] ?? 0) + 1
      const buckets = ['<0.5', '0.5-0.7', '0.7-0.85', '0.85-0.95', '≥0.95'].map((bucket) => ({ bucket, count: 0 }))
      for (const r of results.filter((x) => x.status === 'found')) buckets[r.confidence < 0.5 ? 0 : r.confidence < 0.7 ? 1 : r.confidence < 0.85 ? 2 : r.confidence < 0.95 ? 3 : 4].count += 1
      const evals = await all('/evaluations/runs/')
      return {
        runs: runs.length,
        results: results.length,
        review_backlog: results.filter((r) => (r.queue_reasons?.length ?? 0) > 0).length,
        reviewed: results.filter((r) => r.review_status !== 'pending').length,
        validation,
        confidence_buckets: buckets,
        run_history: [...runs].reverse().map((r) => ({ run: r.id, label: `#${r.id}`, found_rate: r.metrics?.found_rate ?? 0, mean_confidence: r.metrics?.mean_confidence ?? 0, created_at: r.created_at })),
        eval_history: [...evals].reverse().map((e) => ({ id: e.id, label: `#${e.id}`, accuracy: e.metrics?.overall?.accuracy ?? 0, f1: e.metrics?.overall?.f1 ?? 0, created_at: e.created_at })),
      }
    },
    async resetDemo() {
      throw unsupported('Reset demo')
    },
  }
  return api
}
