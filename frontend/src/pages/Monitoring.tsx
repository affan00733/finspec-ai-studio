import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Badge, Card, CardHeader, ErrorNote, Input, PageHeader, Select, Spinner, Stat, tableCls } from '@/components/ui'
import { useAudit, useMonitoring, useProviderStatus } from '@/hooks/queries'
import { cn } from '@/lib/cn'
import { fmtDateTime, pct } from '@/lib/format'

const PREFIXES = [
  ['', 'All events'],
  ['run.', 'Runs'],
  ['review.', 'Reviews'],
  ['prompt.', 'Prompts & promotions'],
  ['evaluation.', 'Evaluations'],
  ['chat.', 'Chat'],
  ['specification.', 'Specifications'],
  ['demo.', 'Demo workspace'],
] as const

export default function Monitoring() {
  const mon = useMonitoring()
  const providers = useProviderStatus()
  const [q, setQ] = useState('')
  const [prefix, setPrefix] = useState('')
  const audit = useAudit({ q: q || undefined, action_prefix: prefix || undefined })
  const m = mon.data

  return (
    <>
      <PageHeader eyebrow="Govern" title="Monitoring & Audit" description="Quality signals from the latest run, provider status, and an append-only trail of every run, review, prompt change and promotion decision." />
      <ErrorNote error={mon.error} />
      {mon.isLoading || !m ? (
        <Spinner />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Stat label="Extraction runs" value={m.runs} />
            <Stat label="Current results (latest per report × spec)" value={m.results} />
            <Stat label="Review backlog" value={m.review_backlog} tone={m.review_backlog ? 'warn' : 'ok'} />
            <Stat label="Analyst decisions" value={m.reviewed} />
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Card>
              <CardHeader title="Confidence distribution" subtitle="Found results, latest extraction per report × spec" />
              <div className="h-60 px-3 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={m.confidence_buckets}>
                    <CartesianGrid stroke="#e2e6ee" vertical={false} />
                    <XAxis dataKey="bucket" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={32} />
                    <Tooltip cursor={{ fill: '#f1f3f9' }} contentStyle={{ borderRadius: 8, border: '1px solid #e2e6ee', fontSize: 12 }} />
                    <Bar dataKey="count" name="Results" fill="#243bb5" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Found rate by run" subtitle="Share of document × specification pairs with a value" />
              <div className="h-60 px-3 py-4">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={m.run_history.map((r) => ({ ...r, found: Math.round(r.found_rate * 1000) / 10 }))}>
                    <CartesianGrid stroke="#e2e6ee" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
                    <YAxis unit="%" domain={[0, 100]} tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip formatter={(v) => [`${v}%`, 'Found']} contentStyle={{ borderRadius: 8, border: '1px solid #e2e6ee', fontSize: 12 }} />
                    <Line type="monotone" dataKey="found" stroke="#243bb5" strokeWidth={2.5} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </>
      )}

      <Card className="mt-5">
        <CardHeader title="Providers" subtitle={providers.data?.fallback_policy} />
        <ul className="divide-y divide-line">
          {providers.data?.providers.map((p) => (
            <li key={p.name} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[13.5px] font-semibold">{p.name}</span>
                  {p.paid && <Badge>paid</Badge>}
                </div>
                <div className="text-[12.5px] text-muted">{p.note}</div>
              </div>
              <Badge tone={p.configured ? 'ok' : 'neutral'}>{p.configured ? 'active' : 'not configured'}</Badge>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="mt-5">
        <CardHeader
          title="Audit trail"
          subtitle="Newest first · stored in this browser in demo mode"
          actions={
            <div className="flex items-center gap-2">
              <Select aria-label="Event type" className="h-8 w-48 text-[13px]" value={prefix} onChange={(e) => setPrefix(e.target.value)}>
                {PREFIXES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Input aria-label="Search audit" className="h-8 w-48 text-[13px]" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          }
        />
        {audit.isLoading ? (
          <Spinner />
        ) : (
          <div className={cn(tableCls.wrap, 'max-h-[460px] overflow-y-auto')}>
            <table className={tableCls.table} data-testid="audit-table">
              <thead>
                <tr>
                  <th className={tableCls.th}>When</th>
                  <th className={tableCls.th}>Actor</th>
                  <th className={tableCls.th}>Action</th>
                  <th className={tableCls.th}>Summary</th>
                </tr>
              </thead>
              <tbody>
                {audit.data?.map((a) => (
                  <tr key={a.id}>
                    <td className={cn(tableCls.td, 'whitespace-nowrap text-muted')}>{fmtDateTime(a.created_at)}</td>
                    <td className={tableCls.td}>{a.actor}</td>
                    <td className={tableCls.td}>
                      <Badge tone={a.action.includes('blocked') ? 'bad' : a.action.startsWith('review') ? 'brand' : 'neutral'} className="font-mono">
                        {a.action}
                      </Badge>
                    </td>
                    <td className={tableCls.td}>{a.summary}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {audit.data?.length === 0 && <div className="px-5 py-8 text-center text-sm text-muted">No matching events.</div>}
          </div>
        )}
      </Card>
      <p className="mt-3 text-[12px] text-muted">Validation outcomes in the latest run: {m ? Object.entries(m.validation).map(([k, v]) => `${k} ${v}`).join(' · ') : '—'} · found rate {pct(m?.run_history.at(-1)?.found_rate, 0)}</p>
    </>
  )
}
