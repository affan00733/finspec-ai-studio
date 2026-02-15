import { beforeEach, describe, expect, it } from 'vitest'
import { demoApi, __resetDemoForTests } from '../service'
import { DEMO_DATASET } from '@/data/demo-dataset'
import { STORAGE_KEY } from '../state'
import { ApiError } from '@/types'

const doc = (ticker: string, year: number) => {
  const c = DEMO_DATASET.companies.find((x) => x.ticker === ticker)!
  return DEMO_DATASET.documents.find((d) => d.company_id === c.id && d.fiscal_year === year)!
}

beforeEach(() => __resetDemoForTests())

describe('A) extraction with evidence', () => {
  it('extracts FY2024 Revenue for Northstar Energy with a grounded quote', async () => {
    const d = doc('NSTR', 2024)
    const { results } = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['revenue'] })
    const r = results[0]
    expect(r.status).toBe('found')
    expect(r.normalized_value).toBe(9967000000)
    expect(r.unit_label).toContain('millions')
    expect(r.currency).toBe('USD')
    expect(r.validation_status).toBe('pass')
    const ev = r.evidence[0]
    expect(d.raw_text.slice(ev.start_char, ev.end_char)).toBe(ev.quote)
    expect(ev.quote).toContain('9,967.0')
  })

  it('uses each company\'s own revenue vocabulary and reports others as not reported', async () => {
    const { results } = await demoApi.createRun({ document_ids: [doc('MRDN', 2023).id], specification_keys: ['revenue', 'net_sales'] })
    expect(results.find((r) => r.specification_key === 'revenue')!.status).toBe('not_found')
    expect(results.find((r) => r.specification_key === 'net_sales')!.status).toBe('found')
  })
})

describe('B) relationship retrieval', () => {
  it('graph expansion adds the adjacent note chunk next to the table', async () => {
    const d = doc('CSCD', 2024)
    const query = 'Purchase of property, plant and equipment'
    const plain = await demoApi.search({ query, document_ids: [d.id], top_k: 2, graph_expansion: false })
    const expanded = await demoApi.search({ query, document_ids: [d.id], top_k: 2, graph_expansion: true })
    expect(plain.hits.every((h) => h.via === 'direct')).toBe(true)
    const graphHits = expanded.hits.filter((h) => h.via === 'graph')
    expect(graphHits.length).toBeGreaterThan(0)
    expect(expanded.count).toBeGreaterThan(plain.count)
    expect(graphHits.some((h) => h.text.includes('shown as a cash outflow'))).toBe(true)
    expect(graphHits[0].relation).toBeTruthy()
  })
})

describe('C) candidate configuration changes extraction and validation', () => {
  it('disabling exclusions lets market-based Scope 2 compete with location-based', async () => {
    const d = doc('CSCD', 2024)
    const base = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['scope_2'] })
    const cand = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['scope_2'], controls: { applyExclusions: false } })
    expect(base.results[0].status).toBe('found')
    expect(base.results[0].validation_status).toBe('pass')
    expect(cand.results[0].status).toBe('ambiguous')
    expect(cand.results[0].validation_status).toBe('fail')
  })

  it('ignoring fiscal-year alignment reads the wrong column for ascending-year tables', async () => {
    const d = doc('ATLS', 2024)
    const base = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['operating_income'] })
    const cand = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['operating_income'], controls: { enforceFiscalYear: false } })
    expect(base.results[0].normalized_value).toBe(582000000)
    expect(cand.results[0].normalized_value).not.toBe(582000000)
    expect(cand.results[0].validations.find((v) => v.rule === 'fiscal_year_alignment')!.passed).toBe(false)
  })

  it('ignoring unit scale produces implausible magnitudes flagged by validation', async () => {
    const { results } = await demoApi.createRun({ document_ids: [doc('NSTR', 2024).id], specification_keys: ['revenue'], controls: { applyUnitScale: false } })
    expect(results[0].normalized_value).toBe(9967)
    expect(results[0].validation_status).toBe('warn')
  })
})

describe('D) review queue', () => {
  it('queues low-confidence/failed results, records a correction and shows it in history', async () => {
    const queue = await demoApi.reviewQueue()
    expect(queue.length).toBeGreaterThan(0)
    const item = queue[0]
    expect(item.queue_reasons!.length).toBeGreaterThan(0)
    const doc0 = DEMO_DATASET.documents.find((d) => d.id === item.document)!
    const quote = item.evidence[0].quote
    const res = await demoApi.submitReview({ result: item.id, decision: 'correct', corrected_value: 123456789, corrected_unit: 'USD', evidence_quote: quote, comment: 'Analyst override' })
    expect(res.result.review_status).toBe('corrected')
    expect(res.result.final_value).toBe(123456789)
    expect(doc0.raw_text).toContain(quote)
    const after = await demoApi.reviewQueue()
    expect(after.find((r) => r.id === item.id)).toBeUndefined()
    const history = await demoApi.listReviews()
    expect(history[0].decision).toBe('correct')
    expect(history[0].corrected_value).toBe(123456789)
    const audit = await demoApi.listAudit({ action_prefix: 'review.' })
    expect(audit[0].action).toBe('review.correct')
  })

  it('rejects corrections whose evidence quote is not in the document', async () => {
    const queue = await demoApi.reviewQueue()
    await expect(
      demoApi.submitReview({ result: queue[0].id, decision: 'correct', corrected_value: 1, evidence_quote: 'this sentence is not in any report' }),
    ).rejects.toMatchObject({ code: 'evidence_not_found' })
  })

  it('persists reviews to localStorage', async () => {
    const queue = await demoApi.reviewQueue()
    await demoApi.submitReview({ result: queue[0].id, decision: 'reject', comment: 'wrong measure' })
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)!)
    expect(saved.reviews).toHaveLength(1)
  })
})

describe('E) historical replay blocks a regressing candidate', () => {
  it('v3 improves some pinned cases, regresses others and is blocked from promotion', async () => {
    const templates = await demoApi.listPromptTemplates()
    const versions = templates.find((t) => t.kind === 'extraction')!.versions
    const active = versions.find((v) => v.status === 'active')!
    const cand = versions.find((v) => v.status === 'candidate')!
    const b = await demoApi.runEvaluation({ dataset: 1, prompt_version: active.id })
    const c = await demoApi.runEvaluation({ dataset: 1, prompt_version: cand.id })
    const cmp = await demoApi.compareEvaluations(b.id, c.id)
    expect(cmp.summary.improved).toBeGreaterThanOrEqual(1)
    expect(cmp.summary.regressed).toBeGreaterThanOrEqual(1)
    expect(cmp.deltas.accuracy).toBeGreaterThan(0)
    expect(cmp.changes.filter((x) => x.change === 'regressed').every((x) => x.pinned)).toBe(true)
    expect(cmp.gate.passed).toBe(false)
    expect(cmp.gate.checks.find((x) => x.id === 'pinned_regressions')!.passed).toBe(false)
    await expect(demoApi.activatePromptVersion(cand.id)).rejects.toMatchObject({ code: 'promotion_blocked' })
    const after = (await demoApi.listPromptTemplates()).find((t) => t.kind === 'extraction')!
    expect(after.versions.find((v) => v.id === cand.id)!.status).toBe('candidate')
  })

  it('a fixed candidate (exclusions restored) passes the gate and can be promoted', async () => {
    const tpl = (await demoApi.listPromptTemplates()).find((t) => t.kind === 'extraction')!
    const cand = tpl.versions.find((v) => v.status === 'candidate')!
    const fixed = await demoApi.createPromptVersion(tpl.id, {
      system_prompt: cand.system_prompt,
      user_template: cand.user_template,
      controls: { ...cand.controls, applyExclusions: true },
      label: 'v4 · fixed candidate',
    })
    const promoted = await demoApi.activatePromptVersion(fixed.id)
    expect(promoted.status).toBe('active')
    const after = (await demoApi.listPromptTemplates()).find((t) => t.kind === 'extraction')!
    expect(after.versions.filter((v) => v.status === 'active')).toHaveLength(1)
  })
})

describe('F) chat', () => {
  it('answers with citations whose offsets point into the document', async () => {
    const res = await demoApi.chat({ message: 'What was Northstar Energy revenue in FY2024?' })
    expect(res.grounded).toBe(true)
    expect(res.answer).toContain('9,967.0')
    expect(res.citations.length).toBeGreaterThan(0)
    const c = res.citations[0]
    const d = DEMO_DATASET.documents.find((x) => x.id === c.document_id)!
    expect(d.raw_text.slice(c.start_char, c.end_char)).toBe(c.quote)
  })

  it('says "insufficient evidence" for unsupported questions', async () => {
    const ceo = await demoApi.chat({ message: 'Who is the CEO of Northstar Energy?' })
    expect(ceo.grounded).toBe(false)
    expect(ceo.answer).toMatch(/insufficient evidence/i)
    expect(ceo.citations).toHaveLength(0)
    const future = await demoApi.chat({ message: 'What was Northstar Energy revenue in FY2030?' })
    expect(future.answer).toMatch(/insufficient evidence/i)
  })

  it('does not substitute Net sales for Revenue', async () => {
    const res = await demoApi.chat({ message: 'Meridian Industrial revenue FY2023' })
    expect(res.answer).toMatch(/not reported/i)
    expect(res.answer).toMatch(/Net sales/i)
  })
})

describe('G) offline operation and reset', () => {
  it('never touches the network', async () => {
    const original = globalThis.fetch
    let called = 0
    globalThis.fetch = (() => {
      called++
      throw new Error('network disabled')
    }) as typeof fetch
    try {
      await demoApi.createRun({ document_ids: [1], specification_keys: ['revenue'] })
      await demoApi.chat({ message: 'Atlas Materials operating revenue 2024' })
      await demoApi.runEvaluation({ dataset: 1, prompt_version: 2 })
    } finally {
      globalThis.fetch = original
    }
    expect(called).toBe(0)
  })

  it('paid providers are unavailable and fail loudly (no silent mock fallback)', async () => {
    await expect(demoApi.createRun({ agent: 3, document_ids: [1], specification_keys: ['revenue'] })).rejects.toBeInstanceOf(ApiError)
  })

  it('reset restores the seeded state', async () => {
    const q = await demoApi.reviewQueue()
    await demoApi.submitReview({ result: q[0].id, decision: 'reject' })
    await demoApi.createRun({ document_ids: [1], specification_keys: ['revenue'] })
    expect((await demoApi.listRuns()).length).toBe(2)
    await demoApi.resetDemo()
    expect((await demoApi.listRuns()).length).toBe(1)
    expect(await demoApi.listReviews()).toHaveLength(0)
    expect((await demoApi.reviewQueue()).length).toBe(q.length)
    const audit = await demoApi.listAudit()
    expect(audit[0].action).toBe('demo.reset')
  })
})
