import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export const WALKTHROUGH_STEPS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const
export type StepId = (typeof WALKTHROUGH_STEPS)[number]

interface TourState {
  done: StepId[]
  complete: (id: StepId) => void
  reset: () => void
}

/** Walkthrough progress (UI-only; cleared by "Reset demo"). */
export const useTour = create<TourState>()(
  persist(
    (set) => ({
      done: [],
      complete: (id) => set((s) => (s.done.includes(id) ? s : { done: [...s.done, id] })),
      reset: () => set({ done: [] }),
    }),
    { name: 'finspec-tour-v1' },
  ),
)

interface ToastItem {
  id: number
  tone: 'ok' | 'bad' | 'info'
  message: string
}
interface ToastState {
  items: ToastItem[]
  push: (tone: ToastItem['tone'], message: string) => void
  dismiss: (id: number) => void
}
let nextToast = 1
export const useToasts = create<ToastState>((set) => ({
  items: [],
  push: (tone, message) => {
    const id = nextToast++
    set((s) => ({ items: [...s.items, { id, tone, message }].slice(-4) }))
    setTimeout(() => set((s) => ({ items: s.items.filter((t) => t.id !== id) })), 5200)
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((t) => t.id !== id) })),
}))
