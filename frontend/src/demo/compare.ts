/** Compares two evaluation runs and applies the promotion gate. */
import type { CaseChange, EvaluationComparison, EvaluationRun } from '@/types'

export function buildComparison(baseline: EvaluationRun, candidate: EvaluationRun): EvaluationComparison {
  const candBy = new Map(candidate.results.map((r) => [r.case, r]))
  const changes: CaseChange[] = []
  const summary = { improved: 0, regressed: 0, unchanged_pass: 0, unchanged_fail: 0, changed_fail: 0 }
  for (const b of baseline.results) {
    const c = candBy.get(b.case)
    if (!c) continue
    let change: CaseChange['change']
    if (!b.passed && c.passed) change = 'improved'
    else if (b.passed && !c.passed) change = 'regressed'
    else if (b.passed && c.passed) change = 'unchanged_pass'
    else change = b.outcome === c.outcome && b.predicted_value === c.predicted_value ? 'unchanged_fail' : 'changed_fail'
    summary[change] += 1
    changes.push({
      document: b.document,
      company_name: b.company_name,
      fiscal_year: b.fiscal_year,
      specification_key: b.specification_key,
      pinned: b.pinned,
      incident: b.incident,
      expected_value: b.expected_value,
      baseline_outcome: b.outcome,
      candidate_outcome: c.outcome,
      baseline_value: b.predicted_value,
      candidate_value: c.predicted_value,
      change,
    })
  }
  const bo = baseline.metrics.overall
  const co = candidate.metrics.overall
  const pinnedRegress = changes.filter((c) => c.pinned && c.change === 'regressed')
  const dAcc = Math.round((co.accuracy - bo.accuracy) * 10000) / 10000
  const checks = [
    {
      id: 'pinned_regressions',
      label: 'No regressions on pinned historical incident cases',
      passed: pinnedRegress.length === 0,
      detail: pinnedRegress.length
        ? `${pinnedRegress.length} pinned case(s) regressed: ${pinnedRegress.map((c) => `${c.company_name.split(' ')[0]} FY${c.fiscal_year} ${c.specification_key}`).join(', ')}`
        : 'All pinned incident cases that passed on the baseline still pass.',
    },
    {
      id: 'accuracy',
      label: 'Overall accuracy does not drop',
      passed: dAcc >= 0,
      detail: `${(bo.accuracy * 100).toFixed(2)}% → ${(co.accuracy * 100).toFixed(2)}% (${dAcc >= 0 ? '+' : ''}${(dAcc * 100).toFixed(2)} pp)`,
    },
    {
      id: 'false_positives',
      label: 'No new false positives (value reported where none exists)',
      passed: co.false_positive <= bo.false_positive,
      detail: `${bo.false_positive} → ${co.false_positive} false positive(s)`,
    },
    {
      id: 'grounded',
      label: 'All returned values stay grounded in evidence',
      passed: (co.grounded_rate ?? 1) >= (bo.grounded_rate ?? 1),
      detail: `Grounded rate ${((bo.grounded_rate ?? 1) * 100).toFixed(1)}% → ${((co.grounded_rate ?? 1) * 100).toFixed(1)}%`,
    },
  ]
  return {
    baseline,
    candidate,
    changes,
    summary,
    deltas: {
      accuracy: dAcc,
      f1: Math.round((co.f1 - bo.f1) * 10000) / 10000,
      false_positive: co.false_positive - bo.false_positive,
      incorrect_value: co.incorrect_value - bo.incorrect_value,
      missed: co.missed - bo.missed,
    },
    gate: { passed: checks.every((c) => c.passed), checks },
  }
}
