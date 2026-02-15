import { cn } from '@/lib/cn'

export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg viewBox="0 0 32 32" className="size-8" aria-hidden>
        <rect width="32" height="32" rx="8" fill="#243bb5" />
        <path d="M9 22V10h10M9 16h7" stroke="#fff" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <circle cx="22.5" cy="21.5" r="2.6" fill="#9db4ff" />
      </svg>
      {!compact && (
        <span className="leading-none">
          <span className="font-display block text-[17px] font-semibold tracking-tight text-ink">FinSpec</span>
          <span className="block pt-0.5 text-[10.5px] font-semibold tracking-[0.14em] text-muted uppercase">AI Studio</span>
        </span>
      )}
    </span>
  )
}
