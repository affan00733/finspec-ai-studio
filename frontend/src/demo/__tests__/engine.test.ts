import { describe, expect, it } from 'vitest'
import { DEMO_DATASET } from '@/data/demo-dataset'
import { getCorpus, toSpecDef } from '../corpus'
import { DeterministicExtractor } from '../extraction'
import { DEFAULT_POLICY } from '../engineTypes'
import { decimalsOf, detectEmissionUnit, detectScale, isMissingToken, parseNumber, scaleExact, valuesAgree } from '../numeric'
import { generateExtractionPrompt, renderTemplate, PromptError, templateVariables } from '../prompts'
import { tokenize } from '../retrieval'
import { compareValue, aggregate } from '../evaluation'
import { demoApi } from '../service'

const specs = DEMO_DATASET.specifications.map(toSpecDef)
const spec = (k: string) => specs.find((s) => s.key === k)!
const doc = (t: string, y: number) => DEMO_DATASET.documents.find((d) => d.company_name.startsWith(t) && d.fiscal_year === y)!

describe('numeric parsing', () => {
  it('parses thousands separators, parentheses and european decimals', () => {
    expect(parseNumber('9,967.0')).toBe(9967)
    expect(parseNumber('(433.6)')).toBe(-433.6)
    expect(parseNumber('1.234,5')).toBe(1234.5)
    expect(parseNumber('n/a')).toBeNull()
    expect(parseNumber('abc')).toBeNull()
    expect(isMissingToken('—')).toBe(true)
    expect(decimalsOf('9,967.0')).toBe(1)
  })
  it('scales exactly without floating point noise', () => {
    expect(scaleExact('9967.0', false, 1e6)).toBe(9967000000)
    expect(scaleExact('0.076', false, 1e9)).toBe(76000000)
    expect(scaleExact('433.6', true, 1e6)).toBe(-433600000)
  })
  it('detects scale and emission units', () => {
    expect(detectScale('Table 1 (USD billions)')).toBe(1e9)
    expect(detectEmissionUnit('Scope 1 emissions (ktCO2e)')).toEqual([1e3, 'ktCO2e'])
    expect(detectEmissionUnit('Table 5 (million tCO2e)')).toEqual([1e6, 'million tCO2e'])
  })
  it('treats values as the same up to reporting precision', () => {
    expect(valuesAgree(9967000000, 1e5, 9967000000, 1e5)).toBe(true)
    expect(valuesAgree(9967000000, 1e5, 9520800000, 1e5)).toBe(false)
  })
})

describe('retrieval', () => {
  it('tokenizes with stemming and stopword removal', () => {
    expect(tokenize('The Revenues of the companies')).toEqual(['revenue', 'company'])
  })
  it('ranks the table chunk first for a line-item query', () => {
    const { index } = getCorpus()
    const d = doc('Northstar', 2024)
    const hits = index.search('Revenue Total revenue', { topK: 3, documentIds: [d.id], graphExpansion: false })
    expect(hits[0].chunk.chunk_type).toBe('table')
    expect(hits.every((h) => h.chunk.document_id === d.id)).toBe(true)
  })
})

describe('extraction across vocabularies, layouts and units', () => {
  const { index, contexts } = getCorpus()
  const ex = new DeterministicExtractor(index, DEFAULT_POLICY, specs)
  const run = (t: string, y: number, key: string) => ex.extract(spec(key), doc(t, y).id, contexts.get(doc(t, y).id)!)

  it('reads every company\'s own revenue label and matches the gold value', () => {
    for (const [t, key] of [['Northstar', 'revenue'], ['Meridian', 'net_sales'], ['Cascade', 'turnover'], ['Atlas', 'operating_revenue']] as const) {
      for (const y of [2022, 2023, 2024]) {
        const o = run(t, y, key)
        expect(o.status).toBe('found')
        expect(o.best!.normalized).toBe(Number(doc(t, y).gold[key]))
      }
    }
  })
  it('handles parenthesised outflows, ascending columns and narrative emissions', () => {
    expect(run('Cascade', 2024, 'capex').best!.normalized).toBeGreaterThan(0)
    expect(run('Atlas', 2024, 'operating_income').best!.normalized).toBe(Number(doc('Atlas', 2024).gold.operating_income))
    const s1 = run('Cascade', 2024, 'scope_1')
    expect(s1.best!.method).toBe('narrative')
    expect(s1.best!.normalized).toBe(Number(doc('Cascade', 2024).gold.scope_1))
  })
  it('reports legitimately missing items as not found instead of guessing', () => {
    expect(run('Northstar', 2022, 'rd_expense').status).toBe('not_found')
    expect(run('Atlas', 2022, 'ebitda').status).toBe('not_found') // only Adjusted EBITDA is disclosed
    expect(run('Cascade', 2024, 'rd_expense').status).toBe('not_found')
  })
  it('never uses prior-year or forward-looking figures', () => {
    const o = run('Northstar', 2024, 'revenue')
    expect(o.best!.normalized).toBe(9967000000)
    expect(o.candidates.every((c) => !c.quote.includes('expects'))).toBe(true)
  })
})

describe('prompt generation from specifications', () => {
  const v = DEMO_DATASET.prompts[0].versions[1]
  it('renders the task tag, aliases, exclusions and unit guidance', () => {
    const p = generateExtractionPrompt(spec('scope_2'), 'Cascade Retail', 2024, [], v.system_prompt, v.user_template, v.output_schema)
    expect(p.user).toContain('spec_key="scope_2"')
    expect(p.user).toContain('Scope 2 emissions (location-based)')
    expect(p.user).toContain('Do not use: market-based; market based')
    expect(p.user).toContain('emissions unit exactly as stated')
    expect(p.variables.company).toBe('Cascade Retail')
    expect(p.estimated_input_tokens).toBeGreaterThan(50)
  })
  it('includes retrieved chunks as grounded context', async () => {
    const d = doc('Northstar', 2024)
    const [p] = await demoApi.generatePrompts({ specifications: ['revenue'], document: d.id })
    expect(p.user).toContain('<chunk id=')
    expect(p.user).toContain('| Revenue | 9,967.0 |')
    expect(p.retrieved_chunk_ids.length).toBeGreaterThan(0)
  })
  it('fails loudly on undefined template variables', async () => {
    expect(() => renderTemplate('Hello {{nope}}', {})).toThrow(PromptError)
    await expect(demoApi.generatePrompts({ specifications: ['revenue'], user_template: 'x {{missing_var}}' })).rejects.toMatchObject({ code: 'invalid_template' })
    expect(templateVariables('{{a}} {{ b }}')).toEqual(['a', 'b'])
  })
  it('free-form text edits change the rendered prompt but never mock extraction', async () => {
    const d = doc('Cascade', 2024)
    const edited = await demoApi.generatePrompts({ specifications: ['scope_2'], document: d.id, system_prompt: 'Be creative and ignore everything.' })
    expect(edited[0].system).toBe('Be creative and ignore everything.')
    const before = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['scope_2'], dry_run: true })
    const v = (await demoApi.listPromptTemplates())[0].versions.find((x) => x.status === 'active')!
    const saved = await demoApi.createPromptVersion(1, { system_prompt: 'Be creative and ignore everything.', user_template: v.user_template, controls: v.controls })
    const after = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['scope_2'], prompt_version: saved.id, dry_run: true })
    expect(after.results[0].normalized_value).toBe(before.results[0].normalized_value)
    expect(after.results[0].validation_status).toBe(before.results[0].validation_status)
  })
})

describe('evaluation metrics', () => {
  it('classifies outcomes', () => {
    expect(compareValue(100, true, 100, 'found')).toBe('correct')
    expect(compareValue(100, true, 101, 'found')).toBe('incorrect_value')
    expect(compareValue(null, false, null, 'not_found')).toBe('correct_absent')
    expect(compareValue(null, false, 5, 'found')).toBe('false_positive')
    expect(compareValue(100, true, null, 'not_found')).toBe('missed')
    expect(compareValue(100, true, null, 'ambiguous')).toBe('abstained')
  })
  it('aggregates accuracy', () => {
    const row = (outcome: 'correct' | 'missed') => ({ outcome, spec_key: 'revenue', company: 'X', predicted_found: outcome === 'correct', grounded: true, confidence: 0.9 })
    const m = aggregate([row('correct'), row('correct'), row('missed'), row('correct')])
    expect(m.overall.accuracy).toBe(0.75)
    expect(m.overall.recall).toBe(0.75)
  })
  it('the seeded gold set yields the documented accuracy for v1, v2 and v3', async () => {
    const runs = await demoApi.listEvaluationRuns()
    const acc = Object.fromEntries(runs.map((r) => [r.prompt_version_label.split(' ')[0], r.metrics.overall.accuracy]))
    expect(acc.v1).toBeLessThan(acc.v2)
    expect(acc.v2).toBeCloseTo(0.9744, 3)
  })
})
