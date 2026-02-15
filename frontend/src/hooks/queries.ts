import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, type ResultFilters } from '@/lib/api'

export const useCompanies = () => useQuery({ queryKey: ['companies'], queryFn: () => api.listCompanies() })
export const useDocuments = () => useQuery({ queryKey: ['documents'], queryFn: () => api.listDocuments() })
export const useSpecifications = () => useQuery({ queryKey: ['specifications'], queryFn: () => api.listSpecifications() })
export const usePromptTemplates = () => useQuery({ queryKey: ['prompts'], queryFn: () => api.listPromptTemplates() })
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api.listAgents() })
export const useRuns = () => useQuery({ queryKey: ['runs'], queryFn: () => api.listRuns() })
export const useResults = (filters: ResultFilters = {}, enabled = true) =>
  useQuery({ queryKey: ['results', filters], queryFn: () => api.listResults(filters), enabled, placeholderData: keepPreviousData })
export const useReviewQueue = (runId?: number) => useQuery({ queryKey: ['review-queue', runId], queryFn: () => api.reviewQueue(runId) })
export const useReviews = () => useQuery({ queryKey: ['reviews'], queryFn: () => api.listReviews() })
export const useEvalDatasets = () => useQuery({ queryKey: ['eval-datasets'], queryFn: () => api.listEvaluationDatasets() })
export const useEvalRuns = () => useQuery({ queryKey: ['eval-runs'], queryFn: () => api.listEvaluationRuns() })
export const useAudit = (params: { q?: string; action_prefix?: string } = {}) => useQuery({ queryKey: ['audit', params], queryFn: () => api.listAudit(params) })
export const useMonitoring = () => useQuery({ queryKey: ['monitoring'], queryFn: () => api.monitoring() })
export const useProviderStatus = () => useQuery({ queryKey: ['provider-status'], queryFn: () => api.providerStatus() })
export const useHealth = () => useQuery({ queryKey: ['health'], queryFn: () => api.health() })

/** Invalidate every cached server view after any mutation (state is small and interdependent). */
export function useRefreshAll() {
  const qc = useQueryClient()
  return () => qc.invalidateQueries()
}

export function useResetDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.resetDemo(),
    onSuccess: () => {
      qc.clear()
      qc.invalidateQueries()
    },
  })
}
