/**
 * features/planner/components/ReadinessPanel.test.tsx
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 03: the COBRA go-live readiness checklist.
 *
 * The SERVICE is mocked (real `ReadinessError` kept), so `@/core/services/api` is
 * never touched. The centerpiece is NFR-001: every status is asserted as WORDS in
 * the DOM (text, not color), with a decorative icon alongside.
 *
 * Rendered in the COBRA `ThemeProvider`, a React Query client and a
 * `MemoryRouter` (fix links navigate).
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { ReadinessPanel } from './ReadinessPanel'
import {
  ReadinessError,
  getReadiness,
  type ExerciseReadiness,
} from '../services/readinessService'

vi.mock('../services/readinessService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/readinessService')>()
  return { ...actual, getReadiness: vi.fn() }
})

const mockGet = vi.mocked(getReadiness)

const MIXED: ExerciseReadiness = {
  ready: false,
  lifecycleState: 'build',
  blocking: [
    { id: 'controller-enrolled', label: 'Controller enrolled', status: 'ok', detail: null },
    { id: 'schedule-set', label: 'Schedule set', status: 'open', detail: 'No start time yet.' },
    { id: 'chrome-valid', label: 'Chrome valid', status: 'ok', detail: null },
    { id: 'participant-access', label: 'Participants can get in', status: 'open', detail: null },
    { id: 'participant-name', label: 'Participant name', status: 'open', detail: 'No name set.' },
    { id: 'sign-in-methods', label: 'Sign-in on', status: 'notChecked', detail: 'Arrives later' },
    { id: 'brand-new-check', label: 'A check from the future', status: 'open', detail: null },
  ],
  warnings: [
    { id: 'lead-controller', label: 'Lead controller set', status: 'open', detail: 'No lead.' },
    { id: 'noise-pool', label: 'Noise pool', status: 'ok', detail: null },
  ],
}

const READY: ExerciseReadiness = {
  ready: true,
  lifecycleState: 'build',
  blocking: [
    { id: 'controller-enrolled', label: 'Controller enrolled', status: 'ok', detail: null },
    { id: 'sign-in-methods', label: 'Sign-in methods', status: 'notChecked', detail: null },
  ],
  warnings: [],
}

function renderPanel() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>
          <MemoryRouter>{children}</MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ReadinessPanel />, { wrapper: Wrapper })
}

function row(id: string): HTMLElement {
  return screen.getByTestId(`readiness-item-${id}`)
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('ReadinessPanel', () => {
  it('states each status in WORDS, with a decorative icon, never by color alone', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    expect(within(row('controller-enrolled')).getByText('Done')).toBeInTheDocument()
    expect(within(row('schedule-set')).getByText('Needs attention')).toBeInTheDocument()
    expect(within(row('sign-in-methods')).getByText('Not checked yet')).toBeInTheDocument()
    expect(within(row('sign-in-methods')).getByText('Arrives later')).toBeInTheDocument()

    for (const id of ['controller-enrolled', 'schedule-set', 'sign-in-methods']) {
      const icon = row(id).querySelector('svg')
      expect(icon).not.toBeNull()
      expect(icon).toHaveAttribute('aria-hidden', 'true')
    }
  })

  it('uses a different icon for ok, open and notChecked', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    const iconOf = (id: string) => row(id).querySelector('svg')?.getAttribute('data-icon')
    const icons = new Set([
      iconOf('controller-enrolled'),
      iconOf('schedule-set'),
      iconOf('sign-in-methods'),
    ])
    expect(icons.size).toBe(3)
  })

  it('renders semantic lists under Blocking and Warnings headings', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    expect(screen.getByRole('heading', { level: 2, name: 'Readiness' })).toBeInTheDocument()
    const blocking = screen.getByRole('region', { name: 'Blocking' })
    const warnings = screen.getByRole('region', { name: 'Warnings' })
    expect(within(blocking).getByRole('heading', { level: 3 })).toHaveTextContent('Blocking')
    expect(within(blocking).getAllByRole('listitem')).toHaveLength(MIXED.blocking.length)
    expect(within(warnings).getAllByRole('listitem')).toHaveLength(MIXED.warnings.length)
  })

  it('counts only open blocking items; notChecked never blocks', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()

    // 4 open (schedule-set, participant-access, participant-name, brand-new-check);
    // the 1 notChecked is excluded.
    expect(await screen.findByText('4 blocking items open')).toBeInTheDocument()
    expect(screen.getByTestId('readiness-summary')).toHaveAttribute('role', 'status')
  })

  it('says "Ready to stage" when nothing blocking is open, even with notChecked items', async () => {
    mockGet.mockResolvedValue(READY)
    renderPanel()

    expect(await screen.findByText('Ready to stage')).toBeInTheDocument()
    expect(within(row('sign-in-methods')).getByText('Not checked yet')).toBeInTheDocument()
  })

  it('uses the singular for one blocking item', async () => {
    mockGet.mockResolvedValue({
      ...READY,
      ready: false,
      blocking: [{ id: 'schedule-set', label: 'Schedule set', status: 'open', detail: null }],
    })
    renderPanel()
    expect(await screen.findByText('1 blocking item open')).toBeInTheDocument()
  })

  it('renders an item with an id it has never heard of, with no fix link', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    const unknown = row('brand-new-check')
    expect(within(unknown).getByText('A check from the future')).toBeInTheDocument()
    expect(within(unknown).queryByRole('link')).toBeNull()
  })

  it('offers a fix link only for mapped ids that are not done', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    const schedule = within(row('schedule-set')).getByRole('link')
    expect(schedule).toHaveAttribute('href', '/staff/plan?section=identity')
    const access = within(row('participant-access')).getByRole('link')
    expect(access).toHaveAttribute('href', '/staff/participant-admin')

    // mapped but done -> no link; unmapped (warning) -> no link; notChecked unmapped -> none
    expect(within(row('chrome-valid')).queryByRole('link')).toBeNull()
    expect(within(row('lead-controller')).queryByRole('link')).toBeNull()
    expect(within(row('sign-in-methods')).queryByRole('link')).toBeNull()
  })

  it('links the open participant-name item to the Identity section (story 09)', async () => {
    mockGet.mockResolvedValue(MIXED)
    renderPanel()
    await screen.findByTestId('readiness-blocking')

    expect(within(row('participant-name')).getByText('Needs attention')).toBeInTheDocument()
    expect(within(row('participant-name')).getByRole('link')).toHaveAttribute(
      'href',
      '/staff/plan?section=identity',
    )
  })

  it('shows an error with a working retry', async () => {
    const user = userEvent.setup()
    mockGet.mockRejectedValueOnce(new ReadinessError('boom', { status: 403 }))
    renderPanel()

    const alert = await screen.findByTestId('readiness-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/not allowed/i)

    mockGet.mockResolvedValueOnce(READY)
    await user.click(within(alert).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Ready to stage')).toBeInTheDocument()
    expect(screen.queryByTestId('readiness-load-error')).toBeNull()
  })

  it('Refresh refetches and the summary live region reflects the new outcome', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce(MIXED)
    renderPanel()
    await screen.findByText('4 blocking items open')

    mockGet.mockResolvedValueOnce(READY)
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await waitFor(() => expect(screen.getByTestId('readiness-summary')).toHaveTextContent('Ready to stage'))
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('never shows the last "Ready to stage" beside a failed refresh', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce(READY)
    renderPanel()
    await screen.findByText('Ready to stage')

    mockGet.mockRejectedValueOnce(new ReadinessError('boom', { status: 500 }))
    await user.click(screen.getByRole('button', { name: 'Refresh' }))

    await screen.findByTestId('readiness-load-error')
    expect(screen.queryByText('Ready to stage')).toBeNull()
    expect(screen.queryByTestId('readiness-blocking')).toBeNull()
  })

  it('keeps the Refresh button focusable while a refresh is in flight', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValueOnce(READY)
    renderPanel()
    await screen.findByText('Ready to stage')

    mockGet.mockImplementation(() => new Promise(() => {}))
    const refresh = screen.getByRole('button', { name: 'Refresh' })
    await user.click(refresh)

    const busy = await screen.findByRole('button', { name: /refreshing/i })
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).not.toBeDisabled()
  })

  it('shows a loading state before data arrives', () => {
    mockGet.mockImplementation(() => new Promise(() => {}))
    renderPanel()
    expect(screen.getByText(/loading readiness/i)).toBeInTheDocument()
  })
})
