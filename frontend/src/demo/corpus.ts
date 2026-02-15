/** Loads the bundled synthetic corpus into engine structures (chunks, graph, index, contexts). */
import { DEMO_DATASET } from '@/data/demo-dataset'
import type { ChunkRef, DocContext, SpecDef } from './engineTypes.ts'
import { RetrievalIndex, type Edge } from './retrieval.ts'

export function toSpecDef(s: {
  key: string
  name: string
  aliases: string[]
  category: string
  unit_type: string
  sign_policy: string
  exclude_terms: string[]
  description: string
  rules: Record<string, unknown>
}): SpecDef {
  return {
    key: s.key,
    name: s.name,
    aliases: [...s.aliases],
    category: s.category,
    unit_type: s.unit_type as SpecDef['unit_type'],
    sign_policy: s.sign_policy as SpecDef['sign_policy'],
    exclude_terms: [...s.exclude_terms],
    description: s.description,
    rules: { ...s.rules },
  }
}

export interface Corpus {
  chunks: ChunkRef[]
  edges: Edge[]
  contexts: Map<number, DocContext>
  index: RetrievalIndex
  chunkById: Map<number, ChunkRef>
}

let cached: Corpus | null = null

export function getCorpus(): Corpus {
  if (cached) return cached
  const chunks: ChunkRef[] = []
  const edges: Edge[] = []
  const contexts = new Map<number, DocContext>()
  for (const d of DEMO_DATASET.documents) {
    contexts.set(d.id, {
      fiscal_year: d.context.fiscal_year,
      currency: d.context.currency,
      scale: d.context.scale ? Number(d.context.scale) : null,
      emission_unit: d.context.emission_unit ? [Number(d.context.emission_unit[0]), d.context.emission_unit[1]] : null,
    })
    for (const c of d.chunks) {
      chunks.push({
        id: c.id,
        document_id: d.id,
        index: c.index,
        text: c.text,
        start_char: c.start_char,
        end_char: c.end_char,
        chunk_type: c.chunk_type,
        heading: c.heading,
        meta: c.meta,
      })
    }
    for (const r of d.relationships) edges.push({ source: r.source, target: r.target, relation: r.relation, weight: r.weight })
  }
  const index = new RetrievalIndex(chunks, edges)
  cached = { chunks, edges, contexts, index, chunkById: new Map(chunks.map((c) => [c.id, c])) }
  return cached
}
