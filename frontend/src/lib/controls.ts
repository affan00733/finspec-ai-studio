import type { ExtractionPolicy } from '@/demo/engineTypes'

export interface ControlDef {
  key: keyof ExtractionPolicy
  label: string
  description: string
  /** Concrete, reproducible effect in the demo corpus. */
  effect: string
}

export const BOOLEAN_CONTROLS: ControlDef[] = [
  {
    key: 'graphExpansion',
    label: 'Graph expansion',
    description: 'Pull in chunks linked to the top hits (table captions, adjacent notes, next / previous).',
    effect: 'Adds context chunks to the prompt; extraction values usually stay the same.',
  },
  {
    key: 'applyExclusions',
    label: 'Respect exclusion terms',
    description: "Honour each specification's exclusion terms (adjusted, segment, market-based, …).",
    effect: 'Off: Cascade Scope 2 sees both location- and market-based figures → ambiguous → validation fails.',
  },
  {
    key: 'strictLineItemContext',
    label: 'Strict line-item context',
    description: 'Reject a match preceded by an unrelated word, e.g. “Adjusted EBITDA” or “Operating revenue”.',
    effect: 'Off: Atlas “Operating revenue” is reported as Revenue and Adjusted EBITDA as EBITDA.',
  },
  {
    key: 'enforceFiscalYear',
    label: 'Fiscal-year alignment',
    description: 'Read the column or sentence that belongs to the target fiscal year.',
    effect: 'Off: the first value column is used - wrong year for Atlas (oldest-first columns).',
  },
  {
    key: 'applyUnitScale',
    label: 'Apply stated unit scale',
    description: 'Multiply by the document’s stated scale (millions, billions, ktCO2e).',
    effect: 'Off: Northstar revenue becomes 9,967 instead of 9,967,000,000 → magnitude warning.',
  },
  {
    key: 'revenueFamilyFallback',
    label: 'Revenue-family fallback',
    description: 'If the exact line item is missing, substitute a sibling (Net sales for Revenue, …).',
    effect: 'On: values appear where none exist → false positives and a failed line-item check.',
  },
]

export function diffControls(a: ExtractionPolicy, b: ExtractionPolicy): string[] {
  const out: string[] = []
  for (const k of Object.keys(a) as (keyof ExtractionPolicy)[]) {
    if (a[k] !== b[k]) out.push(`${k}: ${String(a[k])} → ${String(b[k])}`)
  }
  return out
}

export const CONTROL_SHORT: Record<string, string> = {
  topK: 'Top-k',
  retrievalMode: 'Retrieval mode',
  graphExpansion: 'Graph expansion',
  applyExclusions: 'Exclusion terms',
  strictLineItemContext: 'Strict line-item context',
  enforceFiscalYear: 'Fiscal-year alignment',
  applyUnitScale: 'Unit scaling',
  revenueFamilyFallback: 'Revenue-family fallback',
  reviewThreshold: 'Review threshold',
}
