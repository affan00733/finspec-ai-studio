/**
 * API entry point. When `VITE_API_URL` is set the Django backend is used; otherwise the whole product runs
 * on the in-browser demo engine with bundled synthetic data (no backend, no API keys).
 */
import { demoApi } from '@/demo/service'
import type { FinSpecApi } from './apiTypes'
import { createHttpApi } from './httpApi'

export type { FinSpecApi, NewVersionInput, ResultFilters } from './apiTypes'

export function resolveApi(env: { VITE_API_URL?: string } = import.meta.env): FinSpecApi {
  const url = env.VITE_API_URL?.trim()
  return url ? createHttpApi(url) : demoApi
}

export const api: FinSpecApi = resolveApi()
export const isDemoMode = api.mode === 'demo'
