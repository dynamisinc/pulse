/**
 * features/login/pages/StaffSignInPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 03 (staff sign-in) — RTL coverage for the Acceptance Criteria:
 *  - AC1: renders a COBRA-styled form with username + secret ONLY (no
 *    exercise field); the secret input is masked; keyboard-operable (Enter
 *    submits).
 *  - AC2: an unresolved exercise context blocks submission with a clear
 *    error and NEVER POSTs.
 *  - AC3: valid credentials + a resolved exerciseId -> success envelope ->
 *    `setTokens` -> navigate to `/`; the POST body's `exerciseId` matches the
 *    resolved exercise-context value.
 *  - AC4/AC5: 401 -> ONE generic message + clears ONLY the secret field; 403
 *    -> a DISTINCT "not assigned" message, clearly different from 401.
 *
 * `@/core/services/api` is mocked so no real axios sink is ever touched
 * (repo footgun: an unmocked rejection can crash Vitest worker teardown).
 * `@/core/exerciseContext`'s `resolveExerciseContext` is mocked directly so
 * each test controls resolution deterministically (mirrors
 * `ExerciseSwitcher.test.tsx`'s `useExerciseContext` mock). `react-router-dom`
 * is mocked to capture `useNavigate()` calls without a real router.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api } from '@/core/services/api'
import { resolveExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { setTokens } from '@/core/auth'
import { StaffSignInPage } from './StaffSignInPage'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, setTokens: vi.fn() }
})

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

const mockPost = vi.mocked(api.post)
const mockResolveExerciseContext = vi.mocked(resolveExerciseContext)
const mockSetTokens = vi.mocked(setTokens)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'UTC',
  status: 'active',
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return render(<StaffSignInPage />, { wrapper: Wrapper })
}

async function fillAndSubmit(username: string, secret: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/username/i), username)
  await user.type(screen.getByLabelText(/secret/i), secret)
  await user.click(screen.getByRole('button', { name: /sign in/i }))
  return user
}

beforeEach(() => {
  mockPost.mockReset()
  mockResolveExerciseContext.mockReset()
  mockNavigate.mockReset()
  mockSetTokens.mockReset()
  mockResolveExerciseContext.mockResolvedValue(SCOPE)
})

describe('StaffSignInPage — AC1: renders a COBRA-styled form with username + secret ONLY', () => {
  it('renders a username field and a masked secret field, and no exercise field', () => {
    renderPage()

    expect(screen.getByLabelText(/username/i)).toBeInTheDocument()
    const secretField = screen.getByLabelText(/secret/i)
    expect(secretField).toBeInTheDocument()
    expect(secretField).toHaveAttribute('type', 'password')
    expect(screen.queryByLabelText(/exercise/i)).not.toBeInTheDocument()
  })

  it('is keyboard-operable: Enter submits the form', async () => {
    const user = userEvent.setup()
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves — just prove it was called
    renderPage()

    await user.type(screen.getByLabelText(/username/i), 'planner1')
    await user.type(screen.getByLabelText(/secret/i), 'secret-1')
    await user.keyboard('{Enter}')

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
  })
})

describe('StaffSignInPage — AC3: valid sign-in stores tokens and navigates to /', () => {
  it('stores the returned tokens and navigates to / on success', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456', session: {} },
    } as Awaited<ReturnType<typeof api.post>>)
    renderPage()

    await fillAndSubmit('planner1', 'correct-secret')

    await waitFor(() => expect(mockSetTokens).toHaveBeenCalledWith({
      token: 'tok-123',
      refreshToken: 'ref-456',
    }))
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it("sends the resolved exercise-context's exerciseId in the request body", async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', session: {} },
    } as Awaited<ReturnType<typeof api.post>>)
    renderPage()

    await fillAndSubmit('planner1', 'correct-secret')

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    const [, body] = mockPost.mock.calls[0] ?? []
    expect(body).toEqual({
      username: 'planner1',
      secret: 'correct-secret',
      exerciseId: SCOPE.exerciseId,
    })
  })
})

describe('StaffSignInPage — AC2: an unresolved exercise context blocks submission', () => {
  it('shows the AC2 error and never POSTs when the exercise-context resolution FAILS', async () => {
    mockResolveExerciseContext.mockRejectedValue(new Error('host not configured'))
    renderPage()

    await fillAndSubmit('planner1', 'secret-1')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/isn't configured for staff sign-in/i)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows the AC2 error and never POSTs when resolution is still PENDING at submit time', async () => {
    mockResolveExerciseContext.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()

    await fillAndSubmit('planner1', 'secret-1')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/isn't configured for staff sign-in/i)
    expect(mockPost).not.toHaveBeenCalled()
  })
})

describe('StaffSignInPage — AC4: a 401 shows ONE generic message and clears ONLY the secret', () => {
  it('shows the generic credentials message and clears the secret field, keeping username', async () => {
    mockPost.mockRejectedValue({
      isAxiosError: true,
      response: { status: 401, data: '' },
      message: 'Request failed',
    })
    // Ensure axios.isAxiosError recognizes this shape via the real axios module
    // (not mocked) by using a real-ish rejection shape the service already
    // handles through axios.isAxiosError — see staffSignInService.test.ts for
    // the exact AxiosError construction; here we assert the PAGE's rendering.
    renderPage()

    await fillAndSubmit('planner1', 'wrong-secret')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/weren't recognized/i)
    expect(screen.getByLabelText(/username/i)).toHaveValue('planner1')
    expect(screen.getByLabelText(/secret/i)).toHaveValue('')
  })
})

describe('StaffSignInPage — AC5: a 403 shows a DISTINCT not-assigned message', () => {
  it('shows a message clearly different from the 401 copy, and does not clear the fields', async () => {
    mockPost.mockRejectedValue({
      isAxiosError: true,
      response: { status: 403, data: '' },
      message: 'Request failed',
    })
    renderPage()

    await fillAndSubmit('planner1', 'correct-secret')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not assigned to this exercise/i)
    expect(alert).not.toHaveTextContent(/weren't recognized/i)
    expect(screen.getByLabelText(/username/i)).toHaveValue('planner1')
    expect(screen.getByLabelText(/secret/i)).toHaveValue('correct-secret')
  })
})

describe('StaffSignInPage — accessibility (NFR-001)', () => {
  it('the in-flight submit state is announced via aria-live="polite"', async () => {
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()

    await fillAndSubmit('planner1', 'secret-1')

    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/signing in/i)
  })
})
