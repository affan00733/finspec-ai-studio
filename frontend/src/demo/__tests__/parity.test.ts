import { describe, expect, it } from 'vitest'
import { DEMO_DATASET } from '@/data/demo-dataset'
import { getCorpus, toSpecDef } from '../corpus'
import { DeterministicExtractor } from '../extraction'
import { DEFAULT_POLICY } from '../engineTypes'

describe('extraction parity with the Python reference engine', () => {
  const corpus = getCorpus()
  const specs = DEMO_DATASET.specifications.map(toSpecDef)
  const ex = new DeterministicExtractor(corpus.index, DEFAULT_POLICY, specs)

  it('matches status, value and evidence quote for every document x specification', () => {
    let checked = 0
    const bad: string[] = []
    for (const ref of DEMO_DATASET.reference) {
      const spec = specs.find((s) => s.key === ref.spec_key)!
      const o = ex.extract(spec, ref.document_id, corpus.contexts.get(ref.document_id)!)
      checked++
      if (o.status !== ref.status) bad.push(`${ref.document_id}/${ref.spec_key}: status ${o.status} vs ${ref.status}`)
      else if (ref.status === 'found') {
        if (o.best!.normalized !== Number(ref.normalized)) bad.push(`${ref.document_id}/${ref.spec_key}: value ${o.best!.normalized} vs ${ref.normalized}`)
        if (o.best!.quote !== ref.quote) bad.push(`${ref.document_id}/${ref.spec_key}: quote`)
        if (o.best!.start_char !== ref.start_char) bad.push(`${ref.document_id}/${ref.spec_key}: start`)
        if (Math.abs(o.confidence - ref.confidence) > 0.0011) bad.push(`${ref.document_id}/${ref.spec_key}: conf ${o.confidence} vs ${ref.confidence}`)
      }
    }
    expect(bad).toEqual([])
    expect(checked).toBe(156)
  })
})
