import '@xyflow/react/dist/style.css'
import { useMutation } from '@tanstack/react-query'
import { Background, Controls, Handle, MarkerType, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Play } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ValidationBadge } from '@/components/badges'
import { Badge, Button, Card, CardHeader, ErrorNote, Field, PageHeader, Select } from '@/components/ui'
import { useDocuments, useEvalDatasets, usePromptTemplates, useReviewQueue, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { fmtValue } from '@/lib/format'
import type { DocumentDetail, ExtractionResult, RetrievalResponse } from '@/types'

interface StageDef {
  id: string
  title: string
  engine: string
  summary: string
  link?: [string, string]
}

const STAGES: StageDef[] = [
  { id: 'ingest', title: 'Ingest', engine: 'parsing', summary: 'Normalises report text (PDF/HTML/Markdown in backend mode; bundled Markdown here).' },
  { id: 'parse', title: 'Parse', engine: 'detect_sections · detect_context', summary: 'Finds sections, the fiscal year, currency and unit statements ("USD millions").', link: ['/app/documents', 'Documents'] },
  { id: 'chunk', title: 'Chunk', engine: 'chunk_document', summary: 'Structure-aware chunks: tables are never split mid-row and keep their caption.' },
  { id: 'graph', title: 'Graph', engine: 'build_relationships', summary: 'Links next/previous, section lead, table↔context and cross-references.' },
  { id: 'retrieve', title: 'Retrieve', engine: 'RetrievalIndex', summary: 'BM25 + lexical coverage fused with RRF, then graph expansion.', link: ['/app/retrieval', 'Retrieval Explorer'] },
  { id: 'extract', title: 'Extract', engine: 'DeterministicExtractor', summary: 'Reads table rows and narrative sentences under the target year, resolves units, selects the best candidate.', link: ['/app/extraction', 'Extraction Workbench'] },
  { id: 'validate', title: 'Validate', engine: 'validate_outcome · validate_cross', summary: 'Grounding, year, unit, sign, magnitude, exclusions and cross-metric rules.' },
  { id: 'review', title: 'Review', engine: 'review queue', summary: 'Low confidence, failed validation or conflicts go to an analyst.', link: ['/app/review', 'Review Queue'] },
  { id: 'evaluate', title: 'Evaluate', engine: 'evaluation', summary: 'Gold and pinned-incident replays gate every prompt release.', link: ['/app/evaluation', 'Evaluation Lab'] },
]

type StageData = { title: string; stat: string; active: boolean; done: boolean }

function StageNode({ data }: NodeProps<Node<StageData>>) {
  return (
    <div className={cn('w-[138px] rounded-xl border bg-surface px-3 py-2.5 shadow-card transition-colors', data.active ? 'border-brand-600 ring-2 ring-brand-200' : data.done ? 'border-ok/50 bg-ok-bg/40' : 'border-line')}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-line-strong" />
      <div className="text-[13.5px] font-semibold">{data.title}</div>
      <div className="mt-0.5 text-[11.5px] text-muted">{data.stat}</div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-line-strong" />
    </div>
  )
}
const nodeTypes = { stage: StageNode }

interface Trace {
  doc: DocumentDetail
  search: RetrievalResponse
  result: ExtractionResult
}

export default function AgentWorkflow() {
  const docs = useDocuments()
  const specs = useSpecifications()
  const prompts = usePromptTemplates()
  const queue = useReviewQueue()
  const datasets = useEvalDatasets()
  const [docId, setDocId] = useState<number | ''>('')
  const [specKey, setSpecKey] = useState('revenue')
  const [selected, setSelected] = useState<string>('extract')
  const [trace, setTrace] = useState<Trace | null>(null)
  const [stepIdx, setStepIdx] = useState(-1)

  const active = prompts.data?.find((t) => t.kind === 'extraction')?.versions.find((v) => v.status === 'active')
  const chunkTotal = docs.data?.reduce((a, d) => a + d.chunk_count, 0) ?? 0

  const run = useMutation({
    mutationFn: async () => {
      const id = docId === '' ? docs.data![0].id : docId
      setStepIdx(0)
      const doc = await api.getDocument(id)
      const search = await api.search({ specification: specKey, document_ids: [id], top_k: active?.controls.topK ?? 8, mode: active?.controls.retrievalMode, graph_expansion: active?.controls.graphExpansion })
      const { results } = await api.createRun({ document_ids: [id], specification_keys: [specKey], prompt_version: active?.id, dry_run: true })
      return { doc, search, result: results[0] } as Trace
    },
    onSuccess: async (t) => {
      setTrace(t)
      for (let i = 0; i <= STAGES.length; i++) {
        setStepIdx(i)
        await new Promise((r) => setTimeout(r, 140))
      }
    },
  })

  const stats: Record<string, string> = {
    ingest: `${docs.data?.length ?? '…'} reports`,
    parse: 'sections · FY · units',
    chunk: `${chunkTotal} chunks`,
    graph: 'chunk relations',
    retrieve: `top-k ${active?.controls.topK ?? '…'}`,
    extract: `${specs.data?.filter((s) => s.is_active).length ?? '…'} specs`,
    validate: 'grounding · units',
    review: `${queue.data?.length ?? '…'} queued`,
    evaluate: `${datasets.data?.[0]?.case_count ?? '…'} gold cases`,
  }
  const { nodes, edges } = useMemo(() => {
    const ns: Node<StageData>[] = STAGES.map((s, i) => ({
      id: s.id,
      type: 'stage',
      position: { x: i * 170, y: 30 },
      data: { title: s.title, stat: stats[s.id], active: stepIdx === i, done: stepIdx > i },
      draggable: false,
      selected: selected === s.id,
    }))
    const es: Edge[] = STAGES.slice(1).map((s, i) => ({
      id: `e${i}`,
      source: STAGES[i].id,
      target: s.id,
      animated: stepIdx === i + 1,
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
      style: { stroke: stepIdx > i ? '#0f7b53' : '#94a3b8', strokeWidth: 1.6 },
    }))
    return { nodes: ns, edges: es }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepIdx, selected, docs.data, specs.data, queue.data, datasets.data, active])

  const sel = STAGES.find((s) => s.id === selected)!
  const r = trace?.result
  const specUnit = specs.data?.find((s) => s.key === specKey)?.unit_type

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Agent Workflow"
        description="The extraction agent is a fixed, inspectable pipeline - not a black box. Pick a report and a specification, then trace one request through every stage with the real intermediate outputs."
      />
      <Card className="mb-5 overflow-hidden">
        <div className="h-[170px] bg-canvas/50" data-testid="workflow-graph">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.08 }}
            nodesDraggable={false}
            nodesConnectable={false}
            zoomOnScroll={false}
            panOnDrag={false}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_, n) => setSelected(n.id)}
          >
            <Background gap={22} color="#e2e6ee" />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
        <div className="grid gap-4 border-t border-line p-5 md:grid-cols-[1fr_auto]">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-[16px] font-semibold">{sel.title}</h2>
              <Badge className="font-mono">{sel.engine}</Badge>
            </div>
            <p className="mt-1 text-[14px] text-ink-2">{sel.summary}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {STAGES.map((s) => (
                <button key={s.id} type="button" onClick={() => setSelected(s.id)} className={cn('rounded-full px-2.5 py-0.5 text-[12px] font-medium', selected === s.id ? 'bg-brand-700 text-white' : 'bg-sunken text-ink-2 hover:bg-line')}>
                  {s.title}
                </button>
              ))}
            </div>
          </div>
          {sel.link && (
            <Link to={sel.link[0]} className="self-start text-[13.5px] font-semibold text-brand-700 hover:underline">
              Open {sel.link[1]} →
            </Link>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Trace one request" subtitle={`Uses the active configuration: ${active?.label ?? '…'}`} />
        <div className="grid gap-4 p-5 md:grid-cols-[1fr_1fr_auto]">
          <Field label="Report" htmlFor="wf-doc">
            <Select id="wf-doc" value={docId} onChange={(e) => setDocId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">{docs.data?.[0]?.title ?? 'Select…'}</option>
              {docs.data?.slice(1).map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Specification" htmlFor="wf-spec">
            <Select id="wf-spec" value={specKey} onChange={(e) => setSpecKey(e.target.value)}>
              {specs.data?.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" loading={run.isPending} onClick={() => run.mutate()} disabled={!docs.data?.length}>
              <Play className="size-3.5" /> Trace
            </Button>
          </div>
        </div>
        <div className="px-5 pb-1">
          <ErrorNote error={run.error} />
        </div>
        {trace && r && (
          <ol className="divide-y divide-line border-t border-line text-[13.5px]" data-testid="trace">
            <li className="px-5 py-3">
              <b>1–2 · Ingest &amp; parse</b> — {trace.doc.title}: {trace.doc.raw_text.length.toLocaleString()} characters, {trace.doc.sections.length} sections.
            </li>
            <li className="px-5 py-3">
              <b>3–4 · Chunk &amp; graph</b> — {trace.doc.chunks.length} chunks ({trace.doc.chunks.filter((c) => c.chunk_type === 'table').length} tables).
            </li>
            <li className="px-5 py-3">
              <b>5 · Retrieve</b> — {trace.search.count} chunks (
              {trace.search.hits.filter((h) => h.via === 'direct').length} direct, {trace.search.hits.filter((h) => h.via === 'graph').length} via graph):
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {trace.search.hits.map((h) => (
                  <Badge key={h.chunk_id} tone={h.via === 'graph' ? 'warn' : 'brand'}>
                    #{h.rank} chunk {h.index} · {h.heading.slice(0, 28)}
                  </Badge>
                ))}
              </div>
            </li>
            <li className="px-5 py-3">
              <b>6 · Extract</b> —{' '}
              {r.status === 'found' ? (
                <>
                  <span className="tnum font-semibold">{fmtValue(r.normalized_value, { currency: r.currency, unitType: specUnit })}</span> ({r.raw_value} {r.unit_label}), confidence {r.confidence.toFixed(2)}
                </>
              ) : (
                <span>{r.status.replace('_', ' ')}</span>
              )}
              <div className="mt-0.5 text-muted">{r.rationale}</div>
            </li>
            <li className="px-5 py-3">
              <b>7 · Validate</b> — <ValidationBadge status={r.validation_status} /> {r.validations.filter((v) => v.passed).length}/{r.validations.length} checks passed
              {r.validations.filter((v) => !v.passed && v.severity !== 'info').map((v) => (
                <div key={v.id} className="text-[12.5px] text-bad">
                  {v.rule}: {v.message}
                </div>
              ))}
            </li>
            <li className="px-5 py-3">
              <b>8 · Review routing</b> —{' '}
              {r.queue_reasons?.length ? (
                <>routed to analyst: {r.queue_reasons.join('; ')}</>
              ) : (
                <>no review needed (confidence {r.confidence.toFixed(2)}{r.status === 'not_found' ? ', metric legitimately not reported' : ''}).</>
              )}
            </li>
          </ol>
        )}
      </Card>
    </>
  )
}
