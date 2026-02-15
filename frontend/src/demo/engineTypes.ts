/** Internal types for the browser demo engine (mirrors backend/engine/types.py). */

export interface SpecDef {
  key: string
  name: string
  aliases: string[]
  category: string
  unit_type: 'currency' | 'emissions'
  sign_policy: 'as_reported' | 'absolute'
  exclude_terms: string[]
  description: string
  rules: { non_negative?: boolean } & Record<string, unknown>
}

export interface ChunkMeta {
  caption?: string
  table_header_lines?: string[]
  table_part?: number
  table_parts?: number
}

export interface ChunkRef {
  id: number
  document_id: number
  index: number
  text: string
  start_char: number
  end_char: number
  chunk_type: 'text' | 'table'
  heading: string
  meta: ChunkMeta
}

export interface DocContext {
  fiscal_year: number | null
  currency: string | null
  scale: number | null
  emission_unit: [number, string] | null
}

export type CandidateRole = 'primary' | 'supporting' | 'conflicting'

export interface Candidate {
  spec_key: string
  method: 'table' | 'narrative' | 'llm'
  label: string
  raw_number: string
  value: number
  scale: number
  currency: string | null
  unit_label: string
  normalized: number
  granularity: number
  chunk_id: number
  document_id: number
  quote: string
  start_char: number
  end_char: number
  score: number
  year: number | null
  year_matched: boolean | null
  unit_source: string
  notes: string[]
  role: CandidateRole
  context: string
}

export type OutcomeStatus = 'found' | 'not_found' | 'ambiguous' | 'rejected'

export interface ExtractionOutcome {
  spec_key: string
  status: OutcomeStatus
  fiscal_year: number | null
  best: Candidate | null
  candidates: Candidate[]
  confidence: number
  rationale: string
  retrieved_chunk_ids: number[]
  warnings: string[]
}

export type RetrievalMode = 'hybrid' | 'bm25' | 'lexical'

/**
 * Structured extraction controls. In Demo/Mock mode these -- not the free-form prompt text -- drive the
 * deterministic reader, so every flag has a concrete, visible effect on extraction and validation.
 */
export interface ExtractionPolicy {
  /** Retrieval depth (chunks read per metric). */
  topK: number
  retrievalMode: RetrievalMode
  /** Pull in adjacent chunks (table caption/context, next/previous) through the chunk graph. */
  graphExpansion: boolean
  /** Respect each specification's exclusion terms (adjusted, segment, market-based, ...). */
  applyExclusions: boolean
  /** Reject mentions that follow an unrelated word ("Adjusted EBITDA", "Segment revenue"). */
  strictLineItemContext: boolean
  /** Read the column / sentence for the target fiscal year instead of the first value column. */
  enforceFiscalYear: boolean
  /** Apply the document's stated unit scale (millions / billions / ktCO2e) to the number. */
  applyUnitScale: boolean
  /** If the exact line item is absent, substitute a sibling revenue measure (Net sales for Revenue, ...). */
  revenueFamilyFallback: boolean
  /** Results below this confidence (or with validation warnings) are routed to the review queue. */
  reviewThreshold: number
}

export const DEFAULT_POLICY: ExtractionPolicy = {
  topK: 8,
  retrievalMode: 'hybrid',
  graphExpansion: true,
  applyExclusions: true,
  strictLineItemContext: true,
  enforceFiscalYear: true,
  applyUnitScale: true,
  revenueFamilyFallback: false,
  reviewThreshold: 0.85,
}

export interface Check {
  rule: string
  severity: 'info' | 'warning' | 'error'
  passed: boolean
  message: string
  details?: Record<string, unknown>
}
