import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach } from 'vitest'
import { cleanup } from '@testing-library/react'
import { __resetDemoForTests } from '@/demo/service'
import { useTour } from '@/lib/store'

// jsdom lacks the browser APIs used by Recharts / React Flow.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver
class DOMMatrixStub {
  m22 = 1
  constructor() {}
}
;(globalThis as { DOMMatrixReadOnly?: unknown }).DOMMatrixReadOnly ??= DOMMatrixStub
Element.prototype.scrollIntoView ??= function () {}

beforeEach(() => {
  localStorage.clear()
  __resetDemoForTests()
  useTour.setState({ done: [] })
})

afterEach(() => {
  cleanup()
})
