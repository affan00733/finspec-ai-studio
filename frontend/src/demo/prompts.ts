/** Prompt rendering and generation from specifications (port of backend/engine/prompts.py). */
import type { SpecDef } from './engineTypes.ts'
import type { Hit } from './retrieval.ts'
import { tokenize } from './retrieval.ts'

export class PromptError extends Error {}

const VAR_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

export function templateVariables(template: string): string[] {
  return [...new Set([...template.matchAll(VAR_RE)].map((m) => m[1]))].sort()
}

export function renderTemplate(template: string, variables: Record<string, string | number>): string {
  const missing = templateVariables(template).filter((v) => !(v in variables))
  if (missing.length) throw new PromptError(`Template references undefined variables: ${missing.join(', ')}`)
  return template.replace(VAR_RE, (_, name: string) => String(variables[name]))
}

const attr = (v: unknown) =>
  String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

export function taskTag(spec: SpecDef, fiscalYear: number | null | undefined): string {
  return (
    `<task spec_key="${attr(spec.key)}" spec_name="${attr(spec.name)}" fiscal_year="${attr(fiscalYear ?? '')}" ` +
    `unit_type="${attr(spec.unit_type)}" sign_policy="${attr(spec.sign_policy)}" ` +
    `aliases="${attr(spec.aliases.join('|'))}" exclude="${attr(spec.exclude_terms.join('|'))}"/>`
  )
}

export function buildContext(hits: Hit[], maxChars = 4000): string {
  if (!hits.length) return '(no excerpts retrieved)'
  return hits
    .map((h) => {
      const c = h.chunk
      const text = c.text.length <= maxChars ? c.text : c.text.slice(0, maxChars)
      return `<chunk id="${attr(c.id)}" document="${attr(c.document_id)}" start="${c.start_char}" type="${attr(c.chunk_type)}" section="${attr(c.heading)}">\n${text}\n</chunk>`
    })
    .join('\n')
}

export function unitGuidance(spec: SpecDef): string {
  return spec.unit_type === 'emissions'
    ? 'Report the emissions unit exactly as stated (tCO2e, ktCO2e, million tCO2e). Normalise nothing.'
    : 'Report currency and scale exactly as stated (thousands, millions, billions); do not convert.'
}

export function specVariables(spec: SpecDef, company: string, fiscalYear: number | null | undefined, context: string) {
  return {
    task_tag: taskTag(spec, fiscalYear),
    company: company || '(unspecified)',
    fiscal_year: fiscalYear ?? '(unspecified)',
    spec_name: spec.name,
    spec_description: spec.description || spec.name,
    aliases: spec.aliases.join('; '),
    exclusions: spec.exclude_terms.join('; ') || 'none',
    unit_guidance: unitGuidance(spec),
    context,
  }
}

export interface GeneratedPrompt {
  specification: string
  system: string
  user: string
  schema: Record<string, unknown>
  variables: Record<string, string | number>
  retrieved_chunk_ids: number[]
  estimated_input_tokens: number
}

export function generateExtractionPrompt(
  spec: SpecDef,
  company: string,
  fiscalYear: number | null | undefined,
  hits: Hit[],
  systemPrompt: string,
  userTemplate: string,
  schema: Record<string, unknown>,
): GeneratedPrompt {
  const vars = specVariables(spec, company, fiscalYear, buildContext(hits))
  const user = renderTemplate(userTemplate, vars)
  const { context: _context, ...rest } = vars
  void _context
  return {
    specification: spec.key,
    system: systemPrompt,
    user,
    schema,
    variables: rest,
    retrieved_chunk_ids: hits.map((h) => h.chunk.id),
    estimated_input_tokens: tokenize(systemPrompt + user).length,
  }
}
