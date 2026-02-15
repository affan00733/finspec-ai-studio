/** Persistent (localStorage) demo workspace state: runs, reviews, prompt versions, audit trail, evaluations. */
import { DEMO_DATASET } from '@/data/demo-dataset'
import type { AuditEvent, PromptTemplate, Review, Specification } from '@/types'
import type { EvalMetrics } from './evaluation.ts'
import type { ExtractionPolicy } from './engineTypes.ts'
import { SEED_TS, seedPromptTemplates } from './seed.ts'

export const STORAGE_KEY = 'finspec-demo-state-v1'

export interface RunRecord {
  id: number
  label: string
  agent_id: number
  version_id: number | null
  version_label: string
  controls: ExtractionPolicy
  document_ids: number[]
  spec_keys: string[]
  created_at: string
  created_by: string
}

export interface StoredEvalRun {
  id: number
  dataset: number
  prompt_version: number
  prompt_version_label: string
  controls: ExtractionPolicy
  created_at: string
  created_by: string
  metrics: EvalMetrics
}

export interface DemoState {
  v: 1
  templates: PromptTemplate[]
  specs: Specification[]
  runs: RunRecord[]
  evalRuns: StoredEvalRun[]
  reviews: Review[]
  audit: AuditEvent[]
  counters: { run: number; review: number; audit: number; evalRun: number; version: number }
}

export function seedSpecs(): Specification[] {
  return DEMO_DATASET.specifications.map((s, i) => ({
    id: i + 1,
    key: s.key,
    name: s.name,
    category: s.category,
    unit_type: s.unit_type,
    sign_policy: s.sign_policy,
    description: s.description,
    aliases: [...s.aliases],
    exclude_terms: [...s.exclude_terms],
    rules: { ...s.rules },
    is_active: true,
  }))
}

export function freshState(): DemoState {
  const templates = seedPromptTemplates()
  const v2 = templates[0].versions.find((v) => v.id === 2)!
  return {
    v: 1,
    templates,
    specs: seedSpecs(),
    runs: [
      {
        id: 1,
        label: 'Seed run - production prompt v2 on all reports',
        agent_id: 1,
        version_id: 2,
        version_label: v2.label,
        controls: { ...v2.controls },
        document_ids: DEMO_DATASET.documents.map((d) => d.id),
        spec_keys: DEMO_DATASET.specifications.map((s) => s.key),
        created_at: SEED_TS,
        created_by: 'seed',
      },
    ],
    evalRuns: [],
    reviews: [],
    audit: [
      {
        id: 1,
        actor: 'seed',
        action: 'demo.seeded',
        entity_type: 'workspace',
        entity_id: '',
        summary: 'Demo workspace seeded with 4 fictional companies, 12 annual reports and 13 specifications.',
        details: {},
        created_at: SEED_TS,
      },
      {
        id: 2,
        actor: 'seed',
        action: 'run.created',
        entity_type: 'extraction_run',
        entity_id: '1',
        summary: 'Run #1: 12 document(s), 13 specification(s), mode=deterministic/mock',
        details: {},
        created_at: SEED_TS,
      },
    ],
    counters: { run: 1, review: 0, audit: 2, evalRun: 0, version: 4 },
  }
}

let state: DemoState | null = null
const listeners = new Set<() => void>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function getState(): DemoState {
  if (state) return state
  const raw = storage()?.getItem(STORAGE_KEY)
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as DemoState
      if (parsed?.v === 1) {
        state = parsed
        return state
      }
    } catch {
      /* corrupted storage: fall through to a fresh state */
    }
  }
  state = freshState()
  return state
}

export function persist(): void {
  try {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(getState()))
  } catch {
    /* quota or privacy mode: the demo keeps working in memory */
  }
  listeners.forEach((l) => l())
}

export function resetState(): DemoState {
  try {
    storage()?.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
  state = freshState()
  listeners.forEach((l) => l())
  return state
}

export function onStateChange(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function audit(action: string, entityType: string, entityId: string | number, summary: string, details: Record<string, unknown> = {}, actor = 'demo-analyst'): void {
  const s = getState()
  s.counters.audit += 1
  s.audit.unshift({ id: s.counters.audit, actor, action, entity_type: entityType, entity_id: String(entityId), summary, details, created_at: new Date().toISOString() })
  if (s.audit.length > 400) s.audit.length = 400
}
