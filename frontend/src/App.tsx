import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes, MemoryRouter, type MemoryRouterProps } from 'react-router-dom'
import { AppShell, Toasts } from '@/components/AppShell'
import { Spinner } from '@/components/ui'
import Landing from '@/pages/Landing'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Walkthrough = lazy(() => import('@/pages/Walkthrough'))
const Documents = lazy(() => import('@/pages/Documents'))
const Specs = lazy(() => import('@/pages/Specs'))
const PromptStudio = lazy(() => import('@/pages/PromptStudio'))
const AgentWorkflow = lazy(() => import('@/pages/AgentWorkflow'))
const RetrievalExplorer = lazy(() => import('@/pages/RetrievalExplorer'))
const ExtractionWorkbench = lazy(() => import('@/pages/ExtractionWorkbench'))
const ResearchChat = lazy(() => import('@/pages/ResearchChat'))
const ReviewQueue = lazy(() => import('@/pages/ReviewQueue'))
const EvaluationLab = lazy(() => import('@/pages/EvaluationLab'))
const VersionRegistry = lazy(() => import('@/pages/VersionRegistry'))
const Monitoring = lazy(() => import('@/pages/Monitoring'))
const SettingsPage = lazy(() => import('@/pages/Settings'))
const NotFound = lazy(() => import('@/pages/NotFound'))

export function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { staleTime: 5_000, refetchOnWindowFocus: false, retry: false } } })
}

export function AppRoutes() {
  return (
    <Suspense fallback={<Spinner label="Loading page" />}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<AppShell />}>
          <Route index element={<Dashboard />} />
          <Route path="walkthrough" element={<Walkthrough />} />
          <Route path="documents" element={<Documents />} />
          <Route path="documents/:id" element={<Documents />} />
          <Route path="specs" element={<Specs />} />
          <Route path="prompts" element={<PromptStudio />} />
          <Route path="workflow" element={<AgentWorkflow />} />
          <Route path="retrieval" element={<RetrievalExplorer />} />
          <Route path="extraction" element={<ExtractionWorkbench />} />
          <Route path="chat" element={<ResearchChat />} />
          <Route path="review" element={<ReviewQueue />} />
          <Route path="evaluation" element={<EvaluationLab />} />
          <Route path="versions" element={<VersionRegistry />} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="*" element={<NotFound />} />
        </Route>
        <Route path="*" element={<NotFound standalone />} />
      </Routes>
    </Suspense>
  )
}

export default function App() {
  const client = makeQueryClient()
  return (
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      <Toasts />
    </QueryClientProvider>
  )
}

/** Test helper: the full app on an in-memory router. */
export function TestApp({ initialEntries = ['/'] }: { initialEntries?: MemoryRouterProps['initialEntries'] }) {
  const client = makeQueryClient()
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={initialEntries}>
        <AppRoutes />
      </MemoryRouter>
      <Toasts />
    </QueryClientProvider>
  )
}
