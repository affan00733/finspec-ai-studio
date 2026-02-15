/** Evaluation of extraction output against gold cases (port of backend/engine/evaluation.py). */
export type CaseOutcome = 'correct' | 'correct_absent' | 'incorrect_value' | 'missed' | 'false_positive' | 'abstained'

export function compareValue(
  expected: number | null,
  expectFound: boolean,
  predicted: number | null,
  status: string,
  tolerance = 0.0005,
): CaseOutcome {
  const hasPred = predicted !== null && status === 'found'
  if (!expectFound) return hasPred ? 'false_positive' : 'correct_absent'
  if (!hasPred) return status === 'ambiguous' || status === 'rejected' ? 'abstained' : 'missed'
  if (expected === null) return 'incorrect_value'
  if (expected === predicted) return 'correct'
  const base = Math.max(Math.abs(expected), Math.abs(predicted!))
  if (base > 0 && Math.abs(expected - predicted!) / base <= tolerance) return 'correct'
  return 'incorrect_value'
}

export interface MetricBlock {
  total: number
  correct: number
  correct_absent: number
  incorrect_value: number
  missed: number
  false_positive: number
  abstained: number
  accuracy: number
  precision: number
  recall: number
  f1: number
  grounded_rate?: number
  mean_confidence?: number
}

export interface EvalRow {
  outcome: CaseOutcome
  spec_key: string
  company: string
  predicted_found: boolean
  grounded: boolean
  confidence: number
}

const r4 = (x: number) => Math.round(x * 10000) / 10000

function prf(tp: number, fp: number, fn: number) {
  const p = tp + fp ? tp / (tp + fp) : 1
  const r = tp + fn ? tp / (tp + fn) : 1
  const f1 = p + r ? (2 * p * r) / (p + r) : 0
  return { precision: r4(p), recall: r4(r), f1: r4(f1) }
}

function block(rows: EvalRow[]): MetricBlock {
  const n = rows.length
  const cnt = (o: CaseOutcome) => rows.filter((r) => r.outcome === o).length
  const tp = cnt('correct')
  const fp = cnt('incorrect_value') + cnt('false_positive')
  const fn = cnt('missed') + cnt('abstained') + cnt('incorrect_value')
  const out: MetricBlock = {
    total: n,
    correct: tp,
    correct_absent: cnt('correct_absent'),
    incorrect_value: cnt('incorrect_value'),
    missed: cnt('missed'),
    false_positive: cnt('false_positive'),
    abstained: cnt('abstained'),
    accuracy: n ? r4((tp + cnt('correct_absent')) / n) : 0,
    ...prf(tp, fp, fn),
  }
  const found = rows.filter((r) => r.predicted_found)
  if (found.length) {
    out.grounded_rate = r4(found.filter((r) => r.grounded).length / found.length)
    out.mean_confidence = r4(found.reduce((a, r) => a + r.confidence, 0) / found.length)
  }
  return out
}

export interface EvalMetrics {
  overall: MetricBlock
  by_specification: Record<string, MetricBlock>
  by_company: Record<string, MetricBlock>
}

export function aggregate(rows: EvalRow[]): EvalMetrics {
  const group = (f: (r: EvalRow) => string) => {
    const m = new Map<string, EvalRow[]>()
    for (const r of rows) m.set(f(r), [...(m.get(f(r)) ?? []), r])
    return Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, block(v)]))
  }
  return { overall: block(rows), by_specification: group((r) => r.spec_key), by_company: group((r) => r.company) }
}
