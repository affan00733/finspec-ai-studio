/**
 * Domain types shared by the UI, the demo engine and the HTTP client.
 * Shapes follow the Django serializers (snake_case) where an equivalent exists.
 */
import type { EvalMetrics, CaseOutcome } from '@/demo/evaluation'
import type { ExtractionPolicy, RetrievalMode } from '@/demo/engineTypes'

export type { EvalMetrics, CaseOutcome, ExtractionPolicy, RetrievalMode }

export type ValidationStatus = 'pass' | 'warn' | 'fail' | 'not_applicable' | 'pending'
export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'corrected'
export type ExtractionStatus = 'found' | 'not_found' | 'ambiguous' | 'rejected'

export interface Company {
  id: number
  name: string
  ticker: string
  sector: string
  description: string
  reporting_currency: string
  is_fictional: boolean
  document_count: number
  revenue_label?: string
}

export interface DocumentSummary {
  id: number
  company: number
  company_name: string
  title: string
  doc_type: string
  fiscal_year: number | null
  source_filename: string
  status: string
  chunk_count: number
}

export interface DocumentSection {
  id: number
  order: number
  heading: string
  level: number
  section_type: string
  start_char: number
  end_char: number
}

export interface DocumentChunk {
  id: number
  document: number
  index: number
  chunk_type: 'text' | 'table'
  heading: string
  text: string
  start_char: number
  end_char: number
  token_count: number
  meta: Record<string, unknown>
}

export interface DocumentDetail extends DocumentSummary {
  raw_text: string
  sections: DocumentSection[]
  chunks: DocumentChunk[]
}

export interface Specification {
  id: number
  key: string
  name: string
  category: string
  unit_type: 'currency' | 'emissions'
  sign_policy: 'as_reported' | 'absolute'
  description: string
  aliases: string[]
  exclude_terms: string[]
  rules: Record<string, unknown>
  is_active: boolean
}

export type VersionStatus = 'active' | 'candidate' | 'archived'

export interface PromptVersion {
  id: number
  template: number
  version: number
  label: string
  system_prompt: string
  user_template: string
  output_schema: Record<string, unknown>
  notes: string
  status: VersionStatus
  is_active: boolean
  controls: ExtractionPolicy
  created_by: string
  created_at: string
  /** True when the free-form text differs from the baseline it was copied from (not applied in mock mode). */
  scenario?: string
}

export interface PromptTemplate {
  id: number
  name: string
  kind: 'extraction' | 'chat'
  description: string
  active_version: number | null
  versions: PromptVersion[]
}

export interface AgentConfiguration {
  id: number
  name: string
  description: string
  mode: 'deterministic' | 'llm'
  provider: 'mock' | 'openai' | 'azure'
  model: string
  is_default: boolean
  top_k: number
  available: boolean
  unavailable_reason?: string
}

export interface Evidence {
  id: number
  chunk: number | null
  role: 'primary' | 'supporting' | 'conflicting' | 'analyst'
  method: string
  quote: string
  context: string
  start_char: number
  end_char: number
  score: number
  raw_number: string
  normalized_value: number | null
  notes: string[]
}

export interface ValidationCheck {
  id: number
  rule: string
  severity: 'info' | 'warning' | 'error'
  passed: boolean
  message: string
  details?: Record<string, unknown>
}

export interface Review {
  id: number
  result: number
  reviewer: string
  decision: 'approve' | 'reject' | 'correct'
  corrected_value: number | null
  corrected_unit: string
  evidence_quote: string
  comment: string
  created_at: string
}

export interface ExtractionResult {
  id: number
  run: number
  document: number
  document_title: string
  company: number
  company_name: string
  specification: number
  specification_key: string
  specification_name: string
  status: ExtractionStatus
  raw_value: string
  value: number | null
  scale: number
  currency: string
  unit_label: string
  normalized_value: number | null
  fiscal_year: number | null
  confidence: number
  method: string
  rationale: string
  warnings: string[]
  retrieved_chunk_ids: number[]
  validation_status: ValidationStatus
  review_status: ReviewStatus
  final_value: number | null
  evidence: Evidence[]
  validations: ValidationCheck[]
  reviews: Review[]
  /** Why this result is in the review queue (if it is). */
  queue_reasons?: string[]
}

export interface ExtractionRun {
  id: number
  label: string
  agent: number
  agent_name: string
  prompt_version: number | null
  prompt_version_label: string
  mode: 'deterministic' | 'llm'
  provider: string
  model: string
  status: 'completed' | 'failed' | 'running' | 'pending'
  specification_keys: string[]
  document_ids: number[]
  options: ExtractionPolicy
  metrics: {
    total: number
    by_status: Record<string, number>
    by_validation: Record<string, number>
    found_rate: number
    mean_confidence: number
    documents: number
  }
  error: string
  created_by: string
  created_at: string
  result_count: number
  usage?: { calls: number; input_tokens: number; output_tokens: number }
}

export interface RunRequest {
  document_ids?: number[]
  specification_keys?: string[]
  agent?: number
  prompt_version?: number
  /** Override structured controls (Prompt Studio candidate tests). */
  controls?: Partial<ExtractionPolicy>
  label?: string
  /** Compute and return results without saving a run (Prompt Studio tests). */
  dry_run?: boolean
}

export interface RetrievalHit {
  chunk_id: number
  document_id: number
  index: number
  heading: string
  chunk_type: 'text' | 'table'
  score: number
  rank: number
  via: 'direct' | 'graph'
  scores: { bm25?: number; lexical?: number; rrf: number }
  from_chunk_id: number | null
  relation: string | null
  start_char: number
  end_char: number
  text: string
  caption?: string
}

export interface RetrievalRequest {
  query?: string
  specification?: string
  document_ids?: number[]
  top_k?: number
  mode?: RetrievalMode
  graph_expansion?: boolean
}

export interface RetrievalResponse {
  query: string
  mode: RetrievalMode
  graph_expansion: boolean
  documents_searched: number[]
  count: number
  hits: RetrievalHit[]
}

export interface GeneratedPromptPayload {
  specification: string
  system: string
  user: string
  schema: Record<string, unknown>
  variables: Record<string, string | number>
  retrieved_chunk_ids: number[]
  estimated_input_tokens: number
  template_version: number | null
}

export interface PromptGenerateRequest {
  specifications: string[]
  document?: number
  version?: number
  top_k?: number
  /** Override template text (free-form edits). Rendering reflects it; mock extraction ignores it. */
  system_prompt?: string
  user_template?: string
  controls?: Partial<ExtractionPolicy>
}

export interface ChatCitation {
  chunk_id: number
  document_id: number
  quote: string
  start_char: number
  end_char: number
  company?: string
  fiscal_year?: number | null
  label?: string
}

export interface ChatResponse {
  answer: string
  grounded: boolean
  citations: ChatCitation[]
  extractions: {
    document_id: number
    company: string
    fiscal_year: number | null
    specification: string
    status: string
    confidence: number
    value?: number
    reported?: string
  }[]
  mode: 'extractive' | 'insufficient_evidence' | 'llm'
  provider: string
  model: string
  warnings: string[]
  scope: { type: 'explicit' | 'inferred' | 'all'; documents: { id: number; title: string; company: string; fiscal_year: number | null }[] }
}

export interface ChatRequest {
  message: string
  document_ids?: number[]
  history?: { role: 'user' | 'assistant'; content: string }[]
}

export interface EvaluationDataset {
  id: number
  name: string
  description: string
  case_count: number
}

export interface EvaluationCaseResult {
  case: number
  document: number
  company_name: string
  fiscal_year: number | null
  specification_key: string
  expected_value: number | null
  predicted_value: number | null
  outcome: CaseOutcome
  passed: boolean
  pinned: boolean
  incident?: string
  detail: { status: string; confidence: number; rationale: string; quote?: string }
}

export interface EvaluationRun {
  id: number
  dataset: number
  dataset_name: string
  prompt_version: number
  prompt_version_label: string
  controls: ExtractionPolicy
  status: 'completed' | 'failed'
  metrics: EvalMetrics
  created_at: string
  created_by: string
  results: EvaluationCaseResult[]
}

export type CaseChangeKind = 'improved' | 'regressed' | 'unchanged_pass' | 'unchanged_fail' | 'changed_fail'

export interface CaseChange {
  document: number
  company_name: string
  fiscal_year: number | null
  specification_key: string
  pinned: boolean
  incident?: string
  expected_value: number | null
  baseline_outcome: CaseOutcome
  candidate_outcome: CaseOutcome
  baseline_value: number | null
  candidate_value: number | null
  change: CaseChangeKind
}

export interface GateCheck {
  id: string
  label: string
  passed: boolean
  detail: string
}

export interface EvaluationComparison {
  baseline: EvaluationRun
  candidate: EvaluationRun
  changes: CaseChange[]
  summary: { improved: number; regressed: number; unchanged_pass: number; unchanged_fail: number; changed_fail: number }
  deltas: { accuracy: number; f1: number; false_positive: number; incorrect_value: number; missed: number }
  gate: { passed: boolean; checks: GateCheck[] }
}

export interface EvaluationRunRequest {
  dataset: number
  prompt_version: number
}

export interface AuditEvent {
  id: number
  actor: string
  action: string
  entity_type: string
  entity_id: string
  summary: string
  details: Record<string, unknown>
  created_at: string
}

export interface ProviderStatus {
  mode: 'demo' | 'backend'
  default_provider: string
  providers: { name: string; configured: boolean; paid: boolean; note: string }[]
  fallback_policy: string
}

export interface HealthStatus {
  status: 'ok' | 'degraded'
  mode: 'demo' | 'backend'
  version: string
  counts: { companies: number; documents: number; specifications: number; runs: number }
}

export interface GraphNode {
  id: string
  type: 'company' | 'document' | 'chunk' | 'specification' | 'result'
  label: string
  [key: string]: unknown
}
export interface GraphEdge {
  source: string
  target: string
  type: string
  weight?: number
}
export interface GraphData {
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export interface ReviewRequest {
  result: number
  decision: 'approve' | 'reject' | 'correct'
  reviewer?: string
  corrected_value?: number | null
  corrected_unit?: string
  evidence_quote?: string
  comment?: string
}

export interface MonitoringSummary {
  runs: number
  results: number
  review_backlog: number
  reviewed: number
  validation: Record<string, number>
  confidence_buckets: { bucket: string; count: number }[]
  run_history: { run: number; label: string; found_rate: number; mean_confidence: number; created_at: string }[]
  eval_history: { id: number; label: string; accuracy: number; f1: number; created_at: string }[]
}

export class ApiError extends Error {
  code: string
  status: number
  constructor(message: string, code = 'error', status = 400) {
    super(message)
    this.code = code
    this.status = status
  }
}
