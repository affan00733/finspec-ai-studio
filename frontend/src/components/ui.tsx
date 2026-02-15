import { Loader2, X, Info, AlertTriangle, CheckCircle2, XCircle } from 'lucide-react'
import { useEffect, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

// ---------------------------------------------------------------- Button

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle'
const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-brand-700 text-white hover:bg-brand-800 shadow-card disabled:bg-brand-300',
  secondary: 'bg-surface text-ink border border-line-strong hover:bg-sunken disabled:text-faint',
  ghost: 'text-ink-2 hover:bg-sunken disabled:text-faint',
  subtle: 'bg-brand-50 text-brand-800 hover:bg-brand-100 disabled:text-faint',
  danger: 'bg-bad text-white hover:bg-[#9b1c30] disabled:opacity-50',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md'; loading?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed',
        size === 'sm' ? 'h-8 px-2.5 text-[13px]' : 'h-9 px-3.5 text-sm',
        buttonStyles[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------- Card

export function Card({ className, children, ...rest }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-xl border border-line bg-surface shadow-card', className)} {...rest}>
      {children}
    </div>
  )
}

export function CardHeader({ title, subtitle, actions, className }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start justify-between gap-4 border-b border-line px-5 py-3.5', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-semibold text-ink">{title}</h2>
        {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  )
}

// ---------------------------------------------------------------- Badge

export type Tone = 'neutral' | 'brand' | 'ok' | 'warn' | 'bad' | 'info'
const toneStyles: Record<Tone, string> = {
  neutral: 'bg-sunken text-ink-2 border-line',
  brand: 'bg-brand-50 text-brand-800 border-brand-200',
  ok: 'bg-ok-bg text-ok border-[#bfe6d3]',
  warn: 'bg-warn-bg text-warn border-[#f0d9a8]',
  bad: 'bg-bad-bg text-bad border-[#f3c4cc]',
  info: 'bg-info-bg text-brand-700 border-brand-200',
}

export function Badge({ tone = 'neutral', children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={cn('inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] leading-4 font-medium whitespace-nowrap', toneStyles[tone], className)}>
      {children}
    </span>
  )
}

// ---------------------------------------------------------------- Page chrome

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="max-w-3xl">
        {eyebrow && <div className="mb-1 text-xs font-semibold tracking-wider text-brand-600 uppercase">{eyebrow}</div>}
        <h1 className="font-display text-[28px] leading-tight font-semibold text-ink">{title}</h1>
        {description && <p className="mt-1.5 text-[14.5px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

export function Stat({ label, value, hint, tone, icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: Tone; icon?: ReactNode }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between text-[12.5px] font-medium text-muted">
        <span>{label}</span>
        {icon && <span className="text-faint">{icon}</span>}
      </div>
      <div className={cn('font-display tnum mt-1.5 text-[30px] leading-none font-semibold', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok', tone === 'warn' && 'text-warn')}>{value}</div>
      {hint && <div className="mt-2 text-[12.5px] text-muted">{hint}</div>}
    </Card>
  )
}

export function Callout({ tone = 'info', title, children, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; title?: ReactNode; children?: ReactNode; className?: string }) {
  const styles = {
    info: ['bg-info-bg border-brand-200 text-brand-900', <Info key="i" className="size-4 text-brand-600" />],
    warn: ['bg-warn-bg border-[#f0d9a8] text-[#6b3d00]', <AlertTriangle key="w" className="size-4 text-warn" />],
    bad: ['bg-bad-bg border-[#f3c4cc] text-[#7d1426]', <XCircle key="b" className="size-4 text-bad" />],
    ok: ['bg-ok-bg border-[#bfe6d3] text-[#0b5a3d]', <CheckCircle2 key="o" className="size-4 text-ok" />],
  } as const
  const [cls, icon] = styles[tone]
  return (
    <div role={tone === 'bad' ? 'alert' : 'note'} className={cn('flex gap-2.5 rounded-lg border px-3.5 py-2.5 text-[13.5px]', cls, className)}>
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div>
        {title && <div className="font-semibold">{title}</div>}
        {children && <div className={cn(title && 'mt-0.5', 'leading-relaxed')}>{children}</div>}
      </div>
    </div>
  )
}

export function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      <div className="font-display text-lg font-semibold">{title}</div>
      {children && <p className="mt-1 max-w-md text-[13.5px] text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted" role="status">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {label}…
    </div>
  )
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null
  return (
    <Callout tone="bad" title="Request failed">
      {(error as Error).message ?? String(error)}
    </Callout>
  )
}

// ---------------------------------------------------------------- Forms

const fieldBase =
  'w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-sunken disabled:text-muted'

export function Field({ label, hint, children, htmlFor }: { label: ReactNode; hint?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="block">
      <label htmlFor={htmlFor} className="mb-1 block text-[12.5px] font-semibold text-ink-2">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  )
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, 'h-9', className)} {...rest} />
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cn(fieldBase, 'h-9 pr-8', className)} {...rest}>
      {children}
    </select>
  )
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, 'py-2 leading-relaxed', className)} {...rest} />
}

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; description?: ReactNode; disabled?: boolean }) {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-4 py-2.5">
      <div className="min-w-0">
        <label htmlFor={id} className="text-[13.5px] font-medium text-ink">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[12.5px] leading-snug text-muted">{description}</p>}
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors disabled:opacity-50', checked ? 'bg-brand-600' : 'bg-line-strong')}
      >
        <span className={cn('absolute top-0.5 left-0.5 size-4 rounded-full bg-white shadow transition-transform', checked && 'translate-x-4')} />
      </button>
    </div>
  )
}

export function Tabs<T extends string>({ value, onChange, tabs, className }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: ReactNode; count?: number }[]; className?: string }) {
  return (
    <div role="tablist" className={cn('flex gap-1 border-b border-line', className)}>
      {tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors',
            value === t.id ? 'border-brand-600 text-brand-800' : 'border-transparent text-muted hover:text-ink',
          )}
        >
          {t.label}
          {t.count !== undefined && <span className="rounded-full bg-sunken px-1.5 text-[11px] text-ink-2">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- Drawer / Modal

export function Drawer({ open, onClose, title, children, width = 'max-w-xl', footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; width?: string; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-ink/30 backdrop-blur-[1px]" onClick={onClose} aria-hidden />
      <aside role="dialog" aria-modal="true" aria-label={typeof title === 'string' ? title : undefined} className={cn('relative flex h-full w-full flex-col bg-surface shadow-pop', width)}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-muted hover:bg-sunken hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto p-5">{children}</div>
        {footer && <div className="border-t border-line bg-canvas px-5 py-3">{footer}</div>}
      </aside>
    </div>
  )
}

export function KeyValue({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="min-w-0 text-ink">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

export const tableCls = {
  wrap: 'overflow-x-auto scroll-thin',
  table: 'w-full text-left text-[13.5px]',
  th: 'whitespace-nowrap border-b border-line bg-canvas/70 px-4 py-2 text-[12px] font-semibold tracking-wide text-muted uppercase',
  td: 'border-b border-line px-4 py-2.5 align-top',
}
