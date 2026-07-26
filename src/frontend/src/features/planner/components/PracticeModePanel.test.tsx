/**
 * features/planner/components/PracticeModePanel.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (practice/sandbox flag — exercise-configuration; #41 / story #70):
 * the COBRA staff practice-mode control.
 *
 * The SERVICE is mocked (keeping the real `PracticeModeError` class via
 * `importOriginal`), so every test drives the panel through a controlled seam
 * and `@/core/services/api` is never touched — no real axios sink, no Vitest
 * worker-teardown footgun.
 *
 * The centrepiece is NFR-001: a rehearsal must never be mistaken for real
 * conduct, so the indicator is asserted to carry an ICON **and** TEXT that
 * differ between the two states — never color alone.
 *
 * Rendered inside the COBRA `ThemeProvider` (this is a STAFF surface — COBRA is
 * correct here) + a React Query client, exactly as the settings page mounts it.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { PracticeModePanel } from './PracticeModePanel'
import {
  PracticeModeError,
  getPracticeMode,
  setPracticeMode,
  type PracticeModeState,
} from '../services/practiceModeService'

vi.mock('../services/practiceModeService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/practiceModeService')>()
  return { ...actual, getPracticeMode: vi.fn(), setPracticeMode: vi.fn() }
})

const mockGet = vi.mocked(getPracticeMode)
const mockSet = vi.mocked(setPracticeMode)

const UNFLAGGED: PracticeModeState = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  isPracticeMode: false,
  evaluationEligible: true,
}

const FLAGGED: PracticeModeState = {
  exerciseId: '6f0a1c52-9d4b-4f3a-8a01-2c7d9e5b1a44',
  isPracticeMode: true,
  evaluationEligible: false,
}

function renderPanel() {
  const queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false }, queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<PracticeModePanel />, { wrapper: Wrapper })
}

/** Waits for the loaded control. */
async function renderLoadedPanel() {
  renderPanel()
  await screen.findByTestId('practice-mode-form')
}

const checkbox = () => screen.getByRole('checkbox', { name: /practice \/ sandbox/i })
const saveButton = () => screen.getByRole('button', { name: /save practice mode/i })

/**
 * The variables the panel submitted (fails loudly if it never submitted).
 * React Query 5 hands the mutation function a context object as a SECOND
 * argument, so the assertion targets the variables rather than the whole call.
 */
function submittedUpdate(): unknown {
  const call = mockSet.mock.calls[0]
  if (!call) throw new Error('the panel did not submit a practice-mode update')
  return call[0]
}

beforeEach(() => {
  mockGet.mockReset()
  mockSet.mockReset()
  mockGet.mockResolvedValue(UNFLAGGED)
  mockSet.mockResolvedValue(FLAGGED)
})

// ---------------------------------------------------------------------------

describe('PracticeModePanel — load states', () => {
  it('announces loading in a status region while the flag is in flight', () => {
    mockGet.mockReturnValue(new Promise<PracticeModeState>(() => {}))
    renderPanel()

    const loading = screen.getByTestId('practice-mode-loading')
    expect(loading).toHaveAttribute('role', 'status')
    expect(loading).toHaveTextContent(/loading practice mode/i)
  })

  it('reports a load failure with an icon and text, not color alone', async () => {
    mockGet.mockRejectedValue(new PracticeModeError('nope', { status: 403 }))
    renderPanel()

    const alert = await screen.findByTestId('practice-mode-load-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/not assigned to this exercise/i)
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
  })
})

describe('PracticeModePanel — the indicator (NFR-001: never color-only)', () => {
  it('states REAL CONDUCT with an icon and text for an exercise that was never flagged', async () => {
    await renderLoadedPanel()

    const indicator = screen.getByTestId('practice-mode-indicator')
    expect(indicator).toHaveAttribute('role', 'status')
    expect(indicator).toHaveTextContent(/real conduct/i)
    expect(indicator.querySelector('svg[data-icon="circle-check"]')).not.toBeNull()
    expect(checkbox()).not.toBeChecked()
  })

  it('states PRACTICE / SANDBOX with a DIFFERENT icon and DIFFERENT text when flagged', async () => {
    mockGet.mockResolvedValue(FLAGGED)
    await renderLoadedPanel()

    const indicator = screen.getByTestId('practice-mode-indicator')
    expect(indicator).toHaveTextContent(/practice \/ sandbox/i)
    // The state is legible from the icon AND the words — a monochrome or
    // color-blind reading still tells the two states apart.
    expect(indicator.querySelector('svg[data-icon="flask"]')).not.toBeNull()
    expect(indicator.querySelector('svg[data-icon="circle-check"]')).toBeNull()
    expect(checkbox()).toBeChecked()
  })

  it('renders the server eligibility verdict rather than re-deriving it from the flag', async () => {
    // A (contrived) server that reports "flagged but still eligible" must be
    // rendered as the server said: the export rule lives on the server, and a
    // client that re-derived it could disagree with the export.
    mockGet.mockResolvedValue({ ...FLAGGED, evaluationEligible: true })
    await renderLoadedPanel()

    expect(screen.getByTestId('practice-mode-indicator')).toHaveTextContent(/practice \/ sandbox/i)
    expect(screen.getByTestId('practice-mode-eligibility')).toHaveTextContent(/included in evaluation exports/i)
  })

  it('says the excluded-from-exports consequence in words when flagged', async () => {
    mockGet.mockResolvedValue(FLAGGED)
    await renderLoadedPanel()

    expect(screen.getByTestId('practice-mode-eligibility')).toHaveTextContent(
      /excluded from evaluation exports/i,
    )
  })
})

describe('PracticeModePanel — writing the flag', () => {
  it('sends the explicit boolean and nothing else', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    await user.click(checkbox())
    await user.click(saveButton())

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(submittedUpdate()).toEqual({ isPracticeMode: true })
  })

  it('re-renders from the SERVER response after a save', async () => {
    const user = userEvent.setup()
    await renderLoadedPanel()

    expect(screen.getByTestId('practice-mode-indicator')).toHaveTextContent(/real conduct/i)

    await user.click(checkbox())
    await user.click(saveButton())

    const saved = await screen.findByTestId('practice-mode-saved')
    expect(saved).toHaveAttribute('role', 'status')
    expect(screen.getByTestId('practice-mode-indicator')).toHaveTextContent(/practice \/ sandbox/i)
  })

  it('clears the flag with an explicit false', async () => {
    const user = userEvent.setup()
    mockGet.mockResolvedValue(FLAGGED)
    mockSet.mockResolvedValue(UNFLAGGED)
    await renderLoadedPanel()

    await user.click(checkbox())
    await user.click(saveButton())

    await waitFor(() => expect(mockSet).toHaveBeenCalledTimes(1))
    expect(submittedUpdate()).toEqual({ isPracticeMode: false })
  })

  it('keeps the save button disabled until the planner actually changes the flag', async () => {
    await renderLoadedPanel()

    expect(saveButton()).toBeDisabled()
  })

  it('reports a save failure with an icon and text, and leaves the stored state showing', async () => {
    const user = userEvent.setup()
    mockSet.mockRejectedValue(new PracticeModeError('nope', { status: 401 }))
    await renderLoadedPanel()

    await user.click(checkbox())
    await user.click(saveButton())

    const alert = await screen.findByTestId('practice-mode-save-error')
    expect(alert).toHaveAttribute('role', 'alert')
    expect(alert).toHaveTextContent(/staff session is not active/i)
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.getByTestId('practice-mode-indicator')).toHaveTextContent(
      /real conduct/i,
    )
  })
})
