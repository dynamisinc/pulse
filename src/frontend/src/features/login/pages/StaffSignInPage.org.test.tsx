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
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  await user.type(await screen.findByLabelText(/^email/i), email)
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
  // The bare host by default: no exercise context, so email is the default form.
  vi.mocked(resolveExerciseContext).mockRejectedValue(new Error('no exercise on this host'))
})

const EXERCISE_SCOPE = {
  exerciseId: 'ex-alpha',
  exerciseName: 'Alpha',
  timeZone: 'UTC',
  status: 'active',
} as const

describe('StaffSignInPage — email + password', () => {
  it('opens on email and password fields with the right autocomplete hints', async () => {
    renderPage()
    expect(await screen.findByLabelText(/^email/i)).toHaveAttribute('autocomplete', 'username')
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
    expect(heading).toHaveAttribute('aria-describedby', 'staff-org-choice-expiry')
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
    vi.mocked(resolveExerciseContext).mockResolvedValue(EXERCISE_SCOPE)
    renderPage()
    const user = userEvent.setup()
    await user.type(await screen.findByLabelText(/username/i), 'jpace')
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

describe('StaffSignInPage — which form is the default', () => {
  it('defaults to the exercise-bound form on an exercise address, with a link to email', async () => {
    vi.mocked(resolveExerciseContext).mockResolvedValue(EXERCISE_SCOPE)
    renderPage()
    expect(await screen.findByLabelText(/username/i)).toBeInTheDocument()
    expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument()
    await userEvent.setup().click(
      screen.getByRole('button', { name: /sign in with email instead/i }),
    )
    expect(screen.getByLabelText(/^email/i)).toHaveFocus()
  })

  it('defaults to email on the bare host', async () => {
    renderPage()
    expect(await screen.findByLabelText(/^email/i)).toBeInTheDocument()
  })

  it('defaults to email on /o/:slug even where an exercise resolves', async () => {
    mockParams = { slug: 'acme' }
    vi.mocked(resolveExerciseContext).mockResolvedValue(EXERCISE_SCOPE)
    renderPage()
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument()
    await waitFor(() => expect(resolveExerciseContext).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument())
    expect(screen.getByLabelText(/^email/i)).toBeInTheDocument()
  })

  it('shows a placeholder, not a form, until the context settles, then focuses the first field',
    async () => {
      let resolveScope: (scope: typeof EXERCISE_SCOPE) => void = () => {}
      vi.mocked(resolveExerciseContext).mockReturnValue(
        new Promise(resolve => { resolveScope = resolve }),
      )
      renderPage()
      expect(screen.getByTestId('staff-sign-in-loading')).toBeInTheDocument()
      expect(screen.queryByLabelText(/^email/i)).not.toBeInTheDocument()
      expect(screen.queryByLabelText(/username/i)).not.toBeInTheDocument()

      resolveScope(EXERCISE_SCOPE)
      const username = await screen.findByLabelText(/username/i)
      expect(screen.queryByTestId('staff-sign-in-loading')).not.toBeInTheDocument()
      expect(username).toHaveFocus()
      expect(document.body).not.toHaveFocus()
    })

  it('falls back to the email form when the context never answers', async () => {
    vi.mocked(resolveExerciseContext).mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(await screen.findByLabelText(/^email/i, undefined, { timeout: 4500 })).toHaveFocus()
  }, 10000)
})

describe('StaffSignInPage — focus', () => {
  it('focuses the password after a refused sign-in', async () => {
    mockPost.mockRejectedValue(refusal(401))
    renderPage()
    await signIn('pat@example.org', 'wrong-password')
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^password/i)).toHaveFocus()
  })

  it('focuses the email after an expired choice and after use a different account', async () => {
    mockPost
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
      .mockRejectedValueOnce(refusal(401))
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    await user.click(await screen.findByRole('button', { name: 'Acme County' }))
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^email/i)).toHaveFocus()

    await user.type(screen.getByLabelText(/^password/i), 'pw-correct-horse')
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    await user.click(await screen.findByRole('button', { name: /use a different account/i }))
    expect(screen.getByLabelText(/^email/i)).toHaveFocus()
  })

  it('keeps inputs focusable (readOnly, not disabled) while submitting', async () => {
    mockPost.mockReturnValue(new Promise(() => {}))
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    const password = await screen.findByLabelText(/^password/i)
    expect(password).not.toBeDisabled()
    expect(password).toHaveAttribute('readonly')
  })
})

describe('StaffSignInPage — messages, slug and choice edge cases', () => {
  it('shows a generic message, not the credentials one, for a malformed 200', async () => {
    mockPost.mockResolvedValue({ data: {} } as PostResult)
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong/i)
    expect(alert).not.toHaveTextContent(/match/i)
  })

  it('does not show the credentials message when completing the sign-in throws', async () => {
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    mockSetTokens.mockImplementation(() => { throw new Error('storage full') })
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    const alert = await screen.findByRole('alert')
    expect(alert).not.toHaveTextContent(/match/i)
  })

  it('treats an empty organization list as a uniform failure', async () => {
    mockPost.mockResolvedValue({ data: { choose: [], choiceToken: 'c' } } as PostResult)
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    expect(await screen.findByRole('alert')).toHaveTextContent(UNIFORM_FAILURE_MESSAGE)
  })

  it('keeps the choice step with a retry message on a 500 from choose', async () => {
    mockPost
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
      .mockRejectedValueOnce(refusal(500))
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    await user.click(await screen.findByRole('button', { name: 'Acme County' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/try again/i)
    expect(screen.getByRole('button', { name: 'Beta Region' })).toBeInTheDocument()
  })

  it('neither shows nor sends a malformed /o/ slug', async () => {
    mockParams = { slug: '<b>Evil Org</b>' }
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    expect(screen.queryByTestId('staff-org-slug')).not.toBeInTheDocument()
    expect(screen.getByTestId('staff-org-slug-invalid')).toHaveTextContent(/isn't valid/i)
    await signIn('pat@example.org', 'pw-correct-horse')
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0]?.[1]).toEqual({
      email: 'pat@example.org',
      password: 'pw-correct-horse',
    })
  })

  it('resets the form when the slug changes', async () => {
    mockParams = { slug: 'acme' }
    const view = renderPage()
    await userEvent.setup().type(screen.getByLabelText(/^email/i), 'pat@example.org')
    mockParams = { slug: 'beta' }
    view.rerender(<StaffSignInPage />)
    expect(screen.getByLabelText(/^email/i)).toHaveValue('')
    expect(screen.getByTestId('staff-org-slug')).toHaveTextContent('beta')
  })

  it('turns off capitalisation and spell checking on the email field', async () => {
    renderPage()
    const email = await screen.findByLabelText(/^email/i)
    expect(email).toHaveAttribute('autocapitalize', 'none')
    expect(email).toHaveAttribute('autocorrect', 'off')
    expect(email).toHaveAttribute('spellcheck', 'false')
  })

  it('has an h1 title', async () => {
    renderPage()
    await screen.findByLabelText(/^email/i)
    expect(screen.getByRole('heading', { level: 1, name: 'Staff sign-in' })).toBeInTheDocument()
  })
})

describe('StaffSignInPage — failures that keep what was typed', () => {
  it('shows a retry message for a 5xx and keeps the password', async () => {
    mockPost.mockRejectedValue(refusal(503))
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/something went wrong on our side/i)
    expect(alert).not.toHaveTextContent(/match/i)
    const password = screen.getByLabelText(/^password/i)
    expect(password).toHaveValue('pw-correct-horse')
    expect(password).toHaveFocus()
  })

  it('keeps the password and the email focus for an unreachable server', async () => {
    mockPost.mockRejectedValue({ isAxiosError: true, message: 'Network Error' })
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/could not reach the server/i)
    expect(screen.getByLabelText(/^password/i)).toHaveValue('pw-correct-horse')

    await user.click(screen.getByLabelText(/^email/i))
    mockPost.mockRejectedValue({ isAxiosError: true, message: 'Network Error' })
    await user.click(screen.getByRole('button', { name: /^sign in$/i }))
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.getByLabelText(/^email/i)).toHaveFocus())
  })

  it('keeps the password for a malformed reply', async () => {
    mockPost.mockResolvedValue({ data: {} } as PostResult)
    renderPage()
    await signIn('pat@example.org', 'pw-correct-horse')
    await screen.findByRole('alert')
    expect(screen.getByLabelText(/^password/i)).toHaveValue('pw-correct-horse')
  })
})

describe('StaffSignInPage — one request at a time', () => {
  it('sends one request for two submits in the same tick', async () => {
    mockPost.mockReturnValue(new Promise(() => {}))
    renderPage()
    await userEvent.setup().type(await screen.findByLabelText(/^email/i), 'pat@example.org')
    await userEvent.setup().type(screen.getByLabelText(/^password/i), 'pw-correct-horse')
    const form = screen.getByTestId('staff-sign-in-form')
    act(() => {
      fireEvent.submit(form)
      fireEvent.submit(form)
    })
    expect(mockPost).toHaveBeenCalledTimes(1)
  })

  it('ignores the form toggle mid-request and ignores a reply after the form is gone', async () => {
    let resolvePost: (value: PostResult) => void = () => {}
    mockPost.mockReturnValue(new Promise<PostResult>(resolve => { resolvePost = resolve }))
    const view = renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    await user.click(screen.getByRole('button', { name: /use a username and secret instead/i }))
    expect(screen.getByLabelText(/^password/i)).toBeInTheDocument() // still the email form

    view.unmount()
    await act(async () => {
      resolvePost({ data: ORG_SESSION } as PostResult)
    })
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockResetClientSession).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('ignores Use a different account mid-request', async () => {
    let resolvePost: (value: PostResult) => void = () => {}
    mockPost
      .mockResolvedValueOnce({ data: CHOICE } as PostResult)
      .mockReturnValueOnce(new Promise<PostResult>(resolve => { resolvePost = resolve }))
    renderPage()
    const user = await signIn('pat@example.org', 'pw-correct-horse')
    await user.click(await screen.findByRole('button', { name: 'Acme County' }))
    await user.click(screen.getByRole('button', { name: /use a different account/i }))
    expect(screen.getByTestId('staff-org-choice')).toBeInTheDocument()
    await act(async () => {
      resolvePost({ data: ORG_SESSION } as PostResult)
    })
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
  })
})

describe('StaffSignInPage — slug normalisation', () => {
  it('trims and lower-cases the slug before testing and sending it', async () => {
    mockParams = { slug: ' ACME ' }
    mockPost.mockResolvedValue({ data: ORG_SESSION } as PostResult)
    renderPage()
    expect(screen.getByTestId('staff-org-slug')).toHaveTextContent('acme')
    await signIn('pat@example.org', 'pw-correct-horse')
    await waitFor(() => expect(mockPost).toHaveBeenCalledTimes(1))
    expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ orgSlug: 'acme' })
  })

  it('treats a slug over 63 characters as invalid', () => {
    mockParams = { slug: 'a'.repeat(64) }
    renderPage()
    expect(screen.getByTestId('staff-org-slug-invalid')).toBeInTheDocument()
    expect(screen.queryByTestId('staff-org-slug')).not.toBeInTheDocument()
  })
})
