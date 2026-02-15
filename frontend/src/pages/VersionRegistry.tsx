import { useMutation } from '@tanstack/react-query'
import { GitBranch } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge, Button, Callout, Card, CardHeader, Drawer, ErrorNote, PageHeader, Spinner } from '@/components/ui'
import { useEvalRuns, usePromptTemplates, useRefreshAll } from '@/hooks/queries'
import { api } from '@/lib/api'
import { CONTROL_SHORT, diffControls } from '@/lib/controls'
import { fmtDateTime, pct } from '@/lib/format'
import { useToasts } from '@/lib/store'
import type { PromptVersion, VersionStatus } from '@/types'

const STATUS_TONE: Record<VersionStatus, 'ok' | 'warn' | 'neutral'> = { active: 'ok', candidate: 'warn', archived: 'neutral' }

export default function VersionRegistry() {
  const templates = usePromptTemplates()
  const evals = useEvalRuns()
  const refresh = useRefreshAll()
  const toast = useToasts()
  const [detail, setDetail] = useState<PromptVersion | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const evalVersion = useMutation({
    mutationFn: (id: number) => api.runEvaluation({ dataset: 1, prompt_version: id }),
    onSuccess: (r) => {
      refresh()
      toast.push('info', `${r.prompt_version_label}: accuracy ${pct(r.metrics.overall.accuracy, 2)} on ${r.dataset_name}.`)
    },
  })
  const promote = useMutation({
    mutationFn: (id: number) => api.activatePromptVersion(id),
    onSuccess: (v) => {
      refresh()
      toast.push('ok', `${v.label} is now the active version.`)
    },
    onError: (e) => {
      refresh()
      toast.push('bad', (e as Error).message)
    },
    onSettled: () => setBusy(null),
  })

  if (templates.isLoading) return <Spinner />
  return (
    <>
      <PageHeader
        eyebrow="Govern"
        title="Version Registry"
        description="Every prompt configuration is versioned together with its structured controls. Only one version is active; promotion re-runs the historical gate server-side, so a blocked candidate cannot be forced through."
      />
      <ErrorNote error={templates.error} />
      {templates.data?.map((t) => {
        const active = t.versions.find((v) => v.status === 'active')
        return (
          <Card key={t.id} className="mb-6">
            <CardHeader title={t.name} subtitle={t.description} actions={<Badge tone="brand">{t.kind}</Badge>} />
            <ul className="divide-y divide-line">
              {[...t.versions].reverse().map((v) => {
                const lastEval = evals.data?.find((e) => e.prompt_version === v.id && e.dataset === 1)
                const diff = active && v.id !== active.id ? diffControls(active.controls, v.controls) : []
                return (
                  <li key={v.id} className="px-5 py-4" data-testid="version-row">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <GitBranch className="size-4 text-faint" aria-hidden />
                          <span className="text-[15px] font-semibold">{v.label}</span>
                          <Badge tone={STATUS_TONE[v.status]}>{v.status}</Badge>
                          {lastEval ? <Badge tone="brand">accuracy {pct(lastEval.metrics.overall.accuracy, 2)}</Badge> : <Badge>not evaluated</Badge>}
                        </div>
                        <div className="mt-1 text-[12.5px] text-muted">
                          created {fmtDateTime(v.created_at)} by {v.created_by}
                          {v.notes ? ` · ${v.notes}` : ''}
                        </div>
                        {t.kind === 'extraction' && diff.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {diff.map((d) => {
                              const [k, rest] = d.split(': ')
                              return (
                                <Badge key={d} tone="warn">
                                  {CONTROL_SHORT[k] ?? k}: {rest}
                                </Badge>
                              )
                            })}
                            <span className="text-[12px] text-muted">vs active</span>
                          </div>
                        )}
                        {v.scenario && <p className="mt-2 text-[12.5px] text-warn">{v.scenario}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <Button size="sm" variant="ghost" onClick={() => setDetail(v)}>
                          Details
                        </Button>
                        {t.kind === 'extraction' && (
                          <>
                            <Button size="sm" variant="secondary" loading={evalVersion.isPending && evalVersion.variables === v.id} onClick={() => evalVersion.mutate(v.id)}>
                              Evaluate
                            </Button>
                            {v.status !== 'active' && (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={busy === v.id}
                                onClick={() => {
                                  setBusy(v.id)
                                  promote.mutate(v.id)
                                }}
                              >
                                Promote…
                              </Button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </Card>
        )
      })}
      <Callout tone="info" title="Promotion gate">
        Promoting a version replays the demo gold set against both the active version and the candidate. It is refused when a pinned historical case regresses, accuracy drops, false positives increase or a value loses its evidence. See the{' '}
        <Link to="/app/evaluation?scenario=E" className="font-medium underline">
          Evaluation Lab
        </Link>{' '}
        for the case-by-case view.
      </Callout>

      <Drawer open={Boolean(detail)} onClose={() => setDetail(null)} title={detail?.label ?? ''} width="max-w-2xl">
        {detail && (
          <div className="space-y-5 text-[13.5px]">
            <div className="flex gap-2">
              <Badge tone={STATUS_TONE[detail.status]}>{detail.status}</Badge>
              <Badge>version {detail.version}</Badge>
            </div>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">Structured controls (drive mock extraction)</h3>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1">
                {Object.entries(detail.controls).map(([k, v]) => (
                  <div key={k} className="flex justify-between border-b border-line py-1">
                    <dt className="text-muted">{CONTROL_SHORT[k] ?? k}</dt>
                    <dd className="font-medium">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </section>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">System prompt (free-form text)</h3>
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[12px] whitespace-pre-wrap">{detail.system_prompt}</pre>
            </section>
            <section>
              <h3 className="mb-2 text-[12px] font-semibold tracking-wider text-muted uppercase">User template</h3>
              <pre className="max-h-64 overflow-auto rounded-lg border border-line bg-canvas p-3 font-mono text-[12px] whitespace-pre-wrap">{detail.user_template}</pre>
            </section>
          </div>
        )}
      </Drawer>
    </>
  )
}
