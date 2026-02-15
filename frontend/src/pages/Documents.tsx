import { ArrowLeft, FileText, Upload } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Highlighted, useDocument } from '@/components/evidence'
import { Badge, Callout, Card, CardHeader, ErrorNote, PageHeader, Select, Spinner, Tabs, tableCls } from '@/components/ui'
import { useCompanies, useDocuments } from '@/hooks/queries'
import { isDemoMode } from '@/lib/api'
import { cn } from '@/lib/cn'
import type { DocumentDetail } from '@/types'

function DocumentViewer({ id }: { id: number }) {
  const { data: doc, isLoading, error } = useDocument(id)
  const [params] = useSearchParams()
  const [tab, setTab] = useState<'text' | 'chunks' | 'sections'>('text')
  const start = Number(params.get('start'))
  const end = Number(params.get('end'))
  const hasHighlight = Boolean(params.get('end')) && end > start
  const blockRefs = useRef<Record<number, HTMLElement | null>>({})

  useEffect(() => {
    if (!doc || !hasHighlight) return
    const el = document.querySelector('mark[data-evidence]')
    el?.scrollIntoView?.({ block: 'center' })
  }, [doc, hasHighlight, start, end, tab])

  if (isLoading) return <Spinner />
  if (error || !doc) return <ErrorNote error={error ?? new Error('Document not found')} />
  return (
    <>
      <div className="mb-4 flex items-center gap-2 text-[13px]">
        <Link to="/app/documents" className="inline-flex items-center gap-1 text-muted hover:text-ink">
          <ArrowLeft className="size-3.5" /> All documents
        </Link>
      </div>
      <PageHeader
        title={doc.title}
        description={`${doc.company_name} · fiscal year ${doc.fiscal_year} · ${doc.chunk_count} chunks · ${doc.raw_text.length.toLocaleString()} characters`}
        actions={<Badge tone="neutral">{doc.source_filename}</Badge>}
      />
      {hasHighlight && (
        <Callout tone="info" className="mb-4" title="Evidence highlighted">
          Characters {start.toLocaleString()}–{end.toLocaleString()} are highlighted in the source text below.
        </Callout>
      )}
      <Tabs
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[
          { id: 'text', label: 'Source text' },
          { id: 'chunks', label: 'Chunks', count: doc.chunks.length },
          { id: 'sections', label: 'Sections', count: doc.sections.length },
        ]}
      />
      {tab === 'text' && (
        <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
          <nav aria-label="Sections" className="hidden lg:block">
            <div className="sticky top-2 space-y-0.5 text-[13px]">
              {doc.sections.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => blockRefs.current[s.order]?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                  className={cn('block w-full truncate rounded-md px-2 py-1 text-left text-ink-2 hover:bg-sunken', s.level > 1 && 'pl-4 text-muted')}
                >
                  {s.heading}
                </button>
              ))}
            </div>
          </nav>
          <Card className="p-5">
            {doc.sections.map((s) => (
              <section key={s.id} ref={(el) => void (blockRefs.current[s.order] = el)} className="scroll-mt-4">
                <Highlighted
                  text={doc.raw_text.slice(s.start_char, s.end_char)}
                  highlights={hasHighlight ? [{ start: start - s.start_char, end: end - s.start_char, kind: 'primary' as const }].filter((h) => h.end > 0 && h.start < s.end_char - s.start_char) : []}
                />
              </section>
            ))}
          </Card>
        </div>
      )}
      {tab === 'chunks' && <ChunkList doc={doc} />}
      {tab === 'sections' && (
        <Card>
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>#</th>
                  <th className={tableCls.th}>Heading</th>
                  <th className={tableCls.th}>Type</th>
                  <th className={tableCls.th}>Level</th>
                  <th className={tableCls.th}>Characters</th>
                </tr>
              </thead>
              <tbody>
                {doc.sections.map((s) => (
                  <tr key={s.id}>
                    <td className={tableCls.td}>{s.order + 1}</td>
                    <td className={cn(tableCls.td, 'font-medium')}>{s.heading}</td>
                    <td className={tableCls.td}>
                      <Badge>{s.section_type}</Badge>
                    </td>
                    <td className={tableCls.td}>{s.level}</td>
                    <td className={cn(tableCls.td, 'tnum text-muted')}>
                      {s.start_char.toLocaleString()}–{s.end_char.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  )
}

function ChunkList({ doc }: { doc: DocumentDetail }) {
  return (
    <div className="space-y-3">
      {doc.chunks.map((c) => (
        <Card key={c.id} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-canvas/60 px-4 py-2 text-[12.5px]">
            <span className="font-semibold">Chunk {c.index}</span>
            <Badge tone={c.chunk_type === 'table' ? 'brand' : 'neutral'}>{c.chunk_type}</Badge>
            <span className="text-muted">{c.heading}</span>
            <span className="tnum ml-auto text-muted">
              id {c.id} · {c.start_char.toLocaleString()}–{c.end_char.toLocaleString()} · {c.token_count} tokens
            </span>
          </div>
          <Highlighted text={c.text} highlights={[]} className="px-4 py-3" />
        </Card>
      ))}
    </div>
  )
}

export default function Documents() {
  const { id } = useParams()
  const nav = useNavigate()
  const docs = useDocuments()
  const companies = useCompanies()
  const [company, setCompany] = useState('')
  const [year, setYear] = useState('')
  const rows = useMemo(() => (docs.data ?? []).filter((d) => (!company || d.company === Number(company)) && (!year || d.fiscal_year === Number(year))), [docs.data, company, year])

  if (id) return <DocumentViewer id={Number(id)} />
  return (
    <>
      <PageHeader
        eyebrow="Corpus"
        title="Documents"
        description="Twelve fictional annual reports - four companies with deliberately different vocabularies, units and table layouts. Open any report to read the source text, chunks and sections the engine works from."
      />
      {isDemoMode ? (
        <Callout tone="info" className="mb-5" title="The demo corpus is read-only">
          <span className="inline-flex items-center gap-1.5">
            <Upload className="size-3.5" aria-hidden /> Uploading your own reports needs the backend parser (PDF/HTML). Set <code className="rounded bg-white/70 px-1">VITE_API_URL</code> to enable ingestion.
          </span>
        </Callout>
      ) : null}
      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-56">
          <Select aria-label="Company" value={company} onChange={(e) => setCompany(e.target.value)}>
            <option value="">All companies</option>
            {companies.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select aria-label="Fiscal year" value={year} onChange={(e) => setYear(e.target.value)}>
            <option value="">All years</option>
            {[2024, 2023, 2022].map((y) => (
              <option key={y} value={y}>
                FY{y}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <ErrorNote error={docs.error} />
      <Card>
        <CardHeader title={`${rows.length} report${rows.length === 1 ? '' : 's'}`} />
        {docs.isLoading ? (
          <Spinner />
        ) : (
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Report</th>
                  <th className={tableCls.th}>Company</th>
                  <th className={tableCls.th}>FY</th>
                  <th className={tableCls.th}>Chunks</th>
                  <th className={tableCls.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id} className="cursor-pointer hover:bg-canvas" onClick={() => nav(`/app/documents/${d.id}`)}>
                    <td className={tableCls.td}>
                      <Link to={`/app/documents/${d.id}`} className="inline-flex items-center gap-2 font-medium text-brand-800 hover:underline">
                        <FileText className="size-4 text-faint" aria-hidden />
                        {d.title}
                      </Link>
                    </td>
                    <td className={tableCls.td}>{d.company_name}</td>
                    <td className={cn(tableCls.td, 'tnum')}>{d.fiscal_year}</td>
                    <td className={cn(tableCls.td, 'tnum')}>{d.chunk_count}</td>
                    <td className={tableCls.td}>
                      <Badge tone="ok">{d.status}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  )
}
