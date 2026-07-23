/**
 * features/login/pages/ParticipantSignInPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (participant sign-in) — RTL coverage for the Acceptance Criteria:
 *  - AC1: both forms exist on one page; the toggle swaps which is visible;
 *    the toggle + submit are real, keyboard-operable buttons.
 *  - AC2/AC3: a successful named or shared sign-in stores tokens
 *    (`setTokens`) and navigates to `/`.
 *  - AC4: a 401 from either endpoint shows exactly ONE generic,
 *    anti-enumeration `role="alert"` message and clears ONLY the password
 *    field (NFR-009).
 *  - AC5: the exercise-name heading appears once the lookup resolves, and is
 *    replaced by a generic heading — with the form still fully present and
 *    working — when it doesn't (loading, error, or unknown host).
 *  - Cross-cutting: the submit-in-flight state is announced via
 *    `role="status"`/`aria-live="polite"` (mirrors
 *    `ExerciseSwitcher.test.tsx`'s idiom).
 *
 * `@/core/services/api` is mocked at the module boundary (never a real axios
 * sink — the repo's own worker-teardown footgun). `@/core/auth` and
 * `@/core/exerciseContext` are mocked the same way so each test controls
 * `setTokens`/`resolveExerciseContext` directly. `react-router-dom` is
 * mocked to substitute a spy for `useNavigate()` — this page imports nothing
 * else from that module, so a full replacement is safe.
 */
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api } from '@/core/services/api'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { ParticipantSignInPage } from './ParticipantSignInPage'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

vi.mock('@/core/auth', () => ({
  setTokens: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}))

const mockPost = vi.mocked(api.post)
const mockSetTokens = vi.mocked(setTokens)
const mockResolveExerciseContext = vi.mocked(resolveExerciseContext)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha Exercise',
  timeZone: 'UTC',
  status: 'active',
}

/** Builds a real AxiosError carrying a response (so `axios.isAxiosError` is true). */
function axiosErrorWith(status: number, data: unknown = ''): AxiosError {
  const response = {
    status,
    data,
    statusText: '',
    headers: {},
    config: {},
  } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
  return render(<ParticipantSignInPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  mockPost.mockReset()
  mockSetTokens.mockReset()
  mockNavigate.mockReset()
  mockResolveExerciseContext.mockReset()
  mockResolveExerciseContext.mockResolvedValue(SCOPE)
})

describe('ParticipantSignInPage — both forms on one page, toggle swaps visibility (AC1)', () => {
  it('shows the named-account form by default', () => {
    renderPage()

    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText('Exercise code')).not.toBeInTheDocument()
  })

  it('clicking the "Exercise code" toggle swaps to the shared-code form', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Exercise code' }))

    expect(screen.getByLabelText('Exercise code')).toBeInTheDocument()
    expect(screen.queryByLabelText('Handle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
  })

  it('clicking back to "Account sign-in" restores the named form', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Exercise code' }))
    await user.click(screen.getByRole('button', { name: 'Account sign-in' }))

    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(screen.queryByLabelText('Exercise code')).not.toBeInTheDocument()
  })

  it('the toggle is a real, keyboard-operable button pair, not a div onClick', async () => {
    const user = userEvent.setup()
    renderPage()

    const namedToggle = screen.getByRole('button', { name: 'Account sign-in' })
    const sharedToggle = screen.getByRole('button', { name: 'Exercise code' })
    expect(namedToggle.tagName).toBe('BUTTON')
    expect(sharedToggle.tagName).toBe('BUTTON')
    expect(namedToggle).toHaveAttribute('aria-pressed', 'true')
    expect(sharedToggle).toHaveAttribute('aria-pressed', 'false')

    sharedToggle.focus()
    expect(document.activeElement).toBe(sharedToggle)
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Exercise code')).toBeInTheDocument()
    expect(sharedToggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('the submit button is a real, keyboard-reachable <button type="submit">', () => {
    renderPage()

    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit.tagName).toBe('BUTTON')
    expect(submit).toHaveAttribute('type', 'submit')
  })
})

describe('ParticipantSignInPage — named sign-in stores tokens and navigates (AC2)', () => {
  it('POSTs /auth/login, calls setTokens with the envelope, and navigates to /', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      username: 'dreyes',
      password: 'correct-password',
    })
    await vi.waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith({ token: 'tok-123', refreshToken: 'ref-456' }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})

describe('ParticipantSignInPage — shared-code sign-in stores tokens and navigates (AC3)', () => {
  it('POSTs /auth/shared, calls setTokens with the envelope, and navigates to /', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-999' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Exercise code' }))
    await user.type(screen.getByLabelText('Exercise code'), 'shared-code-123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockPost).toHaveBeenCalledWith('/auth/shared', { password: 'shared-code-123' })
    await vi.waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith({ token: 'tok-999', refreshToken: undefined }),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})

describe('ParticipantSignInPage — 401 anti-enumeration handling (AC4, NFR-009)', () => {
  it('named form: shows the generic message and clears ONLY the password field', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'wrong-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("That handle or password wasn't recognized.")
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()

    expect(screen.getByLabelText('Handle')).toHaveValue('dreyes')
    expect(screen.getByLabelText('Password')).toHaveValue('')
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('shared form: shows the generic message and clears the shared password field', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Exercise code' }))
    await user.type(screen.getByLabelText('Exercise code'), 'wrong-code')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("That exercise code wasn't recognized.")
    expect(screen.getByLabelText('Exercise code')).toHaveValue('')
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('never distinguishes "no such handle" from "wrong password" — same message either way', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, { message: 'no such handle: nobody' }))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Handle'), 'nobody')
    await user.type(screen.getByLabelText('Password'), 'whatever')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That handle or password wasn't recognized.",
    )
  })

  it('a non-401 failure shows a distinct generic try-again message, not the anti-enumeration copy', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(500))
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sign in. Please try again.')
  })
})

describe('ParticipantSignInPage — exercise-name branding is non-blocking (AC5)', () => {
  it('shows "Sign in to {exerciseName}" once the lookup resolves', async () => {
    renderPage()

    expect(
      await screen.findByRole('heading', { name: 'Sign in to Alpha Exercise' }),
    ).toBeInTheDocument()
  })

  it('falls back to a generic "Sign in" heading, with a fully working form, on lookup failure', async () => {
    mockResolveExerciseContext.mockRejectedValue(new Error('unknown host'))
    renderPage()

    // Renders immediately - never blocked on the lookup settling.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()

    await vi.waitFor(() => expect(mockResolveExerciseContext).toHaveBeenCalled())

    // Still generic + still a working form after the rejection settles.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('renders the generic heading immediately while the lookup is still pending', () => {
    mockResolveExerciseContext.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
  })
})

describe('ParticipantSignInPage — submit-in-flight is announced (aria-live)', () => {
  it('mounts a role="status" aria-live="polite" region reading "Signing in…" while in flight', async () => {
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const status = await screen.findByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent('Signing in…')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })
})
