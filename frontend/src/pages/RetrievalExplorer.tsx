import '@xyflow/react/dist/style.css'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Background, Controls, MarkerType, ReactFlow, type Edge, type Node } from '@xyflow/react'
import { ExternalLink, Network, Search } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Badge, Button, Callout, Card, CardHeader, ErrorNote, Field, Input, PageHeader, Select, Spinner, Tabs } from '@/components/ui'
import { useDocuments, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useTour } from '@/lib/store'
import type { RetrievalHit, RetrievalMode, RetrievalResponse } from '@/types'

function HitCard({ hit, highlight }: { hit: RetrievalHit; highlight?: boolean }) {
  const [open, setOpen] = useState(false)
  const text = open ? hit.text : hit.text.slice(0, 220) + (hit.text.length > 220 ? '…' : '')
  return (
    <li className={cn('rounded-lg border bg-surface p-3', highlight ? 'border-brand-300 ring-2 ring-brand-100' : 'border-line')} data-testid="hit" data-via={hit.via}>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
        <span className="tnum font-semibold text-ink">#{hit.rank}</span>
        <Badge tone={hit.chunk_type === 'table' ? 'brand' : 'neutral'}>{hit.chunk_type}</Badge>
        <Badge tone={hit.via === 'graph' ? 'warn' : 'ok'}>{hit.via === 'graph' ? `graph · ${hit.relation}` : 'direct match'}</Badge>
        <span className="truncate text-muted">{hit.heading}</span>
        <span className="tnum ml-auto text-muted">chunk {hit.index}</span>
      </div>
      <pre className="mt-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-ink-2">{text}</pre>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-muted">
        {hit.via === 'direct' ? (
          <>
            <span>BM25 {hit.scores.bm25?.toFixed(2)}</span>
            <span>lexical {hit.scores.lexical?.toFixed(2)}</span>
            <span>RRF {hit.score.toFixed(4)}</span>
          </>
        ) : (
          <span>
            reached from chunk id {hit.from_chunk_id} via “{hit.relation}” · decayed score {hit.score.toFixed(4)}
          </span>
        )}
        <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => setOpen(!open)}>
          {open ? 'Collapse' : 'Show full chunk'}
        </button>
        <Link className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline" to={`/app/documents/${hit.document_id}?start=${hit.start_char}&end=${hit.end_char}`}>
          In document <ExternalLink className="size-3" />
        </Link>
      </div>
    </li>
  )
}

function ChunkGraph({ documentId, hits }: { documentId: number; hits: RetrievalResponse | undefined }) {
  const graph = useQuery({ queryKey: ['graph', documentId], queryFn: () => api.graph({ document: documentId }) })
  const { nodes, edges } = useMemo(() => {
    const hitMap = new Map((hits?.hits ?? []).map((h) => [`chunk:${h.chunk_id}`, h]))
    const g = graph.data
    if (!g) return { nodes: [] as Node[], edges: [] as Edge[] }
    const chunkNodes = g.nodes.filter((n) => n.type === 'chunk')
    const ns: Node[] = chunkNodes.map((n, i) => {
      const hit = hitMap.get(n.id)
      return {
        id: n.id,
        position: { x: (i % 4) * 250, y: Math.floor(i / 4) * 130 },
        data: { label: `${n.index}. ${String(n.label)}${hit ? `\n${hit.via === 'graph' ? '↳ graph' : '● direct'} hit` : ''}` },
        style: {
          width: 215,
          fontSize: 12,
          whiteSpace: 'pre-line' as const,
          borderRadius: 10,
          border: hit ? (hit.via === 'graph' ? '2px solid #d98a00' : '2px solid #243bb5') : '1px solid #cdd4e1',
          background: hit ? (hit.via === 'graph' ? '#fdf3e1' : '#eef2ff') : '#fff',
        },
      }
    })
    const ids = new Set(ns.map((n) => n.id))
    const es: Edge[] = g.edges
      .filter((e) => ids.has(e.source) && ids.has(e.target))
      .map((e, i) => ({
        id: `e${i}`,
        source: e.source,
        target: e.target,
        label: e.type,
        markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
        style: { stroke: e.type === 'table_context' ? '#d98a00' : e.type === 'next' ? '#94a3b8' : '#4863e0' },
        labelStyle: { fontSize: 10 },
      }))
    return { nodes: ns, edges: es }
  }, [graph.data, hits])
  if (graph.isLoading) return <Spinner />
  return (
    <div className="h-[520px] rounded-xl border border-line bg-surface" data-testid="chunk-graph">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }} minZoom={0.3}>
        <Background gap={20} color="#e2e6ee" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}

export default function RetrievalExplorer() {
  const [params] = useSearchParams()
  const docs = useDocuments()
  const specs = useSpecifications()
  const complete = useTour((s) => s.complete)
  const [docId, setDocId] = useState<number | ''>('')
  const [query, setQuery] = useState('')
  const [specKey, setSpecKey] = useState('')
  const [topK, setTopK] = useState(3)
  const [mode, setMode] = useState<RetrievalMode>('hybrid')
  const [view, setView] = useState<'compare' | 'graph'>('compare')
  const [result, setResult] = useState<{ plain: RetrievalResponse; expanded: RetrievalResponse } | null>(null)
  const autoRan = useRef(false)

  const search = useMutation({
    mutationFn: async (p: { query: string; spec: string; doc: number | ''; topK: number; mode: RetrievalMode }) => {
      const base = { query: p.query || undefined, specification: p.spec || undefined, document_ids: p.doc === '' ? undefined : [p.doc], top_k: p.topK, mode: p.mode }
      const [plain, expanded] = await Promise.all([api.search({ ...base, graph_expansion: false }), api.search({ ...base, graph_expansion: true })])
      return { plain, expanded }
    },
    onSuccess: (r) => {
      setResult(r)
      if (r.expanded.hits.some((h) => h.via === 'graph')) complete('B')
    },
  })

  useEffect(() => {
    if (params.get('scenario') !== 'B' || autoRan.current || !docs.data) return
    const d = docs.data.find((x) => x.company_name === 'Cascade Retail' && x.fiscal_year === 2024)
    if (!d) return
    autoRan.current = true
    const q = 'Purchase of property, plant and equipment'
    setDocId(d.id)
    setQuery(q)
    setSpecKey('capex')
    setTopK(2)
    search.mutate({ query: q, spec: 'capex', doc: d.id, topK: 2, mode: 'hybrid' })
  }, [params, docs.data, search])

  const run = () => search.mutate({ query, spec: specKey, doc: docId, topK, mode })
  const added = result ? result.expanded.hits.filter((h) => h.via === 'graph') : []
  const canRun = Boolean(query.trim() || specKey)
  const presets: { label: string; doc: [string, number]; spec: string; query: string; k: number }[] = [
    { label: 'Cascade CapEx: table + adjacent note', doc: ['Cascade Retail', 2024], spec: 'capex', query: 'Purchase of property, plant and equipment', k: 2 },
    { label: 'Northstar Revenue', doc: ['Northstar Energy', 2024], spec: 'revenue', query: '', k: 3 },
    { label: 'Atlas Scope 2 (location-based)', doc: ['Atlas Materials', 2024], spec: 'scope_2', query: '', k: 3 },
  ]
  const applyPreset = (p: (typeof presets)[number]) => {
    const d = docs.data?.find((x) => x.company_name === p.doc[0] && x.fiscal_year === p.doc[1])
    if (!d) return
    setDocId(d.id)
    setSpecKey(p.spec)
    setQuery(p.query)
    setTopK(p.k)
    search.mutate({ query: p.query, spec: p.spec, doc: d.id, topK: p.k, mode })
  }

  return (
    <>
      <PageHeader
        eyebrow="Build"
        title="Retrieval Explorer"
        description="See exactly which chunks the reader is given. Hybrid BM25 + lexical search finds the table; the chunk graph then pulls in its caption, section lead and any adjacent note that qualifies the numbers."
      />
      <Card className="mb-5">
        <div className="grid gap-4 p-5 md:grid-cols-2 xl:grid-cols-[1.4fr_1fr_1.1fr_90px_130px_auto]">
          <Field label="Query" htmlFor="rq">
            <Input id="rq" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Free text, or choose a specification →" onKeyDown={(e) => e.key === 'Enter' && canRun && run()} />
          </Field>
          <Field label="Specification" htmlFor="rs">
            <Select id="rs" value={specKey} onChange={(e) => setSpecKey(e.target.value)}>
              <option value="">None (free text)</option>
              {specs.data?.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Report" htmlFor="rd">
            <Select id="rd" value={docId} onChange={(e) => setDocId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">All reports</option>
              {docs.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Top-k" htmlFor="rk">
            <Input id="rk" type="number" min={1} max={20} value={topK} onChange={(e) => setTopK(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} />
          </Field>
          <Field label="Mode" htmlFor="rm">
            <Select id="rm" value={mode} onChange={(e) => setMode(e.target.value as RetrievalMode)}>
              <option value="hybrid">Hybrid (RRF)</option>
              <option value="bm25">BM25 only</option>
              <option value="lexical">Lexical only</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <Button variant="primary" onClick={run} disabled={!canRun} loading={search.isPending}>
              <Search className="size-3.5" /> Search
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-[13px]">
          <span className="text-muted">Presets:</span>
          {presets.map((p) => (
            <Button key={p.label} size="sm" variant="subtle" onClick={() => applyPreset(p)}>
              {p.label}
            </Button>
          ))}
        </div>
      </Card>
      <ErrorNote error={search.error} />
      {!result && !search.isPending && <Callout tone="info">Run a search to compare retrieval with and without graph expansion.</Callout>}
      {result && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Tabs
              value={view}
              onChange={setView}
              tabs={[
                { id: 'compare', label: 'Side-by-side compare' },
                { id: 'graph', label: 'Chunk graph' },
              ]}
              className="flex-1"
            />
            <Badge tone={added.length ? 'warn' : 'neutral'}>
              <Network className="size-3" /> Graph expansion added {added.length} chunk{added.length === 1 ? '' : 's'}
            </Badge>
          </div>
          {view === 'compare' ? (
            <div className="grid gap-5 lg:grid-cols-2">
              <Card>
                <CardHeader title="Direct retrieval only" subtitle={`${result.plain.count} chunks · graph expansion off`} />
                <ul className="space-y-3 p-4">
                  {result.plain.hits.map((h) => (
                    <HitCard key={h.chunk_id} hit={h} />
                  ))}
                </ul>
              </Card>
              <Card>
                <CardHeader title="With graph expansion" subtitle={`${result.expanded.count} chunks · adjacent chunks pulled in via relationships`} />
                <ul className="space-y-3 p-4">
                  {result.expanded.hits.map((h) => (
                    <HitCard key={h.chunk_id} hit={h} highlight={h.via === 'graph'} />
                  ))}
                </ul>
              </Card>
            </div>
          ) : docId === '' ? (
            <Callout tone="warn">Select a single report to draw its chunk graph.</Callout>
          ) : (
            <ChunkGraph documentId={docId} hits={result.expanded} />
          )}
        </>
      )}
    </>
  )
}
