/**
 * Deterministic, evidence-grounded extraction from document text.
 * Port of backend/engine/extraction.py. Values are only ever read out of the text of retrieved chunks; if a
 * line item is absent, reported as unavailable, or contradictory, the outcome says so.
 *
 * `ExtractionPolicy` flags (structured prompt controls) switch individual guardrails on or off, which is what
 * makes candidate configurations behave measurably differently in the demo.
 */
import {
  CURRENCY_SYMBOLS,
  SCALE_WORDS,
  decimalsOf,
  detectCurrency,
  detectEmissionUnit,
  detectScale,
  isMissingToken,
  matchAmountAt,
  parseNumber,
  parseNumberDetailed,
  scaleExact,
  scaleLabel,
  valuesAgree,
} from './numeric.ts'
import type { Candidate, ChunkRef, DocContext, ExtractionOutcome, ExtractionPolicy, SpecDef } from './engineTypes.ts'
import { DEFAULT_POLICY } from './engineTypes.ts'
import type { RetrievalIndex } from './retrieval.ts'

const YEAR_IN_CELL = /(?<!\d)(?<!\d[,.])((?:19|20)\d{2})(?!\d)(?!,\d)(?!\.\d)/g
const YEAR_FULL = /^(?:19|20)\d{2}$/

export const ALLOWED_PRECEDING = new Set(
  `the our its their total consolidated reported group company and or while with that as in for of
    fiscal year annual whereas but by from to at on against versus vs than was were is are had has have which
    because full-year full group's company's reported`
    .split(/\s+/)
    .filter(Boolean),
)

const CONNECTOR_SRC =
  '(?:\\s+(?:in|for|during)\\s+(?:fiscal\\s+(?:year\\s+)?|FY\\s?|the\\s+year\\s+(?:ended\\s+)?)?(?:19|20)\\d{2})?' +
  '\\s*,?\\s*' +
  '(?:(?:increased|decreased|rose|fell|grew|declined|climbed|dropped)\\s+(?:by\\s+(?:approximately\\s+)?)?(?:\\d[\\d.,]*\\s?%\\s+)?)?' +
  '(?:was|were|of|totaled|totalled|reached|amounted\\s+to|came\\s+to|to|stood\\s+at|is|are|:|-|–|—)\\s*' +
  '(?:approximately\\s+|about\\s+|around\\s+)?'

const UNIT_PAREN =
  /\((?:[^)]*?(?:usd|eur|gbp|million|thousand|billion|tco2|ktco2|mtco2|\bco2|%|\$|€|£|\bm\b|\bbn\b)[^)]*?)\)/gi

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// ---------------------------------------------------------------------------- table helpers

const NUMCELL = /^\(?[-−]?[$€£¥]?\s?[\d][\d,.\s]*\)?%?[*¹²³†‡]?$/
const YEARCELL = /^(?:FY|Fiscal\s*)?\s?(?:19|20)\d{2}$/i
const MISSING = new Set(['n/a', 'na', 'nm', '-', '–', '—', 'nil', 'n.a.'])

export function splitCells(line: string): string[] {
  let s = line.trim()
  if (s.includes('|')) {
    s = s.replace(/^\|+|\|+$/g, '')
    return s.split('|').map((c) => c.trim())
  }
  return s
    .split(/\t+|\s{2,}/)
    .map((c) => c.trim())
    .filter(Boolean)
}

export function isTableLine(line: string): boolean {
  const s = line.trim()
  if (!s) return false
  if ((s.match(/\|/g) ?? []).length >= 2) return true
  const cells = splitCells(s)
  if (cells.length < 2) return false
  const numeric = cells.slice(1).filter((c) => NUMCELL.test(c) || YEARCELL.test(c) || MISSING.has(c.toLowerCase())).length
  return numeric >= 1 && s.length < 220 && numeric >= cells.length - 2
}

export function normalizeLabel(label: string): string {
  let s = label.toLowerCase().replace(/&/g, ' and ')
  s = s.replace(/\((?:note|notes)\s*[\w.,\s-]*\)/g, '')
  s = s.replace(UNIT_PAREN, '')
  s = s.replace(/\(\d\)/g, '')
  s = s.replace(/[¹²³⁴⁵⁶⁷⁸⁹*†‡:]+/g, '')
  s = s.replace(/\s+/g, ' ').trim()
  return s.replace(/^[\s\-–—.,]+|[\s\-–—.,]+$/g, '')
}

export class SpecMatcher {
  aliases: Set<string>
  aliasRe: RegExp
  excludes: string[]
  spec: SpecDef
  constructor(spec: SpecDef, applyExclusions: boolean) {
    this.spec = spec
    this.aliases = new Set(spec.aliases.map(normalizeLabel))
    const alts = [...new Set(spec.aliases)].sort((a, b) => b.length - a.length)
    const pat = alts.map((a) => escapeRe(a).replace(/\\ /g, '\\s+').replace(/ /g, '\\s+')).join('|')
    this.aliasRe = new RegExp('(?<![\\w/-])(?:' + pat + ')(?![\\w-])', 'gi')
    this.excludes = applyExclusions ? spec.exclude_terms.map((e) => e.toLowerCase()) : []
  }
}

function sentenceStart(line: string, pos: number): number {
  let cut = 0
  const head = line.slice(0, pos)
  for (const sep of ['. ', '; ', '! ', '? ']) {
    const i = head.lastIndexOf(sep)
    if (i >= 0) cut = Math.max(cut, i + sep.length)
  }
  return cut
}

function sentenceEnd(line: string, pos: number): number {
  const m = /(?<=[a-zA-Z0-9%)])[.!?](?=\s|$)/.exec(line.slice(pos))
  return m ? pos + m.index + 1 : line.length
}

const yearsIn = (s: string): number[] => [...s.matchAll(YEAR_IN_CELL)].map((m) => Number(m[1]))

function rowIsData(cells: string[]): boolean {
  for (const c of cells.slice(1)) {
    if (YEAR_FULL.test(c.trim())) continue
    if (parseNumber(c) !== null) return true
  }
  return false
}

function parseHeader(cells: string[]): Map<number, number> | null {
  const years = new Map<number, number>()
  for (let j = 0; j < cells.length; j++) {
    const c = cells[j]
    const m = new RegExp(YEAR_IN_CELL.source).exec(c)
    if (m && !/\d{1,3},\d{3}/.test(c)) years.set(j, Number(m[1]))
    else if (j > 0 && parseNumber(c) !== null) return null
  }
  return years.size ? years : null
}

function pickColumn(headerCells: string[], years: Map<number, number>, rowCells: string[], target: number): number | null {
  const cols = [...years.entries()].filter(([, y]) => y === target).map(([j]) => j)
  if (!cols.length) return null
  const j = cols[0]
  if (headerCells.length === rowCells.length) return j
  const ordered = [...years.keys()].sort((a, b) => a - b)
  const valueIdx = rowCells.map((c, k) => (k > 0 && (parseNumber(c) !== null || isMissingToken(c)) ? k : -1)).filter((k) => k >= 0)
  const pos = ordered.indexOf(j)
  if (valueIdx.length === ordered.length) return valueIdx[pos]
  if (valueIdx.length > ordered.length && ordered[ordered.length - 1] === headerCells.length - 1)
    return valueIdx[valueIdx.length - ordered.length + pos]
  return null
}

// ---------------------------------------------------------------------------- unit resolution

type Inline = [string | null, number | null] | [number, string]

function resolveUnits(
  spec: SpecDef,
  rowText: string,
  preText: string,
  chunk: ChunkRef,
  ctx: DocContext,
  policy: ExtractionPolicy,
  inline: Inline | null = null,
): { currency: string | null; mult: number; label: string; source: string } {
  const sources: [string, string][] = [
    ['row', rowText],
    ['table_header', preText],
    ['caption', chunk.meta.caption ?? ''],
    ['heading', chunk.heading],
  ]
  if (!policy.applyUnitScale) {
    // Control disabled: the reader ignores stated units and takes the printed number at face value.
    return { currency: spec.unit_type === 'emissions' ? null : (detectCurrency(sources.map((s) => s[1]).join(' ')) ?? ctx.currency), mult: 1, label: 'units (scale ignored)', source: 'unknown' }
  }
  if (spec.unit_type === 'emissions') {
    if (inline) return { currency: null, mult: inline[0] as number, label: inline[1] as string, source: 'inline' }
    for (const [name, txt] of sources) {
      const em = detectEmissionUnit(txt, name === 'table_header')
      if (em) return { currency: null, mult: em[0], label: em[1], source: name }
    }
    if (ctx.emission_unit) return { currency: null, mult: ctx.emission_unit[0], label: ctx.emission_unit[1], source: 'document' }
    return { currency: null, mult: 1, label: 'tCO2e', source: 'unknown' }
  }
  let cur: string | null = null
  let scale: number | null = null
  let src = 'unknown'
  if (inline) {
    cur = inline[0] as string | null
    scale = inline[1] as number | null
    if (scale !== null) src = 'inline'
  }
  for (const [name, txt] of sources) {
    if (cur === null) cur = detectCurrency(txt)
    if (scale === null) {
      const sc = detectScale(txt, name === 'table_header')
      if (sc !== null) {
        scale = sc
        src = name
      }
    }
  }
  if (scale === null && ctx.scale !== null) {
    scale = ctx.scale
    src = 'document'
  }
  if (cur === null) cur = ctx.currency
  const mult = scale ?? 1
  return { currency: cur, mult, label: `${cur ?? ''} ${scaleLabel(mult)}`.trim(), source: src }
}

// ---------------------------------------------------------------------------- scanning

export interface ScanResult {
  candidates: Candidate[]
  missing: string[]
}

export function scanChunk(
  chunk: ChunkRef,
  matcher: SpecMatcher,
  ctx: DocContext,
  year: number | null,
  policy: ExtractionPolicy,
): ScanResult {
  const res: ScanResult = { candidates: [], missing: [] }
  const lines = chunk.text.split('\n')
  let headerCells: string[] | null = null
  let headerYears: Map<number, number> | null = null
  for (const hl of chunk.meta.table_header_lines ?? []) {
    const hc = splitCells(hl)
    const hy = parseHeader(hc)
    if (hy) {
      headerCells = hc
      headerYears = hy
    }
  }
  const nonData: string[] = []
  if (chunk.meta.caption) nonData.push(chunk.meta.caption)
  let pos = 0
  for (const line of lines) {
    const lineOff = pos
    pos += line.length + 1
    const s = line.trim()
    if (!s) continue
    if (isTableLine(line)) {
      const cells = splitCells(line)
      if (/^[|\-:+=\s]+$/.test(s)) continue
      const hy = cells.length ? parseHeader(cells) : null
      if (hy && !rowIsData(cells)) {
        headerCells = cells
        headerYears = hy
        nonData.push(s)
        continue
      }
      if (!rowIsData(cells) && !cells.slice(1).some((c) => isMissingToken(c) && c)) {
        nonData.push(s)
        continue
      }
      scanTableRow(chunk, matcher, ctx, year, line, lineOff, cells, headerCells, headerYears, nonData.join('\n'), res, policy)
    } else {
      nonData.push(s)
      scanNarrativeLine(chunk, matcher, ctx, year, line, lineOff, nonData.slice(-6).join('\n'), res, policy)
    }
  }
  return res
}

function scanTableRow(
  chunk: ChunkRef,
  matcher: SpecMatcher,
  ctx: DocContext,
  year: number | null,
  line: string,
  lineOff: number,
  cells: string[],
  headerCells: string[] | null,
  headerYears: Map<number, number> | null,
  preText: string,
  res: ScanResult,
  policy: ExtractionPolicy,
): void {
  const spec = matcher.spec
  const labelRaw = cells[0]
  if (!matcher.aliases.has(normalizeLabel(labelRaw))) return
  if (matcher.excludes.some((e) => labelRaw.toLowerCase().includes(e))) return
  const notes: string[] = []
  let col: number | null
  let yearMatched: boolean | null = null
  let score = 0.95
  if (headerCells && headerYears && year !== null) {
    col = pickColumn(headerCells, headerYears, cells, year)
    if (col === null) return // other years only, or ambiguous alignment: never guess
    yearMatched = true
  } else {
    const valueIdx = cells.map((c, k) => (k > 0 && (parseNumber(c) !== null || isMissingToken(c)) ? k : -1)).filter((k) => k >= 0)
    if (!valueIdx.length) return
    col = valueIdx[0]
    score = 0.5
    notes.push('no_year_header:assumed_first_value_column')
  }
  const cell = cells[col].trim()
  if (isMissingToken(cell)) {
    res.missing.push(`'${labelRaw.trim()}' is reported as '${cell || 'blank'}' for ${year}`)
    return
  }
  if (cell.includes('%')) return
  const parsed = parseNumberDetailed(cell)
  if (!parsed) return
  let value = parsed.value
  let negative = parsed.negative
  const rowText = cells.filter((_, k) => k !== col).join(' ')
  if (spec.sign_policy === 'absolute' && value < 0) {
    value = Math.abs(value)
    negative = false
    notes.push('sign_normalized:outflow_shown_negative')
  }
  const u = resolveUnits(spec, rowText, preText, chunk, ctx, policy)
  const dec = decimalsOf(cell)
  const gran = 10 ** -dec * u.mult
  const stripped = line.trim()
  const start = chunk.start_char + lineOff + (line.length - line.trimStart().length)
  let headerCtx = headerCells ? headerCells.join(' | ') : ''
  if (chunk.meta.caption) headerCtx = `${chunk.meta.caption} :: ${headerCtx}`.replace(/^[\s:]+|[\s:]+$/g, '')
  res.candidates.push({
    spec_key: spec.key,
    method: 'table',
    label: labelRaw.trim(),
    raw_number: cell,
    value,
    scale: u.mult,
    currency: u.currency,
    unit_label: u.label,
    normalized: scaleExact(parsed.digits, negative, u.mult),
    granularity: gran,
    chunk_id: chunk.id,
    document_id: chunk.document_id,
    quote: stripped,
    start_char: start,
    end_char: start + stripped.length,
    score,
    year,
    year_matched: yearMatched,
    unit_source: u.source,
    notes,
    role: 'primary',
    context: headerCtx,
  })
}

const FORWARD_LOOKING = /\b(expect|guid|forecast|outlook|target|anticipate|plan to|projected)\w*/i
const EM_TAIL = /^\s*(?:[kMG]?t\s?CO\s?[2₂]|(?:metric\s+)?(?:tonnes?|tons?)\b)/i
const EM_TAIL_FULL =
  /^\s*(?:[kMG]?t\s?CO\s?[2₂]\s?-?e(?:q)?|(?:metric\s+)?(?:tonnes?|tons?)(?:\s+of)?\s+CO\s?[2₂]\s?-?e(?:q|quivalent)?|(?:metric\s+)?(?:tonnes?|tons?))/i

function scanNarrativeLine(
  chunk: ChunkRef,
  matcher: SpecMatcher,
  ctx: DocContext,
  year: number | null,
  line: string,
  lineOff: number,
  preText: string,
  res: ScanResult,
  policy: ExtractionPolicy,
): void {
  const spec = matcher.spec
  matcher.aliasRe.lastIndex = 0
  for (const m of line.matchAll(matcher.aliasRe)) {
    const mStart = m.index!
    const pre = line.slice(0, mStart)
    const wm = /([A-Za-z][A-Za-z'’-]*)\s+$/.exec(pre)
    if (policy.strictLineItemContext && wm && !ALLOWED_PRECEDING.has(wm[1].toLowerCase())) continue
    let pos = mStart + m[0].length
    let paren = /^\s*\(([^)]{0,40})\)/.exec(line.slice(pos))
    if (paren) {
      const ptxt = paren[1].toLowerCase()
      if (matcher.excludes.some((e) => ptxt.includes(e))) continue
      if (/\d/.test(ptxt) && !/scope|location/.test(ptxt)) paren = null
      if (paren) pos += paren[0].length
    }
    const cre = new RegExp(CONNECTOR_SRC, 'iy')
    cre.lastIndex = pos
    const cm = cre.exec(line)
    if (!cm) continue
    const am = matchAmountAt(line, pos + cm[0].length)
    if (!am) continue
    if (am.groups!.pct) continue
    const rawNum = am.groups!.num
    const parsed = parseNumberDetailed(rawNum)
    if (!parsed) continue
    let value = parsed.value
    let negative = parsed.negative
    const curTok = am.groups!.cur
    const scaleTok = am.groups!.scale
    let inline: Inline | null = null
    let end = am.index + am[0].length
    if (spec.unit_type === 'emissions') {
      const tail = line.slice(end, end + 40)
      if (!EM_TAIL.test(tail)) continue
      const em = detectEmissionUnit(tail.replace(/₂/g, '2'))
      if (!em) continue
      let amtScale = 1
      if (scaleTok && ['thousand', 'million', 'billion', 'k', 'mn', 'bn'].includes(scaleTok.toLowerCase()))
        amtScale = SCALE_WORDS[scaleTok.toLowerCase()]
      const mult = amtScale * em[0]
      const ulabel = amtScale === 1 ? em[1] : `${scaleLabel(amtScale)} ${em[1]}`
      inline = [mult, ulabel]
      const tm = EM_TAIL_FULL.exec(tail)
      end = end + (tm ? tm[0].length : 0)
    } else {
      let sl = scaleTok ? scaleTok.toLowerCase() : null
      if ((sl === 'm' || sl === 'k') && !curTok) sl = null
      if (!curTok && !sl) continue
      const cur = (curTok && CURRENCY_SYMBOLS[curTok]) || (curTok ? curTok.toUpperCase() : null)
      inline = [cur, sl ? (SCALE_WORDS[sl] ?? null) : null]
    }
    const sentStart = sentenceStart(line, mStart)
    const span = line.slice(sentStart, end)
    const yrs = yearsIn(span)
    let yearMatched: boolean | null = null
    let score = 0.72
    const notes: string[] = []
    if (year !== null && yrs.length) {
      if (yrs.includes(year)) {
        yearMatched = true
        score = 0.8
      } else continue // sentence is about a different period
    } else notes.push('no_year_in_sentence')
    const sentEnd = sentenceEnd(line, end)
    const rawQuote = line.slice(sentStart, sentEnd)
    const quote = rawQuote.trim()
    const qOff = sentStart + (rawQuote.length - rawQuote.trimStart().length)
    const start = chunk.start_char + lineOff + qOff
    if (FORWARD_LOOKING.test(quote) && !yearMatched) continue
    if (spec.sign_policy === 'absolute' && value < 0) {
      value = Math.abs(value)
      negative = false
      notes.push('sign_normalized')
    }
    const u = resolveUnits(spec, '', preText, chunk, ctx, policy, inline)
    const dec = decimalsOf(rawNum)
    res.candidates.push({
      spec_key: spec.key,
      method: 'narrative',
      label: m[0],
      raw_number: rawNum.trim(),
      value,
      scale: u.mult,
      currency: u.currency,
      unit_label: u.label,
      normalized: scaleExact(parsed.digits, negative, u.mult),
      granularity: 10 ** -dec * u.mult,
      chunk_id: chunk.id,
      document_id: chunk.document_id,
      quote,
      start_char: start,
      end_char: start + quote.length,
      score,
      year,
      year_matched: yearMatched,
      unit_source: u.source,
      notes,
      role: 'primary',
      context: chunk.heading,
    })
  }
}

// ---------------------------------------------------------------------------- selection

export function selectOutcome(
  spec: SpecDef,
  candsIn: Candidate[],
  missing: string[],
  year: number | null,
  retrievedIds: number[],
): ExtractionOutcome {
  const uniq = new Map<string, Candidate>()
  for (const c of candsIn) {
    const key = `${c.document_id}:${c.start_char}:${c.end_char}`
    const prev = uniq.get(key)
    if (!prev || c.score > prev.score) uniq.set(key, c)
  }
  const cands = [...uniq.values()].sort((a, b) => b.score - a.score || a.start_char - b.start_char)
  const out: ExtractionOutcome = {
    spec_key: spec.key,
    status: 'not_found',
    fiscal_year: year,
    best: null,
    candidates: [],
    confidence: 0,
    rationale: '',
    retrieved_chunk_ids: [...retrievedIds],
    warnings: [],
  }
  if (!cands.length) {
    out.rationale = missing.length
      ? 'Line item present but no value reported: ' + missing.slice(0, 2).join('; ')
      : `No line item matching ${JSON.stringify(spec.aliases.slice(0, 4))} with a value for fiscal year ${year} found in ${retrievedIds.length} retrieved chunks.`
    return out
  }
  const best = cands[0]
  const agree = [best]
  const conflicts: Candidate[] = []
  for (const c of cands.slice(1)) {
    if (valuesAgree(best.normalized, best.granularity, c.normalized, c.granularity)) agree.push(c)
    else conflicts.push(c)
  }
  const near = conflicts.filter((c) => c.score >= best.score - 0.1)
  for (const c of agree.slice(1)) c.role = 'supporting'
  for (const c of conflicts) c.role = 'conflicting'
  out.candidates = [...agree, ...conflicts]
  if (near.length) {
    out.status = 'ambiguous'
    const vals = [...new Set([best, ...near].map((c) => `${c.raw_number} ${c.unit_label}`))].sort()
    out.rationale = `Conflicting values of comparable reliability found (${vals.join('; ')}); no value selected - analyst review required.`
    return out
  }
  out.status = 'found'
  out.best = best
  let conf = best.score + 0.03 * (agree.length - 1)
  if (best.unit_source === 'unknown') {
    conf -= 0.1
    out.warnings.push('unit_not_stated')
  }
  if (conflicts.length) {
    conf -= 0.05
    out.warnings.push('lower_reliability_conflicting_evidence')
  }
  out.confidence = Math.round(Math.max(0.05, Math.min(conf, 0.99)) * 1000) / 1000
  const basis = best.method === 'table' ? 'table row' : 'narrative sentence'
  out.rationale =
    `Matched '${best.label}' in a ${basis}` +
    (best.method === 'table' && best.year_matched ? ` under the ${year} column` : '') +
    `; ${agree.length} agreeing source(s).` +
    (conflicts.length ? ` ${conflicts.length} lower-reliability conflicting source(s) noted.` : '')
  return out
}

// ---------------------------------------------------------------------------- extractor

export const REVENUE_FAMILY = ['revenue', 'net_sales', 'turnover', 'operating_revenue']

export class DeterministicExtractor {
  index: RetrievalIndex
  policy: ExtractionPolicy
  allSpecs: SpecDef[]
  constructor(index: RetrievalIndex, policy: ExtractionPolicy = DEFAULT_POLICY, allSpecs: SpecDef[] = []) {
    this.index = index
    this.policy = policy
    this.allSpecs = allSpecs
  }

  retrieve(spec: SpecDef, documentId: number) {
    const query = `${spec.name} ${spec.aliases.join(' ')}`
    return this.index.search(query, {
      topK: this.policy.topK,
      mode: this.policy.retrievalMode,
      graphExpansion: this.policy.graphExpansion,
      extraPhrases: spec.aliases,
      documentIds: [documentId],
    })
  }

  private run(spec: SpecDef, documentId: number, ctx: DocContext, year: number | null): ExtractionOutcome {
    const hits = this.retrieve(spec, documentId)
    const matcher = new SpecMatcher(spec, this.policy.applyExclusions)
    const cands: Candidate[] = []
    const missing: string[] = []
    // With fiscal-year enforcement off the reader no longer knows which period it is after.
    const scanYear = this.policy.enforceFiscalYear ? year : null
    for (const h of hits) {
      const r = scanChunk(h.chunk, matcher, ctx, scanYear, this.policy)
      cands.push(...r.candidates)
      missing.push(...r.missing)
    }
    return selectOutcome(spec, cands, missing, year, hits.map((h) => h.chunk.id))
  }

  extract(spec: SpecDef, documentId: number, ctx: DocContext, targetYear: number | null = null): ExtractionOutcome {
    const year = targetYear ?? ctx.fiscal_year
    const out = this.run(spec, documentId, ctx, year)
    if (out.status === 'not_found' && this.policy.revenueFamilyFallback && REVENUE_FAMILY.includes(spec.key)) {
      for (const sibling of this.allSpecs) {
        if (sibling.key === spec.key || !REVENUE_FAMILY.includes(sibling.key)) continue
        const alt = this.run(sibling, documentId, ctx, year)
        if (alt.status === 'found' && alt.best) {
          const best: Candidate = { ...alt.best, spec_key: spec.key, notes: [...alt.best.notes, `family_fallback:${sibling.key}`] }
          return {
            ...alt,
            spec_key: spec.key,
            best,
            candidates: [best],
            confidence: Math.max(0.05, Math.round((alt.confidence - 0.1) * 1000) / 1000),
            warnings: [...alt.warnings, 'line_item_substituted'],
            rationale: `Relaxed line-item matching substituted '${sibling.name}' for '${spec.name}'. ${alt.rationale}`,
          }
        }
      }
    }
    return out
  }
}
