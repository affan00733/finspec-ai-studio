import { useState } from 'react'
import { Badge, Button, Callout, Card, CardHeader, KeyValue, PageHeader, Spinner } from '@/components/ui'
import { useAgents, useHealth, useProviderStatus, useResetDemo } from '@/hooks/queries'
import { api, isDemoMode } from '@/lib/api'
import { STORAGE_KEY } from '@/demo/state'
import { useToasts, useTour } from '@/lib/store'

export default function SettingsPage() {
  const health = useHealth()
  const providers = useProviderStatus()
  const agents = useAgents()
  const reset = useResetDemo()
  const toast = useToasts()
  const resetTour = useTour((s) => s.reset)
  const [confirm, setConfirm] = useState(false)
  const apiUrl = import.meta.env.VITE_API_URL

  let storageKb = 0
  try {
    storageKb = Math.round(((localStorage.getItem(STORAGE_KEY) ?? '').length * 2) / 1024)
  } catch {
    /* ignore */
  }

  return (
    <>
      <PageHeader eyebrow="Govern" title="Settings" description="Environment, providers and agent configurations. In Demo/Mock Mode no secret or network connection is required for anything in this application." />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Environment" />
          <div className="p-5">
            {health.isLoading ? (
              <Spinner />
            ) : (
              <KeyValue
                items={[
                  ['Mode', isDemoMode ? <Badge key="m" tone="warn">Demo / Mock Mode (in-browser engine)</Badge> : <Badge key="m" tone="ok">Backend API</Badge>],
                  ['API URL', apiUrl ? <code key="u" className="font-mono text-[12.5px]">{apiUrl}</code> : <span key="u" className="text-muted">not set (VITE_API_URL)</span>],
                  ['Service version', health.data?.version ?? '—'],
                  ['Companies / reports', `${health.data?.counts.companies ?? '—'} / ${health.data?.counts.documents ?? '—'}`],
                  ['Specifications', health.data?.counts.specifications ?? '—'],
                  ['Stored runs', health.data?.counts.runs ?? '—'],
                  ...(isDemoMode ? ([['Browser storage used', `${storageKb} KB`]] as [string, string][]) : []),
                ]}
              />
            )}
            {isDemoMode && (
              <Callout tone="info" className="mt-4">
                To use the Django backend instead, create <code className="rounded bg-white/70 px-1">frontend/.env.local</code> with <code className="rounded bg-white/70 px-1">VITE_API_URL=http://localhost:8000/api</code> and restart the dev server.
              </Callout>
            )}
          </div>
        </Card>

        <Card>
          <CardHeader title="Providers" subtitle={providers.data?.fallback_policy} />
          <ul className="divide-y divide-line">
            {providers.data?.providers.map((p) => (
              <li key={p.name} className="flex items-start justify-between gap-3 px-5 py-3">
                <div>
                  <div className="font-mono text-[13.5px] font-semibold">{p.name}</div>
                  <div className="text-[12.5px] text-muted">{p.note}</div>
                </div>
                <Badge tone={p.configured ? 'ok' : 'neutral'}>{p.configured ? 'active' : 'not configured'}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader title="Agent configurations" />
          <ul className="divide-y divide-line">
            {agents.data?.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[14px] font-semibold">{a.name}</span>
                    {a.is_default && <Badge tone="brand">default</Badge>}
                    <Badge>{a.mode}</Badge>
                    <Badge>{a.provider}</Badge>
                  </div>
                  <div className="mt-0.5 text-[13px] text-muted">{a.description}</div>
                  {!a.available && a.unavailable_reason && <div className="mt-1 text-[12.5px] text-warn">{a.unavailable_reason}</div>}
                </div>
                <Badge tone={a.available ? 'ok' : 'neutral'}>{a.available ? 'available' : 'unavailable'}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        {isDemoMode && (
          <Card className="lg:col-span-2">
            <CardHeader title="Demo data" subtitle="Reset everything stored in this browser: runs, reviews, prompt versions, spec edits, evaluations and the audit trail." />
            <div className="flex flex-wrap items-center gap-3 p-5">
              {!confirm ? (
                <Button variant="secondary" onClick={() => setConfirm(true)}>
                  Reset demo workspace…
                </Button>
              ) : (
                <>
                  <span className="text-[13.5px]">This restores the seeded state. Continue?</span>
                  <Button
                    variant="danger"
                    loading={reset.isPending}
                    onClick={() =>
                      reset.mutate(undefined, {
                        onSuccess: () => {
                          resetTour()
                          toast.push('ok', 'Demo reset to its seeded state.')
                          setConfirm(false)
                        },
                      })
                    }
                  >
                    Yes, reset
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </div>
          </Card>
        )}
      </div>
      <p className="mt-4 text-[12px] text-muted">API mode: {api.mode}</p>
    </>
  )
}
