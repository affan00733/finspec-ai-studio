/**
 * Seed data for the demo workspace: prompt versions (with the intentional "regression" candidate), agents,
 * evaluation datasets and the pinned historical incident cases.
 */
import { DEMO_DATASET } from '@/data/demo-dataset'
import { DEFAULT_POLICY, type ExtractionPolicy } from './engineTypes.ts'
import type { AgentConfiguration, PromptTemplate, PromptVersion } from '@/types'

export const SEED_TS = '2026-10-21T14:05:00.000Z'

/** v1: shallow retrieval and loose line-item matching - the original baseline. */
export const POLICY_V1: ExtractionPolicy = { ...DEFAULT_POLICY, topK: 2, graphExpansion: false, strictLineItemContext: false }
/** v2 (production): full retrieval depth but still loose about preceding words ("Adjusted EBITDA" etc.). */
export const POLICY_V2: ExtractionPolicy = { ...DEFAULT_POLICY, strictLineItemContext: false }
/**
 * v3 (candidate): fixes the loose line-item matching (improves 4 historical cases) but "simplifies" the prompt by
 * dropping exclusion terms, so Scope 2 market-based figures leak back in (regresses 3 pinned cases).
 */
export const POLICY_V3: ExtractionPolicy = { ...DEFAULT_POLICY, strictLineItemContext: true, applyExclusions: false }

export const EXTRACTION_TEMPLATE_ID = 1
export const CHAT_TEMPLATE_ID = 2

export function seedPromptTemplates(): PromptTemplate[] {
  const ext = DEMO_DATASET.prompts.find((p) => p.kind === 'extraction')!
  const chat = DEMO_DATASET.prompts.find((p) => p.kind === 'chat')!
  const v1 = ext.versions.find((v) => v.version === 1)!
  const v2 = ext.versions.find((v) => v.version === 2)!
  const mk = (
    id: number,
    template: number,
    version: number,
    label: string,
    src: { system_prompt: string; user_template: string; output_schema: Record<string, unknown>; notes: string },
    status: PromptVersion['status'],
    controls: ExtractionPolicy,
    scenario?: string,
    ts = SEED_TS,
  ): PromptVersion => ({
    id,
    template,
    version,
    label,
    system_prompt: src.system_prompt,
    user_template: src.user_template,
    output_schema: src.output_schema,
    notes: src.notes,
    status,
    is_active: status === 'active',
    controls,
    created_by: 'seed',
    created_at: ts,
    scenario,
  })
  const v3sys =
    v2.system_prompt +
    '\n9. Keep answers concise: prefer the most specific line item and do not enumerate excluded measures.'
  const versions: PromptVersion[] = [
    mk(1, EXTRACTION_TEMPLATE_ID, 1, 'v1 · initial baseline', v1, 'archived', POLICY_V1, undefined, '2026-09-02T09:00:00.000Z'),
    mk(2, EXTRACTION_TEMPLATE_ID, 2, 'v2 · production', v2, 'active', POLICY_V2, undefined, '2026-09-24T11:30:00.000Z'),
    mk(
      3,
      EXTRACTION_TEMPLATE_ID,
      3,
      'v3 · concise matching',
      {
        system_prompt: v3sys,
        user_template: v2.user_template,
        output_schema: v2.output_schema,
        notes: 'Candidate: stricter preceding-word rule for line items; exclusion lists removed to shorten the prompt.',
      },
      'candidate',
      POLICY_V3,
      'Intentional regression scenario: fixes 4 historical cases, breaks 3 pinned Scope 2 cases - promotion is blocked.',
      '2026-10-20T16:40:00.000Z',
    ),
  ]
  const extTpl: PromptTemplate = {
    id: EXTRACTION_TEMPLATE_ID,
    name: ext.name,
    kind: 'extraction',
    description: ext.description,
    active_version: 2,
    versions,
  }
  const chatV = chat.versions[0]
  const chatTpl: PromptTemplate = {
    id: CHAT_TEMPLATE_ID,
    name: chat.name,
    kind: 'chat',
    description: chat.description,
    active_version: 4,
    versions: [mk(4, CHAT_TEMPLATE_ID, 1, 'v1 · grounded chat', chatV, 'active', DEFAULT_POLICY, undefined, '2026-09-02T09:00:00.000Z')],
  }
  return [extTpl, chatTpl]
}

export const AGENTS: AgentConfiguration[] = [
  {
    id: 1,
    name: 'Deterministic Reader (offline)',
    description: 'Default. Evidence-grounded text reader running in your browser; no network, no API keys.',
    mode: 'deterministic',
    provider: 'mock',
    model: 'mock-deterministic-1',
    is_default: true,
    top_k: 8,
    available: true,
  },
  {
    id: 2,
    name: 'Mock LLM Pipeline (offline)',
    description: 'Renders the full prompt for each metric, then answers with the offline mock model and verifies grounding.',
    mode: 'llm',
    provider: 'mock',
    model: 'mock-deterministic-1',
    is_default: false,
    top_k: 8,
    available: true,
  },
  {
    id: 3,
    name: 'OpenAI Responses API',
    description: 'Paid provider. Requires the backend with OPENAI_API_KEY; never used silently as a fallback.',
    mode: 'llm',
    provider: 'openai',
    model: 'gpt-4.1-mini',
    is_default: false,
    top_k: 8,
    available: false,
    unavailable_reason: 'Not available in the public demo - connect the backend (VITE_API_URL) and set OPENAI_API_KEY.',
  },
  {
    id: 4,
    name: 'Azure OpenAI Responses API',
    description: 'Paid provider. Requires the backend with Azure OpenAI endpoint, key and deployment.',
    mode: 'llm',
    provider: 'azure',
    model: '',
    is_default: false,
    top_k: 8,
    available: false,
    unavailable_reason: 'Not available in the public demo - connect the backend (VITE_API_URL) and configure Azure OpenAI.',
  },
]

export const DATASETS = {
  gold: { id: 1, name: 'Demo Gold Set (FY2022-FY2024)', description: 'Expected values for every company x year x specification, including line items that are legitimately not reported.' },
  incidents: { id: 2, name: 'Historical Incident Suite', description: 'Pinned cases that previously caused production incidents. Any regression on these blocks promotion.' },
}

/** Pinned historical cases: [ticker, fiscal year, spec key, incident]. */
export const PINNED_CASES: [string, number, string, string][] = [
  ['NSTR', 2024, 'revenue', 'Smoke test: FY2024 headline revenue must be read from the FY2024 column, not FY2023.'],
  ['MRDN', 2023, 'net_sales', 'Three-column table: FY2023 sits in the middle column.'],
  ['CSCD', 2024, 'turnover', 'Note column shifts value cells right by one.'],
  ['ATLS', 2024, 'operating_revenue', 'Years are listed oldest-first (ascending columns).'],
  ['ATLS', 2022, 'revenue', 'INC-044: "Operating revenue" must never be reported as "Revenue".'],
  ['ATLS', 2023, 'revenue', 'INC-044: "Operating revenue" must never be reported as "Revenue".'],
  ['ATLS', 2024, 'revenue', 'INC-044: "Operating revenue" must never be reported as "Revenue".'],
  ['ATLS', 2022, 'ebitda', 'INC-031: only Adjusted EBITDA is disclosed - reported EBITDA must be absent.'],
  ['CSCD', 2022, 'scope_2', 'INC-052: location-based Scope 2 only; market-based figure sits in the same paragraph.'],
  ['CSCD', 2023, 'scope_2', 'INC-052: location-based Scope 2 only; market-based figure sits in the same paragraph.'],
  ['CSCD', 2024, 'scope_2', 'INC-052: location-based Scope 2 only; market-based figure sits in the same paragraph.'],
  ['CSCD', 2024, 'capex', 'Outflow shown in parentheses must normalise to a positive CapEx.'],
  ['NSTR', 2024, 'scope_1', 'Unit (ktCO2e) is stated in the row label.'],
  ['ATLS', 2024, 'scope_1', 'Unit (million tCO2e) is stated in the table caption.'],
  ['MRDN', 2023, 'green_capex', 'Green CapEx not disclosed for FY2023.'],
  ['NSTR', 2022, 'rd_expense', 'R&D not reported for FY2022.'],
]

export function pinnedKey(documentId: number, specKey: string) {
  return `${documentId}:${specKey}`
}

export function pinnedMap(): Map<string, string> {
  const tick = new Map(DEMO_DATASET.companies.map((c) => [c.ticker, c.id]))
  const out = new Map<string, string>()
  for (const [ticker, year, spec, incident] of PINNED_CASES) {
    const doc = DEMO_DATASET.documents.find((d) => d.company_id === tick.get(ticker) && d.fiscal_year === year)
    if (doc) out.set(pinnedKey(doc.id, spec), incident)
  }
  return out
}
