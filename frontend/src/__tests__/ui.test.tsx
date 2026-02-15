import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { TestApp } from '@/App'
import { NAV_ITEMS } from '@/lib/nav'
import { demoApi } from '@/demo/service'
import { STORAGE_KEY } from '@/demo/state'
import { useTour } from '@/lib/store'

const renderAt = (path: string) => render(<TestApp initialEntries={[path]} />)
const h1 = (name: RegExp | string) => screen.findByRole('heading', { level: 1, name })

describe('navigation', () => {
  it('landing page links into the workspace and labels demo mode', async () => {
    renderAt('/')
    expect(await screen.findByRole('heading', { level: 1, name: /Annual reports in/ })).toBeInTheDocument()
    expect(screen.getAllByText(/Demo \/ Mock Mode/i).length).toBeGreaterThan(0)
    const demoLink = screen.getAllByRole('link', { name: /Try the (guided )?demo/i })[0]
    expect(demoLink).toHaveAttribute('href', '/app/walkthrough')
  })

  it('exposes every page in the side navigation and each one renders', async () => {
    const user = userEvent.setup()
    renderAt('/app')
    await h1('Dashboard')
    expect(NAV_ITEMS).toHaveLength(14)
    const titles: Record<string, RegExp | string> = {
      '/app/walkthrough': 'Guided walkthrough',
      '/app/documents': 'Documents',
      '/app/specs': 'Specs Catalog',
      '/app/prompts': 'Prompt Studio',
      '/app/workflow': 'Agent Workflow',
      '/app/retrieval': 'Retrieval Explorer',
      '/app/extraction': 'Extraction Workbench',
      '/app/chat': 'Research Chat',
      '/app/review': 'Review Queue',
      '/app/evaluation': 'Evaluation Lab',
      '/app/versions': 'Version Registry',
      '/app/monitoring': /Monitoring/,
      '/app/settings': 'Settings',
    }
    const nav = screen.getByRole('navigation', { name: 'Primary' })
    for (const item of NAV_ITEMS.filter((n) => n.to !== '/app')) {
      await user.click(within(nav).getByRole('link', { name: item.label }))
      await h1(titles[item.to])
    }
  })

  it('shows the Demo/Mock Mode banner and a working Reset demo control inside the app', async () => {
    renderAt('/app')
    await h1('Dashboard')
    expect(screen.getAllByText(/Demo \/ Mock Mode/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /reset demo/i })).toBeInTheDocument()
  })
})

describe('extraction workbench (scenario A)', () => {
  it('auto-runs Northstar FY2024 Revenue and shows the value and evidence', async () => {
    const user = userEvent.setup()
    renderAt('/app/extraction?scenario=A')
    const row = await screen.findByTestId('result-row')
    expect(row).toHaveTextContent('Northstar FY2024')
    expect(row).toHaveTextContent('$9,967,000,000')
    expect(row).toHaveTextContent('Found')
    await user.click(within(row).getByRole('button', { name: /Northstar FY/ }))
    const dialog = await screen.findByRole('dialog')
    expect(await within(dialog).findByText(/Reported number appears verbatim/)).toBeInTheDocument()
    expect(within(dialog).getAllByText(/9,967\.0/).length).toBeGreaterThan(0)
    await waitFor(() => expect(useTour.getState().done).toContain('A'))
  })

  it('refuses unavailable paid providers in the agent list', async () => {
    renderAt('/app/extraction')
    const paid = (await screen.findAllByText(/OpenAI Responses API - unavailable/)) as HTMLOptionElement[]
    expect(paid.length).toBe(2) // OpenAI + Azure OpenAI
    for (const o of paid) {
      expect(o.tagName).toBe('OPTION')
      expect(o).toBeDisabled()
    }
  })
})

describe('prompt studio', () => {
  it('explains that free-form edits do not affect mock extraction and renders a prompt from the spec', async () => {
    renderAt('/app/prompts')
    expect(await screen.findByText(/free-form prompt text does not change mock extraction/i)).toBeInTheDocument()
    const rendered = await screen.findByTestId('rendered-user-prompt')
    expect(rendered).toHaveTextContent('spec_key="revenue"')
    expect(rendered).toHaveTextContent('Northstar Energy')
  })

  it('a candidate control change alters the outcome (scenario C)', async () => {
    const user = userEvent.setup()
    renderAt('/app/prompts?scenario=C')
    const toggle = await screen.findByRole('switch', { name: /Respect exclusion terms/ })
    await waitFor(() => expect(screen.getByLabelText('Specification')).toHaveValue('scope_2'))
    await user.click(toggle)
    await user.click(screen.getByRole('button', { name: /Test candidate/ }))
    expect(await screen.findByText(/changes the outcome/i)).toBeInTheDocument()
    await waitFor(() => expect(useTour.getState().done).toContain('C'))
  })
})

describe('review queue (scenario D)', () => {
  it('corrects a value, saves it and lists it in history', async () => {
    const user = userEvent.setup()
    renderAt('/app/review?scenario=D')
    await screen.findAllByTestId('queue-item')
    const save = await screen.findByRole('button', { name: /Save decision/ })
    await waitFor(() => expect(screen.getByRole('radio', { name: /Correct/ })).toHaveAttribute('aria-checked', 'true'))
    await waitFor(() => expect(save).toBeEnabled())
    await user.click(save)
    await waitFor(() => expect(useTour.getState().done).toContain('D'))
    await user.click(screen.getByRole('tab', { name: /History/ }))
    const table = await screen.findByTestId('review-history')
    expect(within(table).getByText('correct')).toBeInTheDocument()
    const reviews = await demoApi.listReviews()
    expect(reviews).toHaveLength(1)
    expect(reviews[0].decision).toBe('correct')
  })
})

describe('evaluation lab (scenario E)', () => {
  it('shows improved and regressed cases and blocks promotion', async () => {
    renderAt('/app/evaluation?scenario=E')
    const gate = await screen.findByTestId('release-gate')
    expect(within(gate).getByText('Promotion blocked')).toBeInTheDocument()
    expect(within(gate).getByRole('button', { name: /Promote v3/ })).toBeDisabled()
    const rows = await screen.findAllByTestId('change-row')
    expect(rows.some((r) => r.getAttribute('data-change') === 'improved')).toBe(true)
    expect(rows.some((r) => r.getAttribute('data-change') === 'regressed')).toBe(true)
    await waitFor(() => expect(useTour.getState().done).toContain('E'))
  })
})

describe('research chat (scenario F)', () => {
  it('answers with a citation, then refuses an unsupported question', async () => {
    const user = userEvent.setup()
    renderAt('/app/chat?scenario=F')
    const first = await screen.findByTestId('assistant-answer')
    expect(first).toHaveTextContent('Grounded')
    expect(first).toHaveTextContent(/9,967\.0/)
    expect(within(first).getByText(/Sources \(/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Your question'), 'Who is the CEO of Northstar Energy?')
    await user.click(screen.getByRole('button', { name: /Ask/ }))
    await waitFor(() => expect(screen.getAllByTestId('assistant-answer')).toHaveLength(2))
    const second = screen.getAllByTestId('assistant-answer')[1]
    expect(second).toHaveTextContent(/Insufficient evidence/i)
    await waitFor(() => expect(useTour.getState().done).toContain('F'))
  })
})

describe('retrieval explorer (scenario B)', () => {
  it('shows extra graph-expanded chunks next to the direct hits', async () => {
    renderAt('/app/retrieval?scenario=B')
    await waitFor(() => expect(screen.getAllByTestId('hit').length).toBeGreaterThan(2))
    const graphHits = screen.getAllByTestId('hit').filter((h) => h.getAttribute('data-via') === 'graph')
    expect(graphHits.length).toBeGreaterThan(0)
    expect(screen.getByText(/Graph expansion added/)).toBeInTheDocument()
  })
})

describe('reset demo', () => {
  it('clears persisted review decisions and progress', async () => {
    const user = userEvent.setup()
    const q = await demoApi.reviewQueue()
    await demoApi.submitReview({ result: q[0].id, decision: 'reject', comment: 'x' })
    useTour.getState().complete('D')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).reviews).toHaveLength(1)

    renderAt('/app')
    await h1('Dashboard')
    await user.click(screen.getByRole('button', { name: /reset demo/i }))
    const dialog = await screen.findByRole('alertdialog')
    await user.click(within(dialog).getByRole('button', { name: /^Reset demo$/ }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    expect(await demoApi.listReviews()).toHaveLength(0)
    expect((await demoApi.reviewQueue()).length).toBe(q.length)
    expect(useTour.getState().done).toEqual([])
  })
})

describe('other pages', () => {
  it('agent workflow traces a request through every stage', async () => {
    const user = userEvent.setup()
    renderAt('/app/workflow')
    await h1('Agent Workflow')
    await waitFor(() => expect(screen.getByRole('button', { name: /Trace/ })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: /Trace/ }))
    const trace = await screen.findByTestId('trace')
    expect(trace).toHaveTextContent('Retrieve')
    expect(trace).toHaveTextContent('Validate')
    expect(trace).toHaveTextContent('$8,791,000,000') // Northstar FY2022 (first report)
  })

  it('document viewer highlights the evidence span from a deep link', async () => {
    const d = (await demoApi.listDocuments()).find((x) => x.company_name === 'Northstar Energy' && x.fiscal_year === 2024)!
    const detail = await demoApi.getDocument(d.id)
    const at = detail.raw_text.indexOf('| Revenue | 9,967.0')
    renderAt(`/app/documents/${d.id}?start=${at}&end=${at + 40}`)
    await screen.findByText('Evidence highlighted')
    await waitFor(() => expect(document.querySelector('mark[data-evidence]')?.textContent).toBe(detail.raw_text.slice(at, at + 40)))
  })

  it('version registry refuses to promote the regressing candidate', async () => {
    const user = userEvent.setup()
    renderAt('/app/versions')
    const rows = await screen.findAllByTestId('version-row')
    const v3 = rows.find((r) => r.textContent?.includes('concise matching'))!
    await user.click(within(v3).getByRole('button', { name: /Promote/ }))
    expect(await screen.findByText(/Promotion blocked/)).toBeInTheDocument()
    const tpl = (await demoApi.listPromptTemplates())[0]
    expect(tpl.versions.find((v) => v.status === 'active')!.version).toBe(2)
  })

  it('editing a specification changes subsequent extraction', async () => {
    const d = (await demoApi.listDocuments()).find((x) => x.company_name === 'Northstar Energy' && x.fiscal_year === 2024)!
    await demoApi.updateSpecification('revenue', { aliases: ['Sales proceeds'] })
    const { results } = await demoApi.createRun({ document_ids: [d.id], specification_keys: ['revenue'], dry_run: true })
    expect(results[0].status).toBe('not_found')
  })

  it('settings reports mock-only providers', async () => {
    renderAt('/app/settings')
    await h1('Settings')
    expect(await screen.findAllByText('not configured')).toHaveLength(2) // openai + azure; only the offline mock provider is active
  })
})
