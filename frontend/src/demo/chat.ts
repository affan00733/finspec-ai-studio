/**
 * Grounded question answering over the bundled corpus (port of backend/engine/chat.py, mock/extractive mode).
 * Answers are assembled only from evidence found in documents. If no evidence supports an answer the engine
 * says so explicitly instead of guessing.
 */
import { DEMO_DATASET } from '@/data/demo-dataset'
import type { ChatCitation, ChatRequest, ChatResponse } from '@/types'
import { getCorpus } from './corpus.ts'
import { DeterministicExtractor, REVENUE_FAMILY } from './extraction.ts'
import type { Candidate, ExtractionPolicy, SpecDef } from './engineTypes.ts'
import { tokenize } from './retrieval.ts'

export function detectYears(text: string): number[] {
  const ys = [...text.matchAll(/(?<!\d)((?:19|20)\d{2})(?!\d)/g)].map((m) => Number(m[1]))
  for (const m of text.matchAll(/\bFY\s?'?(\d{2})\b/gi)) ys.push(2000 + Number(m[1]))
  return [...new Set(ys)]
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Specs whose alias (or name) is mentioned; longer overlapping mentions win. */
export function detectSpecs(question: string, specs: SpecDef[]): SpecDef[] {
  const spans: { start: number; end: number; spec: SpecDef }[] = []
  for (const s of specs) {
    for (const term of new Set([s.name, ...s.aliases])) {
      const re = new RegExp('(?<![\\w-])' + escapeRe(term).replace(/ /g, '\\s+') + '(?![\\w-])', 'gi')
      for (const m of question.matchAll(re)) spans.push({ start: m.index!, end: m.index! + m[0].length, spec: s })
    }
  }
  const keep = spans.filter(
    (a) => !spans.some((b) => b !== a && b.start <= a.start && a.end <= b.end && b.end - b.start > a.end - a.start),
  )
  const seen = new Map<string, SpecDef>()
  for (const a of keep.sort((x, y) => x.start - y.start)) if (!seen.has(a.spec.key)) seen.set(a.spec.key, a.spec)
  return [...seen.values()]
}

export function fmtValue(c: Candidate): string {
  const unit = c.unit_label.toLowerCase().endsWith('co2e') ? 'tCO2e' : (c.currency ?? 'units')
  const n = c.normalized
  const norm = Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
  return `${c.raw_number} ${c.unit_label} (= ${norm} ${unit})`
}

const GENERIC = new Set(
  'what whats which who whom whose when where how why did does do was were is are the a an of in for to and or about tell me show give please report reported annual company fiscal year fy say said'.split(' '),
)

export interface ChatDeps {
  specs: SpecDef[]
  policy: ExtractionPolicy
}

export function inferScope(message: string, req: ChatRequest) {
  const low = message.toLowerCase()
  const docs = DEMO_DATASET.documents
  if (req.document_ids?.length) {
    return { type: 'explicit' as const, docs: docs.filter((d) => req.document_ids!.includes(d.id)), years: [] as number[], companies: [] as number[] }
  }
  const companies = DEMO_DATASET.companies
    .filter((c) => low.includes(c.name.toLowerCase()) || low.includes(c.name.split(' ')[0].toLowerCase()) || new RegExp('\\b' + c.ticker.toLowerCase() + '\\b').test(low))
    .map((c) => c.id)
  const years = detectYears(message)
  let scoped = docs
  if (companies.length) scoped = scoped.filter((d) => companies.includes(d.company_id))
  if (years.length) scoped = scoped.filter((d) => years.includes(d.fiscal_year))
  return { type: companies.length || years.length ? ('inferred' as const) : ('all' as const), docs: scoped, years, companies }
}

export function answerQuestion(req: ChatRequest, deps: ChatDeps): ChatResponse {
  const corpus = getCorpus()
  const message = req.message.trim()
  const scope = inferScope(message, req)
  const base: Omit<ChatResponse, 'answer' | 'grounded' | 'mode' | 'citations' | 'extractions'> = {
    provider: 'mock',
    model: 'mock-deterministic-1',
    warnings: [],
    scope: {
      type: scope.type,
      documents: scope.docs.map((d) => ({ id: d.id, title: d.title, company: d.company_name, fiscal_year: d.fiscal_year })),
    },
  }
  const insufficient = (why: string): ChatResponse => ({
    ...base,
    answer: `Insufficient evidence. ${why}`,
    grounded: false,
    mode: 'insufficient_evidence',
    citations: [],
    extractions: [],
  })
  if (!message) return insufficient('Ask a question about the indexed annual reports.')
  if (!scope.docs.length) {
    const yrs = scope.years.length ? `FY${scope.years.join(', FY')}` : 'the requested scope'
    return insufficient(`No indexed report covers ${yrs}. The corpus contains FY2022-FY2024 reports for Northstar Energy, Meridian Industrial, Cascade Retail and Atlas Materials.`)
  }
  const mentioned = detectSpecs(message, deps.specs)
  const extractor = new DeterministicExtractor(corpus.index, deps.policy, deps.specs)
  if (mentioned.length) {
    const lines: string[] = []
    const citations: ChatCitation[] = []
    const extractions: ChatResponse['extractions'] = []
    const byKey = new Map(deps.specs.map((s) => [s.key, s]))
    for (const doc of scope.docs.slice(0, 12)) {
      const ctx = corpus.contexts.get(doc.id)!
      for (const spec of mentioned) {
        const o = extractor.extract(spec, doc.id, ctx)
        const head = `${doc.company_name} FY${doc.fiscal_year} - ${spec.name}`
        const rec: ChatResponse['extractions'][number] = {
          document_id: doc.id,
          company: doc.company_name,
          fiscal_year: doc.fiscal_year,
          specification: spec.key,
          status: o.status,
          confidence: o.confidence,
        }
        const cite = (c: Candidate): ChatCitation => ({
          chunk_id: c.chunk_id,
          document_id: doc.id,
          quote: c.quote,
          start_char: c.start_char,
          end_char: c.end_char,
          company: doc.company_name,
          fiscal_year: doc.fiscal_year,
          label: spec.name,
        })
        if (o.status === 'found' && o.best) {
          const b = o.best
          lines.push(`- ${head}: ${fmtValue(b)}. Source: "${b.quote}" [chunk:${b.chunk_id}]`)
          citations.push(cite(b))
          rec.value = b.normalized
          rec.reported = `${b.raw_number} ${b.unit_label}`
        } else if (o.status === 'ambiguous') {
          lines.push(`- ${head}: conflicting values found in the document; not selecting one. ${o.rationale}`)
        } else {
          let extra = ''
          if (REVENUE_FAMILY.includes(spec.key)) {
            for (const k of REVENUE_FAMILY) {
              const other = byKey.get(k)
              if (!other || k === spec.key) continue
              const o2 = extractor.extract(other, doc.id, ctx)
              if (o2.status === 'found' && o2.best) {
                extra = ` This document reports '${other.name}' instead: ${fmtValue(o2.best)}. It is a different line item and was not substituted.`
                citations.push(cite(o2.best))
                break
              }
            }
          }
          lines.push(`- ${head}: not reported in this document.${extra}`)
        }
        extractions.push(rec)
      }
    }
    const grounded = citations.length > 0
    return {
      ...base,
      answer: 'Based on the indexed documents:\n' + lines.join('\n'),
      grounded,
      mode: 'extractive',
      citations,
      extractions,
      warnings: grounded ? [] : ['No citations: the requested metric was not reported in the matching documents.'],
    }
  }
  // Free-form question: retrieve, then answer only when excerpts genuinely overlap with the question.
  const entityTokens = new Set<string>([
    ...DEMO_DATASET.companies.flatMap((c) => [...tokenize(c.name), c.ticker.toLowerCase()]),
    ...scope.years.map(String),
  ])
  const contentTerms = [...new Set(tokenize(message))].filter((t) => !GENERIC.has(t) && !entityTokens.has(t) && !/^\d+$/.test(t))
  if (!contentTerms.length) return insufficient('The question does not name a metric or topic that the reports can be searched for.')
  const hits = corpus.index.search(message, { topK: 6, documentIds: scope.docs.map((d) => d.id), graphExpansion: false })
  const scored: { overlap: number; chunk: (typeof hits)[number]['chunk']; sentence: string; offset: number }[] = []
  for (const h of hits) {
    let cursor = 0
    for (const raw of h.chunk.text.split(/(?<=[.!?])\s+|\n/)) {
      const at = h.chunk.text.indexOf(raw, cursor)
      cursor = at >= 0 ? at + raw.length : cursor
      const s = raw.trim()
      if (s.length < 20) continue
      const toks = new Set(tokenize(s))
      const overlap = contentTerms.filter((t) => toks.has(t)).length
      if (overlap) scored.push({ overlap, chunk: h.chunk, sentence: s, offset: at >= 0 ? at + (raw.length - raw.trimStart().length) : 0 })
    }
  }
  scored.sort((a, b) => b.overlap - a.overlap)
  const need = Math.max(1, Math.ceil(contentTerms.length * 0.5))
  const top = scored.filter((s) => s.overlap >= need && (contentTerms.length === 1 || s.overlap >= 2)).slice(0, 3)
  if (!top.length) {
    return insufficient(
      `None of the retrieved excerpts address "${contentTerms.join(' ')}". Try naming a metric such as Revenue, EBITDA, CapEx or Scope 1 emissions.`,
    )
  }
  const citations: ChatCitation[] = top.map((t) => {
    const doc = DEMO_DATASET.documents.find((d) => d.id === t.chunk.document_id)!
    return {
      chunk_id: t.chunk.id,
      document_id: doc.id,
      quote: t.sentence,
      start_char: t.chunk.start_char + t.offset,
      end_char: t.chunk.start_char + t.offset + t.sentence.length,
      company: doc.company_name,
      fiscal_year: doc.fiscal_year,
    }
  })
  return {
    ...base,
    answer: top.map((t, i) => `${t.sentence} [chunk:${citations[i].chunk_id}]`).join(' '),
    grounded: true,
    mode: 'extractive',
    citations,
    extractions: [],
  }
}
