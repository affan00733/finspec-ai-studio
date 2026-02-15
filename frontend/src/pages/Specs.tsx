import { useMutation } from '@tanstack/react-query'
import { Pencil } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, Card, CardHeader, Drawer, ErrorNote, Field, PageHeader, Select, Spinner, Textarea, Toggle, tableCls } from '@/components/ui'
import { useCompanies, useRefreshAll, useSpecifications } from '@/hooks/queries'
import { api } from '@/lib/api'
import { cn } from '@/lib/cn'
import { useToasts } from '@/lib/store'
import type { Specification } from '@/types'

const lines = (s: string) => s.split('\n').map((x) => x.trim()).filter(Boolean)

function EditSpec({ spec, onClose }: { spec: Specification; onClose: () => void }) {
  const [desc, setDesc] = useState(spec.description)
  const [aliases, setAliases] = useState(spec.aliases.join('\n'))
  const [excl, setExcl] = useState(spec.exclude_terms.join('\n'))
  const [active, setActive] = useState(spec.is_active)
  const refresh = useRefreshAll()
  const toast = useToasts()
  const save = useMutation({
    mutationFn: () => api.updateSpecification(spec.key, { description: desc, aliases: lines(aliases), exclude_terms: lines(excl), is_active: active }),
    onSuccess: () => {
      refresh()
      toast.push('ok', `Saved '${spec.name}'. New runs use the updated definition.`)
      onClose()
    },
  })
  return (
    <Drawer
      open
      onClose={onClose}
      title={`Edit ${spec.name}`}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" loading={save.isPending} onClick={() => save.mutate()}>
            Save specification
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Callout tone="info">
          Aliases and exclusion terms are used by retrieval, the extractor, prompt generation and validation. Changes apply to new runs and evaluations immediately.
        </Callout>
        <ErrorNote error={save.error} />
        <Field label="Description" htmlFor="spec-desc">
          <Textarea id="spec-desc" rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} />
        </Field>
        <Field label="Accepted line-item names (one per line)" htmlFor="spec-aliases" hint="Matched against table row labels and narrative sentences, case-insensitively.">
          <Textarea id="spec-aliases" rows={5} value={aliases} onChange={(e) => setAliases(e.target.value)} className="font-mono text-[13px]" />
        </Field>
        <Field label="Exclusion terms (one per line)" htmlFor="spec-excl" hint="Evidence introduced by these terms is rejected (e.g. 'adjusted', 'market-based').">
          <Textarea id="spec-excl" rows={3} value={excl} onChange={(e) => setExcl(e.target.value)} className="font-mono text-[13px]" />
        </Field>
        <Toggle checked={active} onChange={setActive} label="Active" description="Inactive specifications are skipped by runs and evaluations." />
      </div>
    </Drawer>
  )
}

export default function Specs() {
  const specs = useSpecifications()
  const companies = useCompanies()
  const [cat, setCat] = useState('')
  const [editing, setEditing] = useState<Specification | null>(null)
  const rows = useMemo(() => (specs.data ?? []).filter((s) => !cat || s.category === cat), [specs.data, cat])

  return (
    <>
      <PageHeader
        eyebrow="Corpus"
        title="Specs Catalog"
        description="Business definitions of each metric: the line-item names that count, the ones that must not, and how units and signs are normalised. One definition drives retrieval, prompts, extraction and validation."
      />
      <Card className="mb-5">
        <CardHeader title="Same concept, different vocabulary" subtitle="Each company reports its top line under a different name - the specs keep them apart" />
        <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
          {companies.data?.map((c) => (
            <div key={c.id} className="bg-surface px-5 py-3.5">
              <div className="text-[12.5px] text-muted">{c.name}</div>
              <div className="font-display text-[20px] font-semibold">{c.revenue_label ?? '—'}</div>
              <div className="text-[12px] text-muted">{c.reporting_currency}</div>
            </div>
          ))}
        </div>
      </Card>
      <div className="mb-4 flex items-center gap-3">
        <div className="w-48">
          <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)}>
            <option value="">All categories</option>
            <option value="financial">Financial</option>
            <option value="esg">ESG</option>
          </Select>
        </div>
        <span className="text-[13px] text-muted">{rows.length} specifications</span>
      </div>
      <ErrorNote error={specs.error} />
      {specs.isLoading ? (
        <Spinner />
      ) : (
        <Card>
          <div className={tableCls.wrap}>
            <table className={tableCls.table}>
              <thead>
                <tr>
                  <th className={tableCls.th}>Specification</th>
                  <th className={tableCls.th}>Policy</th>
                  <th className={tableCls.th}>Accepted names</th>
                  <th className={tableCls.th}>Excludes</th>
                  <th className={tableCls.th} />
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.key} className={cn(!s.is_active && 'opacity-55')}>
                    <td className={tableCls.td}>
                      <div className="font-semibold">{s.name}</div>
                      <div className="font-mono text-[11.5px] text-muted">{s.key}</div>
                      <div className="mt-1 max-w-sm text-[12.5px] leading-snug text-muted">{s.description}</div>
                    </td>
                    <td className={tableCls.td}>
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={s.category === 'esg' ? 'ok' : 'brand'}>{s.category}</Badge>
                        <Badge>{s.unit_type}</Badge>
                        <Badge>{s.sign_policy.replace('_', ' ')}</Badge>
                        {!s.is_active && <Badge tone="warn">inactive</Badge>}
                      </div>
                    </td>
                    <td className={cn(tableCls.td, 'max-w-xs')}>
                      <div className="flex flex-wrap gap-1">
                        {s.aliases.map((a) => (
                          <span key={a} className="rounded bg-sunken px-1.5 py-0.5 text-[12px]">
                            {a}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className={tableCls.td}>
                      <div className="flex flex-wrap gap-1">
                        {s.exclude_terms.length ? (
                          s.exclude_terms.map((a) => (
                            <span key={a} className="rounded bg-bad-bg px-1.5 py-0.5 text-[12px] text-bad">
                              {a}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </div>
                    </td>
                    <td className={cn(tableCls.td, 'text-right whitespace-nowrap')}>
                      <Link to={`/app/prompts?spec=${s.key}`} className="mr-3 text-[13px] font-medium text-brand-700 hover:underline">
                        Prompt
                      </Link>
                      <Button size="sm" variant="secondary" onClick={() => setEditing(s)} aria-label={`Edit ${s.name}`}>
                        <Pencil className="size-3.5" /> Edit
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
      {editing && <EditSpec spec={editing} onClose={() => setEditing(null)} />}
    </>
  )
}
