import type { ExtractionResult, Specification } from '@/types'

export function fmtNumber(n: number | null | undefined, digits = 2): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: digits })
}

const SYMBOL: Record<string, string> = { USD: '$', EUR: '€', GBP: '£' }

/** Normalized value with unit, e.g. "$9,967,000,000" or "4,109,200 tCO2e". */
export function fmtValue(n: number | null | undefined, opts: { currency?: string; unitType?: 'currency' | 'emissions' } = {}): string {
  if (n == null) return '—'
  if (opts.unitType === 'emissions') return `${n.toLocaleString('en-US', { maximumFractionDigits: 0 })} tCO2e`
  const sym = opts.currency ? SYMBOL[opts.currency] ?? `${opts.currency} ` : ''
  return `${n < 0 ? '-' : ''}${sym}${Math.abs(n).toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function fmtCompact(n: number | null | undefined, opts: { currency?: string; unitType?: 'currency' | 'emissions' } = {}): string {
  if (n == null) return '—'
  const abs = Math.abs(n)
  const [v, s] = abs >= 1e12 ? [1e12, 'T'] : abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : abs >= 1e3 ? [1e3, 'K'] : [1, '']
  const body = `${(n / v).toLocaleString('en-US', { maximumFractionDigits: 2 })}${s}`
  if (opts.unitType === 'emissions') return `${body} tCO2e`
  const sym = opts.currency ? SYMBOL[opts.currency] ?? `${opts.currency} ` : ''
  return `${sym}${body}`
}

export function resultValue(r: Pick<ExtractionResult, 'normalized_value' | 'currency'>, spec?: Pick<Specification, 'unit_type'>): string {
  return fmtValue(r.normalized_value, { currency: r.currency, unitType: spec?.unit_type })
}

export const pct = (x: number | null | undefined, digits = 1) => (x == null ? '—' : `${(x * 100).toFixed(digits)}%`)

export function fmtDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function shortCompany(name: string): string {
  return name.split(' ')[0]
}

export function snippet(text: string, max = 140): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}
