import type {
  AgentConfiguration,
  AuditEvent,
  ChatRequest,
  ChatResponse,
  Company,
  DocumentDetail,
  DocumentSummary,
  EvaluationComparison,
  EvaluationDataset,
  EvaluationRun,
  EvaluationRunRequest,
  ExtractionResult,
  ExtractionRun,
  GeneratedPromptPayload,
  GraphData,
  HealthStatus,
  MonitoringSummary,
  PromptGenerateRequest,
  PromptTemplate,
  PromptVersion,
  ProviderStatus,
  RetrievalRequest,
  RetrievalResponse,
  Review,
  ReviewRequest,
  RunRequest,
  Specification,
} from '@/types'
import type { ExtractionPolicy } from '@/demo/engineTypes'

export interface ResultFilters {
  run?: number
  document?: number
  company?: number
  specification?: string
  status?: string
  validation_status?: string
  review_status?: string
}

export interface NewVersionInput {
  label?: string
  system_prompt: string
  user_template: string
  notes?: string
  controls: ExtractionPolicy
  /** Version this one was copied from. */
  based_on?: number
}

/** The single surface the UI talks to. Implemented by the browser demo engine and by the Django HTTP client. */
export interface FinSpecApi {
  mode: 'demo' | 'backend'
  health(): Promise<HealthStatus>
  providerStatus(): Promise<ProviderStatus>

  listCompanies(): Promise<Company[]>
  listDocuments(): Promise<DocumentSummary[]>
  getDocument(id: number): Promise<DocumentDetail>

  listSpecifications(): Promise<Specification[]>
  updateSpecification(key: string, patch: Partial<Pick<Specification, 'description' | 'aliases' | 'exclude_terms' | 'is_active'>>): Promise<Specification>

  listPromptTemplates(): Promise<PromptTemplate[]>
  createPromptVersion(templateId: number, input: NewVersionInput): Promise<PromptVersion>
  activatePromptVersion(versionId: number): Promise<PromptVersion>
  generatePrompts(req: PromptGenerateRequest): Promise<GeneratedPromptPayload[]>
  listAgents(): Promise<AgentConfiguration[]>

  createRun(req: RunRequest): Promise<{ run: ExtractionRun; results: ExtractionResult[] }>
  listRuns(): Promise<ExtractionRun[]>
  listResults(filters?: ResultFilters): Promise<ExtractionResult[]>

  search(req: RetrievalRequest): Promise<RetrievalResponse>
  graph(params?: { document?: number; run?: number }): Promise<GraphData>

  reviewQueue(runId?: number): Promise<ExtractionResult[]>
  submitReview(req: ReviewRequest): Promise<{ review: Review; result: ExtractionResult }>
  listReviews(): Promise<(Review & { result_summary: string; document: number; specification_key: string })[]>

  listEvaluationDatasets(): Promise<EvaluationDataset[]>
  runEvaluation(req: EvaluationRunRequest): Promise<EvaluationRun>
  listEvaluationRuns(): Promise<EvaluationRun[]>
  compareEvaluations(baselineId: number, candidateId: number): Promise<EvaluationComparison>

  chat(req: ChatRequest): Promise<ChatResponse>
  listAudit(params?: { q?: string; action_prefix?: string }): Promise<AuditEvent[]>
  monitoring(): Promise<MonitoringSummary>

  /** Demo only: wipe localStorage state and re-seed. */
  resetDemo(): Promise<void>
}
