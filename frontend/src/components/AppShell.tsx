import { Menu, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { isDemoMode } from '@/lib/api'
import { NAV_GROUPS } from '@/lib/nav'
import { cn } from '@/lib/cn'
import { useResetDemo } from '@/hooks/queries'
import { useTour, useToasts } from '@/lib/store'
import { DemoModeBadge } from './badges'
import { Logo } from './Logo'
import { Button } from './ui'

function ResetDemoButton({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  const reset = useResetDemo()
  const tour = useTour()
  const toast = useToasts()
  if (!isDemoMode) return null
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} aria-label="Reset demo">
        <RotateCcw className="size-3.5" />
        {!compact && 'Reset demo'}
      </Button>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-ink/35" onClick={() => setOpen(false)} aria-hidden />
          <div role="alertdialog" aria-labelledby="reset-title" className="relative w-full max-w-md rounded-xl bg-surface p-6 shadow-pop">
            <h2 id="reset-title" className="font-display text-xl font-semibold">
              Reset the demo workspace?
            </h2>
            <p className="mt-2 text-[14px] text-muted">
              This clears everything stored in your browser for this demo - review decisions, extraction runs, new prompt versions, spec edits, evaluation history and the audit trail - and restores the seeded
              synthetic data. Nothing leaves your device.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={reset.isPending}
                onClick={() =>
                  reset.mutate(undefined, {
                    onSuccess: () => {
                      tour.reset()
                      toast.push('ok', 'Demo reset to its seeded state.')
                      setOpen(false)
                    },
                  })
                }
              >
                Reset demo
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Primary" className="scroll-thin flex h-full flex-col overflow-y-auto px-3 py-4">
      <NavLink to="/" className="mb-5 px-2" onClick={onNavigate} aria-label="FinSpec AI Studio home">
        <Logo />
      </NavLink>
      <div className="flex-1 space-y-5">
        {NAV_GROUPS.map((g) => (
          <div key={g.label}>
            <div className="mb-1 px-2 text-[10.5px] font-semibold tracking-[0.12em] text-faint uppercase">{g.label}</div>
            <ul className="space-y-0.5">
              {g.items.map((item) => (
                <li key={item.to}>
                  <NavLink
                    to={item.to}
                    end={item.end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'group relative flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13.5px] font-medium transition-colors',
                        isActive ? 'bg-brand-50 text-brand-800' : 'text-ink-2 hover:bg-sunken hover:text-ink',
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <span className="absolute top-1.5 bottom-1.5 -left-3 w-[3px] rounded-r bg-brand-600" aria-hidden />}
                        <item.icon className={cn('size-4 shrink-0', isActive ? 'text-brand-600' : 'text-faint group-hover:text-ink-2')} aria-hidden />
                        {item.label}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      {isDemoMode && (
        <div className="mt-4 rounded-lg border border-[#f0d9a8] bg-warn-bg p-3 text-[12px] leading-snug text-[#6b3d00]">
          <div className="font-semibold">Demo / Mock Mode</div>
          Synthetic data, running in your browser. No backend, no API keys, nothing uploaded.
        </div>
      )}
    </nav>
  )
}

export function AppShell() {
  const [open, setOpen] = useState(false)
  const loc = useLocation()
  return (
    <div className="flex h-full bg-canvas">
      <aside className="hidden w-[248px] shrink-0 border-r border-line bg-surface lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-ink/35" onClick={() => setOpen(false)} aria-hidden />
          <div className="relative h-full w-[272px] bg-surface shadow-pop">
            <button type="button" aria-label="Close menu" onClick={() => setOpen(false)} className="absolute top-3 right-3 rounded-md p-1 text-muted hover:bg-sunken">
              <X className="size-4" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur lg:px-8">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Open menu" className="rounded-md p-1.5 text-ink-2 hover:bg-sunken lg:hidden" onClick={() => setOpen(true)}>
              <Menu className="size-5" />
            </button>
            {isDemoMode ? (
              <>
                <DemoModeBadge />
                <span className="hidden text-[12.5px] text-muted sm:inline">Fictional companies · bundled synthetic reports · runs offline in this browser</span>
              </>
            ) : (
              <span className="text-[12.5px] text-muted">Connected to backend API</span>
            )}
          </div>
          <ResetDemoButton />
        </div>
        <main id="main" className="scroll-thin min-h-0 flex-1 overflow-y-auto">
          <div key={loc.pathname} className="mx-auto w-full max-w-[1280px] px-4 py-7 lg:px-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  )
}

export function Toasts() {
  const { items, dismiss } = useToasts()
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-[70] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 text-[13px] shadow-pop',
            t.tone === 'ok' && 'border-[#bfe6d3] bg-ok-bg text-[#0b5a3d]',
            t.tone === 'bad' && 'border-[#f3c4cc] bg-bad-bg text-[#7d1426]',
            t.tone === 'info' && 'border-brand-200 bg-info-bg text-brand-900',
          )}
        >
          <span>{t.message}</span>
          <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="opacity-60 hover:opacity-100">
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
