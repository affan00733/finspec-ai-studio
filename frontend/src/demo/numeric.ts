/**
 * Numeric, currency, scale and emission-unit parsing (TypeScript port of backend/engine/numeric.py).
 * Parsing is conservative: when a token cannot be interpreted with confidence, null is returned.
 */

export const CURRENCY_SYMBOLS: Record<string, string> = { $: 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY' }
export const CURRENCY_CODES = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'JPY', 'SEK', 'NOK', 'DKK', 'CNY', 'INR']
const CURRENCY_WORDS: Record<string, string> = {
  'us dollars': 'USD',
  'u.s. dollars': 'USD',
  dollars: 'USD',
  euros: 'EUR',
  euro: 'EUR',
  'pounds sterling': 'GBP',
  'british pounds': 'GBP',
  sterling: 'GBP',
}

export const SCALE_WORDS: Record<string, number> = {
  thousand: 1e3,
  thousands: 1e3,
  million: 1e6,
  millions: 1e6,
  billion: 1e9,
  billions: 1e9,
  trillion: 1e12,
  trillions: 1e12,
  k: 1e3,
  mn: 1e6,
  mm: 1e6,
  m: 1e6,
  bn: 1e9,
  tn: 1e12,
}
const SCALE_CANONICAL: Record<number, string> = {
  1: 'units',
  1e3: 'thousands',
  1e6: 'millions',
  1e9: 'billions',
  1e12: 'trillions',
}

const MISSING_TOKENS = new Set([
  '',
  '-',
  '–',
  '—',
  '−',
  'n/a',
  'na',
  'n.a.',
  'nm',
  'n.m.',
  'nil',
  'none',
  'not disclosed',
  'not reported',
  'not available',
  'tbd',
  '*',
  '..',
])

export function isMissingToken(token: string): boolean {
  return MISSING_TOKENS.has(token.trim().toLowerCase())
}

export interface ParsedNumber {
  /** numeric value (may be negative) */
  value: number
  /** canonical unsigned decimal string, e.g. "9967.0" */
  digits: string
  negative: boolean
}

/** Parse a numeric token such as `1,234.5`, `(1,234.5)` or `1.234,5`. */
export function parseNumberDetailed(raw: string | null | undefined): ParsedNumber | null {
  if (raw == null) return null
  let s = raw.trim()
  if (!s || isMissingToken(s)) return null
  s = s.replace(/\u2212/g, '-').replace(/\u00a0/g, ' ').replace(/\u202f/g, ' ')
  s = s.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰*†‡ ]+$/, '')
  let negative = false
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true
    s = s.slice(1, -1).trim()
  }
  s = s.replace(/^[$€£¥]\s*/, '')
  s = s.replace(/^(?:USD|EUR|GBP|CAD|AUD|CHF|JPY)\s*/, '')
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1).trim()
  }
  s = s.replace(/ /g, '')
  if (!s || !/^[\d,.]+$/.test(s)) return null
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.')
    else s = s.replace(/,/g, '')
  } else if (s.includes(',')) {
    if (/^\d{1,3}(,\d{3})+$/.test(s)) s = s.replace(/,/g, '')
    else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
    else return null
  } else if ((s.match(/\./g) ?? []).length > 1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
    else return null
  }
  const value = Number(s)
  if (!Number.isFinite(value)) return null
  return { value: negative ? -value : value, digits: s, negative }
}

export function parseNumber(raw: string | null | undefined): number | null {
  return parseNumberDetailed(raw)?.value ?? null
}

/** Number of decimal places in the textual representation of a number. */
export function decimalsOf(token: string): number {
  const t = token.trim().replace(/^\(|\)$/g, '').replace(/^-/, '')
  if (t.includes('.') && t.includes(',') && t.lastIndexOf(',') > t.lastIndexOf('.')) return t.length - t.lastIndexOf(',') - 1
  if (t.includes('.')) return t.length - t.lastIndexOf('.') - 1
  if (/^\d+,\d{1,2}$/.test(t)) return t.length - t.lastIndexOf(',') - 1
  return 0
}

/**
 * value * multiplier computed on the decimal string so results such as 9,967.0 * 1e6 are exact
 * (no 9966999999.999998 artefacts).
 */
export function scaleExact(digits: string, negative: boolean, multiplier: number): number {
  const [i, f = ''] = digits.split('.')
  let result: number
  try {
    const scaled = BigInt(i + f) * BigInt(Math.round(multiplier))
    const div = 10n ** BigInt(f.length)
    result = scaled % div === 0n ? Number(scaled / div) : Number(digits) * multiplier
  } catch {
    result = Number(digits) * multiplier
  }
  return negative ? -result : result
}

export function detectCurrency(text: string): string | null {
  if (!text) return null
  let best: { i: number; code: string } | null = null
  for (const [sym, code] of Object.entries(CURRENCY_SYMBOLS)) {
    const i = text.indexOf(sym)
    if (i >= 0 && (best === null || i < best.i)) best = { i, code }
  }
  const m = new RegExp('\\b(' + CURRENCY_CODES.join('|') + ')\\b').exec(text)
  if (m && (best === null || m.index < best.i)) best = { i: m.index, code: m[1] }
  const low = text.toLowerCase()
  for (const [word, code] of Object.entries(CURRENCY_WORDS)) {
    const i = low.indexOf(word)
    if (i >= 0 && (best === null || i < best.i)) best = { i, code }
  }
  return best ? best.code : null
}

const SCALE_RE =
  /(?<![A-Za-z])(thousands?|millions?|billions?|trillions?)(?![A-Za-z])|(?<![A-Za-z])(mn|bn|tn|mm)(?![A-Za-z])|(?:[$€£]|\b(?:USD|EUR|GBP|CAD|AUD|CHF|JPY))\s?(m|k|bn)\b/gi

export function detectScale(text: string, preferLast = false): number | null {
  if (!text) return null
  const matches = [...text.matchAll(SCALE_RE)]
  if (!matches.length) return null
  const m = preferLast ? matches[matches.length - 1] : matches[0]
  const word = (m[1] || m[2] || m[3]).toLowerCase()
  return SCALE_WORDS[word] ?? null
}

export function scaleLabel(scale: number | null | undefined): string {
  if (scale == null) return 'units'
  return SCALE_CANONICAL[scale] ?? `x${scale}`
}

const EMISSION_RE =
  /(?:(?<pre>thousand|million|billion)\s+)?(?:(?<sym>kt|Mt|Gt|t)\s?CO\s?2\s?-?e(?:q)?\b|(?:metric\s+)?(?:tonnes?|tons?)\s+(?:of\s+)?CO\s?2\s?-?e(?:q|quivalent)?\b)/gi
const PRE_MULT: Record<string, number> = { thousand: 1e3, million: 1e6, billion: 1e9 }

/** `[multiplier_to_tCO2e, label]` if an emissions unit is present. */
export function detectEmissionUnit(text: string, preferLast = false): [number, string] | null {
  if (!text) return null
  const t = text.replace(/\u2082/g, '2')
  const matches = [...t.matchAll(EMISSION_RE)]
  if (!matches.length) return null
  const m = preferLast ? matches[matches.length - 1] : matches[0]
  let mult = 1
  let label = 'tCO2e'
  const sym = m.groups?.sym
  if (sym) {
    // Python port: the symbol is matched case-insensitively and lower-cased, so "Mt" collapses to "mt".
    // "kt" -> kilotonnes, "mt" -> megatonnes, "gt" -> gigatonnes, "t" -> tonnes.
    const s = sym.toLowerCase()
    if (s === 'kt') [mult, label] = [1e3, 'ktCO2e']
    else if (s === 'mt') [mult, label] = [1e6, 'MtCO2e']
    else if (s === 'gt') [mult, label] = [1e9, 'GtCO2e']
  }
  const pre = m.groups?.pre
  if (pre) {
    mult *= PRE_MULT[pre.toLowerCase()]
    label = `${pre.toLowerCase()} ${label}`
  }
  return [mult, label]
}

export const AMOUNT_SRC =
  '(?<cur>USD|EUR|GBP|CAD|AUD|CHF|JPY|[$€£¥])?\\s?(?<num>\\(?-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?\\)?|\\(?-?\\d+(?:\\.\\d+)?\\)?)(?<pct>\\s?%)?(?:\\s?(?<scale>thousand|million|billion|trillion|mn|bn|mm|tn|m|k)\\b(?![\\w-]))?'

/** Sticky matcher emulating Python's `AMOUNT_RE.match(line, pos)`. */
export function matchAmountAt(line: string, pos: number): RegExpExecArray | null {
  const re = new RegExp(AMOUNT_SRC, 'iy')
  re.lastIndex = pos
  return re.exec(line)
}

/** Two normalized values agree up to reporting precision. */
export function valuesAgree(a: number, aGran: number, b: number, bGran: number): boolean {
  if (a === b) return true
  const diff = Math.abs(a - b)
  const tol = Math.max(aGran, bGran) / 2 + 1e-7
  if (diff <= tol) return true
  const base = Math.max(Math.abs(a), Math.abs(b))
  return base > 0 && diff / base < 0.0005
}

export function formatNumber(n: number | null | undefined, opts: { compact?: boolean; digits?: number } = {}): string {
  if (n == null || Number.isNaN(n)) return '—'
  if (opts.compact) {
    const abs = Math.abs(n)
    const units: [number, string][] = [
      [1e12, 'T'],
      [1e9, 'B'],
      [1e6, 'M'],
      [1e3, 'K'],
    ]
    for (const [v, s] of units) {
      if (abs >= v) return `${(n / v).toLocaleString('en-US', { maximumFractionDigits: opts.digits ?? 2 })}${s}`
    }
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: opts.digits ?? 4 })
}
