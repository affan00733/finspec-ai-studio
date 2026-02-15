/**
 * Offline hybrid retrieval: BM25 + lexical coverage fused with reciprocal-rank fusion, then expanded over
 * the chunk relationship graph. Fully deterministic; port of backend/engine/retrieval.py.
 */
import type { ChunkRef, RetrievalMode } from './engineTypes.ts'

const STOPWORDS = new Set(
  'a an and are as at be by for from has have in is it its of on or that the this to was were will with'.split(' '),
)
const TOKEN_RE = /[a-z0-9]+(?:[.&][a-z0-9]+)*/g

export function tokenize(text: string): string[] {
  const out: string[] = []
  for (const raw of text.toLowerCase().replace(/&/g, ' & ').match(TOKEN_RE) ?? []) {
    let t = raw.replace(/&/g, '')
    if (!t || STOPWORDS.has(t)) continue
    if (t.length > 4 && t.endsWith('ies')) t = t.slice(0, -3) + 'y'
    else if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1)
    out.push(t)
  }
  return out
}

export interface Edge {
  source: number
  target: number
  relation: string
  weight: number
}

export interface Hit {
  chunk: ChunkRef
  score: number
  rank: number
  via: 'direct' | 'graph'
  scores: { bm25?: number; lexical?: number; rrf: number }
  from_chunk_id: number | null
  relation: string | null
}

export interface SearchOptions {
  topK?: number
  mode?: RetrievalMode
  graphExpansion?: boolean
  expansionDecay?: number
  maxExpansion?: number
  extraPhrases?: string[]
  documentIds?: number[] | null
}

function counter(tokens: string[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const t of tokens) m.set(t, (m.get(t) ?? 0) + 1)
  return m
}

export class RetrievalIndex {
  static K1 = 1.5
  static B = 0.75
  static RRF_K = 60

  chunks: ChunkRef[]
  byId = new Map<number, ChunkRef>()
  adj = new Map<number, { target: number; relation: string; weight: number }[]>()
  private tf: Map<string, number>[] = []
  private len: number[] = []
  private phraseText: string[] = []
  private idf = new Map<string, number>()
  private n: number
  private avgdl: number

  constructor(chunks: ChunkRef[], edges: Edge[] = []) {
    this.chunks = chunks
    for (const c of chunks) this.byId.set(c.id, c)
    for (const e of edges) {
      if (this.byId.has(e.source) && this.byId.has(e.target)) {
        const list = this.adj.get(e.source) ?? []
        list.push({ target: e.target, relation: e.relation, weight: e.weight })
        this.adj.set(e.source, list)
      }
    }
    const df = new Map<string, number>()
    for (const c of chunks) {
      const heading = tokenize(c.heading)
      const caption = tokenize(c.meta.caption ?? '')
      const tf = counter([...tokenize(c.text), ...heading, ...heading, ...caption, ...caption])
      this.tf.push(tf)
      let total = 0
      for (const v of tf.values()) total += v
      this.len.push(total)
      this.phraseText.push(tokenize(c.text + ' ' + c.heading).join(' '))
      for (const k of tf.keys()) df.set(k, (df.get(k) ?? 0) + 1)
    }
    this.n = chunks.length
    this.avgdl = this.n ? this.len.reduce((a, b) => a + b, 0) / this.n : 0
    for (const [t, d] of df) this.idf.set(t, Math.log(1 + (this.n - d + 0.5) / (d + 0.5)))
  }

  private bm25(qTerms: string[]): number[] {
    const scores = new Array<number>(this.n).fill(0)
    const uniq = [...new Set(qTerms)]
    for (let i = 0; i < this.n; i++) {
      const tf = this.tf[i]
      const dl = this.len[i] || 1
      let s = 0
      for (const t of uniq) {
        const f = tf.get(t) ?? 0
        if (!f) continue
        const idf = this.idf.get(t) ?? 0
        s += (idf * (f * (RetrievalIndex.K1 + 1))) / (f + RetrievalIndex.K1 * (1 - RetrievalIndex.B + (RetrievalIndex.B * dl) / (this.avgdl || 1)))
      }
      scores[i] = s
    }
    return scores
  }

  private lexical(qTerms: string[], phrases: string[]): number[] {
    const uniq = [...new Set(qTerms)]
    const totalIdf = uniq.reduce((a, t) => a + (this.idf.get(t) ?? 0), 0) || 1
    const scores = new Array<number>(this.n).fill(0)
    for (let i = 0; i < this.n; i++) {
      const tf = this.tf[i]
      let covered = 0
      for (const t of uniq) if (tf.has(t)) covered += this.idf.get(t) ?? 0
      let s = covered / totalIdf
      const ptxt = this.phraseText[i]
      for (const ph of phrases) {
        if (ph && ptxt.includes(ph)) {
          s += 0.5
          break
        }
      }
      if (this.chunks[i].chunk_type === 'table' && s > 0) s += 0.05
      scores[i] = s
    }
    return scores
  }

  private static rank(scores: number[]): number[] {
    return scores
      .map((s, i) => [s, i] as const)
      .filter(([s]) => s > 0)
      .sort((a, b) => b[0] - a[0] || a[1] - b[1])
      .map(([, i]) => i)
  }

  search(query: string, opts: SearchOptions = {}): Hit[] {
    const { topK = 8, mode = 'hybrid', graphExpansion = true, expansionDecay = 0.5, extraPhrases = [], documentIds = null } = opts
    if (!this.chunks.length || !query.trim()) return []
    if (!['hybrid', 'bm25', 'lexical'].includes(mode)) throw new Error(`Unknown retrieval mode: ${mode}`)
    const allowed = documentIds ? new Set(documentIds) : null
    const qTerms = tokenize(query)
    const phrases = [query, ...extraPhrases].map((p) => tokenize(p).join(' ')).filter(Boolean)
    const bm = this.bm25(qTerms)
    const lx = this.lexical(qTerms, phrases)
    if (allowed) {
      this.chunks.forEach((c, i) => {
        if (!allowed.has(c.document_id)) {
          bm[i] = 0
          lx[i] = 0
        }
      })
    }
    const fused = new Map<number, number>()
    if (mode === 'hybrid' || mode === 'bm25')
      RetrievalIndex.rank(bm).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RetrievalIndex.RRF_K + r + 1)))
    if (mode === 'hybrid' || mode === 'lexical')
      RetrievalIndex.rank(lx).forEach((i, r) => fused.set(i, (fused.get(i) ?? 0) + 1 / (RetrievalIndex.RRF_K + r + 1)))
    const ordered = [...fused.keys()].sort((a, b) => fused.get(b)! - fused.get(a)! || a - b).slice(0, topK)
    const hits: Hit[] = ordered.map((i, r) => ({
      chunk: this.chunks[i],
      score: fused.get(i)!,
      rank: r + 1,
      via: 'direct',
      scores: { bm25: bm[i], lexical: lx[i], rrf: fused.get(i)! },
      from_chunk_id: null,
      relation: null,
    }))
    if (graphExpansion && hits.length) hits.push(...this.expand(hits, expansionDecay, opts.maxExpansion ?? topK, allowed))
    hits.forEach((h, r) => (h.rank = r + 1))
    return hits
  }

  private expand(seeds: Hit[], decay: number, limit: number, allowed: Set<number> | null): Hit[] {
    const seen = new Set(seeds.map((h) => h.chunk.id))
    const cands = new Map<number, Hit>()
    for (const h of seeds) {
      for (const { target, relation, weight } of this.adj.get(h.chunk.id) ?? []) {
        if (seen.has(target)) continue
        const tgt = this.byId.get(target)!
        if (allowed && !allowed.has(tgt.document_id)) continue
        const score = h.score * weight * decay
        const prev = cands.get(target)
        if (!prev || score > prev.score)
          cands.set(target, { chunk: tgt, score, rank: 0, via: 'graph', scores: { rrf: score }, from_chunk_id: h.chunk.id, relation })
      }
    }
    return [...cands.values()].sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index).slice(0, limit)
  }
}
