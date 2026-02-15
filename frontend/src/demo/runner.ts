/** Executes extraction for documents x specifications under a policy and validates the outcomes. */
import { DEMO_DATASET } from '@/data/demo-dataset'
import { getCorpus } from './corpus.ts'
import { DeterministicExtractor } from './extraction.ts'
import type { Check, ExtractionOutcome, ExtractionPolicy, SpecDef } from './engineTypes.ts'
import { summarize, validateCross, validateOutcome, type ValidationStatus } from './validation.ts'
import { RetrievalIndex } from './retrieval.ts'

export interface ComputedResult {
  document_id: number
  spec_key: string
  outcome: ExtractionOutcome
  checks: Check[]
  validation_status: ValidationStatus
}

const docById = new Map(DEMO_DATASET.documents.map((d) => [d.id, d]))

export function runExtraction(
  policy: ExtractionPolicy,
  documentIds: number[],
  specs: SpecDef[],
  index: RetrievalIndex = getCorpus().index,
): ComputedResult[] {
  const corpus = getCorpus()
  const extractor = new DeterministicExtractor(index, policy, specs)
  const results: ComputedResult[] = []
  for (const docId of documentIds) {
    const doc = docById.get(docId)
    if (!doc) continue
    const ctx = corpus.contexts.get(docId)!
    const outcomes = new Map<string, ExtractionOutcome>()
    for (const spec of specs) outcomes.set(spec.key, extractor.extract(spec, docId, ctx))
    const cross = validateCross(outcomes)
    for (const spec of specs) {
      const outcome = outcomes.get(spec.key)!
      const checks = [...validateOutcome(outcome, spec, ctx, doc.raw_text), ...(cross.get(spec.key) ?? [])]
      results.push({ document_id: docId, spec_key: spec.key, outcome, checks, validation_status: summarize(checks, outcome.status) })
    }
  }
  return results
}
