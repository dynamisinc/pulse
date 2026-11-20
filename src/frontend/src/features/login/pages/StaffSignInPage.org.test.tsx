/**
 * features/login/pages/StaffSignInPage.org.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles/27 (#835) — RTL coverage for the org sign-in (email + password) on the
 * staff sign-in page: org-scope landing, the org choice (pick, expiry), `/o/:slug` pre-fill, the
 * uniform failure message, the allowlist username in the email field, and the exercise-bound path
 * staying reachable and unchanged (its own tests live in StaffSignInPage.test.tsx).
 *
 * `@/core/services/api` is mocked (no real axios sink); `react-router-dom` is mocked so
 * `useNavigate` is captured and `useParams` can supply the `/o/:slug` slug.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { resetClientSession, setTokens } from '@/core/auth'
import { StaffSignInPage, UNIFORM_FAILURE_MESSAGE } from './StaffSignInPage'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn() } }))

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, resolveExerciseContext: vi.fn() }
})

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return { ...actual, setTokens: vi.fn(), resetClientSession: vi.fn() }
})

const mockNavigate = vi.fn()
let mockParams: Record<string, string> = {}
vi.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
  useParams: () => mockParams,
}))

const mockPost = vi.mocked(api.post)
const mockSetTokens = vi.mocked(setTokens)
const mockResetClientSession = vi.mocked(resetClientSession)

type PostResult = Awaited<ReturnType<typeof api.post>>

const ORG_SESSION = {
  token: 'org-tok',
  refreshToken: 'org-ref',
  session: { scope: 'org', role: 'orgAdmin', exerciseId: null },
}

const CHOICE = {
  choose: [
    { slug: 'acme', orgName: 'Acme County' },
    { slug: 'beta', orgName: 'Beta Region' },
  ],
  choiceToken: 'choice-1',
}

function refusal(status: number) {
  return { isAxiosError: true, response: { status, data: '' }, message: 'Request failed' }
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

async function signIn(email: string, password: string) {
  const user = userEvent.setup()
  await user.type(screen.getByLabelText(/^email/i), email)
  await user.type(screen.getByLabelText(/^password/i), password)
  await user.click(screen.getByRole('button', { name: /^sign in$/i }))
  return user
}

beforeEach(() => {
  mockPost.mockReset()
  mockNavigate.mockReset()
  mockSetTokens.mockReset()
  mockResetClientSession.mockReset()
  mockParams = {}
  vi.mocked(resolveExerciseContext).mockReset()
  vi.mocked(resolveExerciseContext).mockResolvedValue({
    exerciseId: 'ex-alpha',
    exerciseName: 'Alpha',
    timeZone: 'UTC',
    status: 'active',
  })
})

describe('StaffSignInPage — email + password', () => {
  it('opens on email and password fields with the right autocomplete hints', () => {
    renderPage()
    expect(screen.getByLabelText(/^email/i)).toHaveAttribute('autocomplete', 'username')
    const password = screen.getByLabelText(/^password/i)
    expect(password).toHaveAttribute('type', 'password')
    expect(password).toHaveAttribute('autocomplete', 'current-password')
  })

  it('sends {email, password} with no exerciseId and no orgSlug on a bare address', async () => {
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    const [url, body] = mockPost.mock.calls[0] ?? []
    expect(url).toBe('/auth/staff/login')
    expect(body).toEqual({ email: 'pat@example.org', password: 'pw-correct-horse' })
  })

  it('stores an org-scope session and hands off to the role-aware entry (Exercise Management)', async () => {
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    await signIn('admin@example.org', 'pw-correct-horse')
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(mockSetTokens).toHaveBeenCalledWith({ token: 'org-tok', refreshToken: 'org-ref' })
    expect(mockResetClientSession).toHaveBeenCalledTimes(1)
  })

  it('accepts an allowlist (break-glass) username in the email field', async () => {
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    await signIn('controller1', 'break-glass-secret')
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0]?.[1]).toEqual({
      email: 'controller1',
      password: 'break-glass-secret',
    })
  })
})

describe('StaffSignInPage — org address (/o/:slug)', () => {
  it('pre-fills the org and sends orgSlug', async () => {
    mockParams = { slug: 'acme' }
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    expect(screen.getByTestId('staff-org-slug')).toHaveTextContent('acme')
    await signIn('pat@example.org', 'pw-correct-horse')
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0]?.[1]).toEqual({
      orgSlug: 'acme',
      email: 'pat@example.org',
      password: 'pw-correct-horse',
    })
  })
})

describe('StaffSignInPage — organization choice', () => {
  it('lists the orgs, says the choice expires, and posts the picked org', async () => {
    mockPost
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
      .mockResolvedValueOnce({ data: ORG_SESSION } as PostResult)
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')

    const heading = await screen.findByRole('heading', { name: /choose an organization/i })
    expect(heading).toHaveFocus()
    expect(screen.getByText(/expires in 2\s+minutes/i)).toBeInTheDocument()
    expect(screen.getByRole('status')).toContainElement(heading)
    expect(screen.queryByLabelText(/^password/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Beta Region' }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2))
    expect(mockPost.mock.calls[1]).toEqual([
      '/auth/staff/login/choose',
      { choiceToken: 'choice-1', orgSlug: 'beta' },
    ])
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(mockSetTokens).toHaveBeenCalledTimes(1)
  })

  it('returns to the form with a plain message when the choice expired or was used', async () => {
    mockPost
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
      .mockRejectedValueOnce(refusal(401))
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    await user.click(await screen.findByRole('button', { name: 'Acme County' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/choice expired/i)
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument()
    expect(mockSetTokens).not.toHaveBeenCalled()
  })
})

describe('StaffSignInPage — uniform failure', () => {
  it.each([400, 401, 403, 429])(
    'shows the same message for a %i and clears the password',
    async status => {
      mockPost.mockRejectedValue(refusal(status))
      renderPage()
      await signIn('pat@example.org', 'wrong-password')

      const alert = await screen.findByRole('alert')
      expect(alert).toHaveTextContent(UNIFORM_FAILURE_MESSAGE)
      expect(alert.querySelector('svg')).not.toBeNull() // icon + text, never color alone
      expect(screen.getByLabelText(/^password/i)).toHaveValue('')
      expect(screen.getByLabelText(/^email/i)).toHaveValue('pat@example.org')
      expect(mockSetTokens).not.toHaveBeenCalled()
    },
  )
})

describe('StaffSignInPage — exercise-bound path unchanged', () => {
  it('still signs in with username + secret and the host exerciseId', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok', refreshToken: 'ref', session: {} },
    } as PostResult)
    renderPage()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: /use a username and secret instead/i }))
    await user.type(screen.getByLabelText(/username/i), 'jpace')
    await user.type(screen.getByLabelText(/secret/i), 'uat-secret')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))

    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0]).toEqual([
      '/auth/staff/login',
      { username: 'jpace', secret: 'uat-secret', exerciseId: 'ex-alpha' },
    ])
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})
