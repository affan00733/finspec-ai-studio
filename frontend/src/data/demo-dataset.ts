/**
 * Typed access to the bundled synthetic demo corpus.
 *
 * `demo-dataset.json` is generated from backend/engine/demo_corpus.py by `scripts/export_demo_dataset.py`.
 * Every company, document and figure is fictional. It contains full report text, sections, chunks, the chunk
 * relationship graph, ground-truth values, default specifications and prompt templates, plus a reference run
 * of the Python extractor used for parity tests.
 */
import raw from './demo-dataset.json'
import type { ChunkMeta } from '@/demo/engineTypes'

export interface DemoCompany {
  id: number
  name: string
  ticker: string
  sector: string
  description: string
  reporting_currency: string
  is_fictional: boolean
  revenue_label: string
  revenue_key: string
}

export interface DemoChunk {
  id: number
  index: number
  chunk_type: 'text' | 'table'
  heading: string
  text: string
  start_char: number
  end_char: number
  section: number
  meta: ChunkMeta
}

export interface DemoSection {
  order: number
  heading: string
  level: number
  section_type: string
  start_char: number
  end_char: number
}

export interface DemoRelationship {
  source: number
  target: number
  relation: string
  weight: number
}

export interface DemoDocument {
  id: number
  company_id: number
  company_name: string
  title: string
  doc_type: string
  fiscal_year: number
  source_filename: string
  raw_text: string
  context: { fiscal_year: number | null; currency: string | null; scale: string | null; emission_unit: [string, string] | null }
  sections: DemoSection[]
  chunks: DemoChunk[]
  relationships: DemoRelationship[]
  /** spec key -> expected normalized value (base currency units / tCO2e) or null when legitimately not reported */
  gold: Record<string, string | null>
}

export interface DemoSpec {
  key: string
  name: string
  category: string
  unit_type: 'currency' | 'emissions'
  sign_policy: 'as_reported' | 'absolute'
  description: string
  aliases: string[]
  exclude_terms: string[]
  rules: Record<string, unknown>
}

export interface DemoPromptVersion {
  version: number
  system_prompt: string
  user_template: string
  output_schema: Record<string, unknown>
  notes: string
  is_active: boolean
}

export interface DemoPromptTemplate {
  name: string
  kind: 'extraction' | 'chat'
  description: string
  versions: DemoPromptVersion[]
}

export interface DemoReference {
  document_id: number
  spec_key: string
  status: string
  normalized: string | null
  raw_number: string | null
  quote: string | null
  start_char: number | null
  method: string | null
  confidence: number
  retrieved: number
}

export interface DemoDataset {
  companies: DemoCompany[]
  documents: DemoDocument[]
  specifications: DemoSpec[]
  prompts: DemoPromptTemplate[]
  reference: DemoReference[]
}

export const DEMO_DATASET = raw as unknown as DemoDataset
