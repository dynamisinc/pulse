/**
 * features/planner/components/StageExerciseControl.test.tsx
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 04: the planner's gated Stage exercise control and its COBRA
 * confirm dialog. The lifecycle and readiness SERVICES are mocked (the real typed
 * `LifecycleError` is kept) and the exercise scope is stubbed, so no network is touched; the
 * real hook, queries, dialog and live region run.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import {
  LifecycleError,
  fetchLifecycle,
  postTransition,
  type ExerciseLifecycle,
} from '@/features/controller/lifecycle/lifecycleService'
import { getReadiness, type ExerciseReadiness } from '../services/readinessService'
import { StageExerciseControl } from './StageExerciseControl'

vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
  warnIfMockDataActive: () => undefined,
}))
vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useExerciseContext: () => ({ exerciseId: 'ex-1', status: 'build', exerciseName: 'Harbor Storm' }),
  useExerciseScopeRefresh: () => async () => undefined,
}))
vi.mock('@/features/controller/lifecycle/lifecycleService', async importOriginal => ({
  ...(await importOriginal<typeof import('@/features/controller/lifecycle/lifecycleService')>()),
  fetchLifecycle: vi.fn(),
  postTransition: vi.fn(),
}))
vi.mock('../services/readinessService', async importOriginal => ({
  ...(await importOriginal<typeof import('../services/readinessService')>()),
  getReadiness: vi.fn(),
}))

const mockLifecycle = vi.mocked(fetchLifecycle)
const mockPost = vi.mocked(postTransition)
const mockReadiness = vi.mocked(getReadiness)

const open = { id: 'schedule-set', label: 'Schedule set', status: 'open', detail: null } as const
const done = { id: 'controller-enrolled', label: 'Controller', status: 'ok', detail: null } as const
const BLOCKED: ExerciseReadiness = {
  ready: false,
  lifecycleState: 'build',
  blocking: [done, open],
  warnings: [],
}
const READY: ExerciseReadiness = {
  ready: true,
  lifecycleState: 'build',
  blocking: [done],
  warnings: [],
}

const inState = (
  state: ExerciseLifecycle['state'],
  allowed: ExerciseLifecycle['allowedTransitions'],
): ExerciseLifecycle => ({ exerciseId: 'ex-1', state, allowedTransitions: allowed })

function renderControl() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<StageExerciseControl />, { wrapper: Wrapper })
}

/** Renders ready and waits for the Stage button to become pressable. */
async function renderReady() {
  const user = userEvent.setup()
  renderControl()
  const button = await screen.findByRole('button', { name: /stage exercise/i })
  await waitFor(() => expect(button).toHaveAttribute('aria-disabled', 'false'))
  return { user, button }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockLifecycle.mockResolvedValue(inState('build', ['staged']))
  mockReadiness.mockResolvedValue(READY)
})

describe('StageExerciseControl', () => {
  it.each([
    [
      'staged',
      inState('staged', ['live']),
      /This exercise is staged\. A controller starts it from the console\./,
    ],
    ['live', inState('live', ['paused', 'completed']), /This exercise is live\./],
  ])('hides the button outside build (%s) and says where things stand', async (_n, lc, text) => {
    mockLifecycle.mockResolvedValue(lc)
    renderControl()
    expect(await screen.findByText(text)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /stage exercise/i })).not.toBeInTheDocument()
  })

  it('is aria-disabled (still focusable) with a visible reason while blocking items are open', async () => {
    mockReadiness.mockResolvedValue(BLOCKED)
    const user = userEvent.setup()
    renderControl()
    const button = await screen.findByRole('button', { name: /stage exercise/i })
    await waitFor(() =>
      expect(screen.getByTestId('stage-exercise-reason')).toHaveTextContent(
        'Staging is unavailable: 1 blocking item is still open.',
      ),
    )
    expect(button).toHaveAttribute('aria-disabled', 'true')
    expect(button).toHaveAccessibleDescription(/1 blocking item is still open/)
    button.focus()
    expect(button).toHaveFocus()
    await user.click(button)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opens the dialog with the exact title and body when ready', async () => {
    const { user, button } = await renderReady()
    await user.click(button)
    const dialog = await screen.findByRole('dialog', { name: 'Stage Harbor Storm?' })
    expect(dialog).toHaveTextContent(
      'Participants will be able to sign in and see the ambient world. ' +
        'The clock does not start until a controller starts the exercise.',
    )
    expect(within(dialog).getByTestId('stage-dialog-readiness')).toHaveTextContent(
      'Readiness: all blocking items are done.',
    )
  })

  it('Cancel closes without calling the API and returns focus to the trigger', async () => {
    const { user, button } = await renderReady()
    await user.click(button)
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPost).not.toHaveBeenCalled()
    await waitFor(() => expect(button).toHaveFocus())
  })

  it('Escape cancels', async () => {
    const { user, button } = await renderReady()
    await user.click(button)
    await screen.findByRole('dialog')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('Stage posts the transition to staged, closes, and announces "Exercise staged."', async () => {
    mockPost.mockResolvedValue(inState('staged', ['live']))
    const { user, button } = await renderReady()
    await user.click(button)
    await user.click(await screen.findByRole('button', { name: 'Stage' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockPost).toHaveBeenCalledWith('staged')
    expect(screen.getByTestId('stage-exercise-status')).toHaveTextContent('Exercise staged.')
    // The Stage button is gone; keyboard focus lands on the control's group, not <body>.
    await waitFor(() => expect(screen.getByTestId('stage-exercise-control')).toHaveFocus())
  })

  it("a readiness-blocking 409 lists the server's items in the dialog and refetches readiness", async () => {
    mockPost.mockRejectedValue(
      new LifecycleError('Blocking items are open.', 409, [
        {
          id: 'participant-access',
          label: 'Participants can get in',
          status: 'open',
          detail: 'No accounts.',
        },
      ]),
    )
    const { user, button } = await renderReady()
    expect(mockReadiness).toHaveBeenCalledTimes(1)
    await user.click(button)
    await user.click(await screen.findByRole('button', { name: 'Stage' }))
    const alert = await screen.findByTestId('stage-exercise-error')
    expect(alert).toHaveTextContent('The exercise was not staged.')
    expect(within(alert).getByText(/Participants can get in: No accounts\./)).toBeInTheDocument()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await waitFor(() => expect(mockReadiness.mock.calls.length).toBeGreaterThan(1))
  })
})
