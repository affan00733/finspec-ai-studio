/** Validation of extraction outcomes (port of backend/engine/validation.py). */
import type { Check, DocContext, ExtractionOutcome, SpecDef } from './engineTypes.ts'
import { ALLOWED_PRECEDING, REVENUE_FAMILY } from './extraction.ts'

const digits = (s: string) => s.replace(/\D/g, '')

export function validateOutcome(outcome: ExtractionOutcome, spec: SpecDef, ctx: DocContext, docText?: string): Check[] {
  const checks: Check[] = []
  if (outcome.status === 'ambiguous') {
    checks.push({ rule: 'ambiguous_evidence', severity: 'error', passed: false, message: outcome.rationale })
    return checks
  }
  if (outcome.status === 'rejected') {
    checks.push({ rule: 'model_output_rejected', severity: 'error', passed: false, message: outcome.rationale })
    return checks
  }
  if (outcome.status === 'not_found') {
    checks.push({ rule: 'value_reported', severity: 'info', passed: false, message: outcome.rationale || 'No value found.' })
    return checks
  }
  const c = outcome.best!
  checks.push({
    rule: 'evidence_present',
    severity: 'error',
    passed: Boolean(c.quote) && c.chunk_id != null,
    message: c.quote ? 'Value is backed by a quoted source passage.' : 'No evidence quote.',
  })
  const grounded = digits(c.raw_number) !== '' && digits(c.quote).includes(digits(c.raw_number))
  checks.push({
    rule: 'evidence_grounded',
    severity: 'error',
    passed: grounded,
    message: grounded ? 'Reported number appears verbatim in the quoted evidence.' : `Number '${c.raw_number}' not found in quoted evidence.`,
  })
  if (docText !== undefined) {
    const exact = docText.slice(c.start_char, c.end_char) === c.quote
    checks.push({
      rule: 'evidence_offsets',
      severity: 'error',
      passed: exact,
      message: exact ? 'Evidence offsets point at the exact quote in the document.' : 'Evidence offsets do not match the document text.',
    })
  }
  if (outcome.fiscal_year !== null) {
    if (c.method === 'table') {
      const ok = Boolean(c.year_matched)
      checks.push({
        rule: 'fiscal_year_alignment',
        severity: 'warning',
        passed: ok,
        message: ok ? `Value read from the ${outcome.fiscal_year} column.` : 'No year header found; first value column assumed.',
      })
    } else {
      const ok = Boolean(c.year_matched)
      checks.push({
        rule: 'fiscal_year_alignment',
        severity: 'info',
        passed: true,
        message: ok ? `Sentence explicitly refers to ${outcome.fiscal_year}.` : 'Sentence does not name a year; document fiscal year assumed.',
      })
    }
  }
  const stated = c.unit_source !== 'unknown'
  checks.push({
    rule: 'unit_stated',
    severity: 'warning',
    passed: stated,
    message: stated ? `Unit '${c.unit_label}' stated in ${c.unit_source}.` : 'No unit statement found; value assumed to be in base units.',
  })
  if (spec.unit_type === 'currency') {
    checks.push({
      rule: 'currency_known',
      severity: 'warning',
      passed: Boolean(c.currency),
      message: c.currency ? `Currency ${c.currency}.` : 'Currency could not be determined.',
    })
    if (c.currency && ctx.currency && c.currency !== ctx.currency) {
      checks.push({
        rule: 'currency_matches_document',
        severity: 'error',
        passed: false,
        message: `Currency ${c.currency} differs from document currency ${ctx.currency}.`,
      })
    }
  }
  if (spec.rules.non_negative) {
    checks.push({
      rule: 'non_negative',
      severity: 'error',
      passed: c.normalized >= 0,
      message: c.normalized >= 0 ? 'Value is non-negative.' : 'Negative value for a non-negative metric.',
    })
  }
  const plausible =
    spec.unit_type === 'currency'
      ? (Math.abs(c.normalized) >= 1e4 && Math.abs(c.normalized) <= 1e13) || c.normalized === 0
      : (Math.abs(c.normalized) >= 1 && Math.abs(c.normalized) <= 1e10) || c.normalized === 0
  checks.push({
    rule: 'magnitude_plausible',
    severity: 'warning',
    passed: plausible,
    message: plausible ? 'Magnitude is in a plausible range.' : `Normalized value ${c.normalized} is outside the plausible range.`,
  })
  // Demo addition: guard against evidence that mentions an excluded concept (adjusted, market-based, segment, ...).
  const numAt = c.quote.indexOf(c.raw_number)
  const lead = (numAt >= 0 ? c.quote.slice(0, numAt) : c.quote).toLowerCase() // text that introduces the figure
  const hit = spec.exclude_terms.find((e) => lead.includes(e.toLowerCase()))
  checks.push({
    rule: 'exclusion_terms_absent',
    severity: 'error',
    passed: !hit,
    message: hit
      ? `Evidence mentions excluded term '${hit}' - this specification does not accept that measure.`
      : 'Evidence does not mention any excluded measure.',
  })
  if (c.method === 'narrative') {
    // Defence in depth: even if the reader accepted it, a matched label introduced by an unrelated word
    // ("Operating revenue", "Adjusted EBITDA", "Segment revenue") is probably a different measure.
    const at = c.quote.toLowerCase().indexOf(c.label.toLowerCase())
    const wm = at > 0 ? /([A-Za-z][A-Za-z'’-]*)\s+$/.exec(c.quote.slice(0, at)) : null
    const odd = wm && !ALLOWED_PRECEDING.has(wm[1].toLowerCase()) ? wm[1] : null
    checks.push({
      rule: 'line_item_context',
      severity: 'error',
      passed: !odd,
      message: odd
        ? `Matched line item '${c.label}' is preceded by '${odd}' - this is probably a different measure ('${odd} ${c.label}').`
        : 'Matched line item is not qualified by an unrelated word.',
    })
  }
  const conflicting = outcome.candidates.filter((x) => x.role === 'conflicting')
  checks.push({
    rule: 'no_conflicting_evidence',
    severity: 'warning',
    passed: conflicting.length === 0,
    message: conflicting.length === 0 ? 'No conflicting values found.' : `${conflicting.length} lower-reliability conflicting value(s) found.`,
  })
  if (c.notes.some((n) => n.startsWith('family_fallback:'))) {
    checks.push({
      rule: 'line_item_exact',
      severity: 'error',
      passed: false,
      message: 'Value was read from a differently named line item (relaxed matching); it is not the requested measure.',
    })
  }
  const nSupport = outcome.candidates.filter((x) => x.role === 'primary' || x.role === 'supporting').length
  checks.push({
    rule: 'corroborated',
    severity: 'info',
    passed: nSupport > 1,
    message: nSupport > 1 ? `${nSupport} independent source(s) agree.` : 'Single source.',
  })
  return checks
}

export function validateCross(outcomes: Map<string, ExtractionOutcome>): Map<string, Check[]> {
  const out = new Map<string, Check[]>()
  const val = (key: string): number | null => {
    const o = outcomes.get(key)
    return o && o.status === 'found' && o.best ? o.best.normalized : null
  }
  const add = (key: string, c: Check) => out.set(key, [...(out.get(key) ?? []), c])
  const rev = REVENUE_FAMILY.map(val).find((v) => v !== null) ?? null
  const rules: [string, string, string, 'error' | 'warning', string, (a: number, b: number) => boolean][] = [
    ['green_capex', 'capex', 'green_capex_le_capex', 'error', 'Green CapEx must not exceed total CapEx', (a, b) => a <= b],
    ['ebitda', 'operating_income', 'ebitda_ge_operating_income', 'warning', 'EBITDA is normally >= operating income', (a, b) => a >= b],
    ['total_liabilities', 'total_assets', 'liabilities_le_assets', 'warning', 'Total liabilities are normally <= total assets', (a, b) => a <= b],
    ['capex', 'total_assets', 'capex_le_assets', 'warning', 'CapEx is normally far below total assets', (a, b) => a <= b],
  ]
  for (const [aKey, bKey, rule, sev, text, fn] of rules) {
    const a = val(aKey)
    const b = val(bKey)
    if (a === null || b === null) continue
    const ok = fn(a, b)
    const msg = text + (ok ? ' - satisfied.' : ` - violated (${a} vs ${b}).`)
    add(aKey, { rule, severity: sev, passed: ok, message: msg, details: { other: bKey } })
    add(bKey, { rule, severity: sev, passed: ok, message: msg, details: { other: aKey } })
  }
  if (rev !== null) {
    for (const [key, rule, sev] of [
      ['operating_income', 'operating_income_le_revenue', 'error'],
      ['rd_expense', 'rd_le_revenue', 'warning'],
      ['capex', 'capex_le_revenue', 'warning'],
    ] as const) {
      const v = val(key)
      if (v === null) continue
      const ok = v <= rev
      add(key, { rule, severity: sev, passed: ok, message: `${key} <= revenue measure` + (ok ? ' - satisfied.' : ` - violated (${v} vs ${rev}).`), details: { other: 'revenue_family' } })
    }
  }
  const currencies = new Set<string>()
  for (const [k, o] of outcomes) if (o.status === 'found' && o.best?.currency && k !== 'scope_1' && k !== 'scope_2') currencies.add(o.best.currency)
  if (currencies.size > 1) {
    for (const [k, o] of outcomes)
      if (o.status === 'found' && o.best?.currency)
        add(k, { rule: 'currency_consistent', severity: 'error', passed: false, message: `Multiple currencies in one document: ${[...currencies].sort().join(', ')}` })
  }
  return out
}

export type ValidationStatus = 'pass' | 'warn' | 'fail' | 'not_applicable'

export function summarize(checks: Check[], status = 'found'): ValidationStatus {
  if (status === 'not_found') return 'not_applicable'
  if (checks.some((c) => c.severity === 'error' && !c.passed)) return 'fail'
  if (checks.some((c) => c.severity === 'warning' && !c.passed)) return 'warn'
  return 'pass'
}
