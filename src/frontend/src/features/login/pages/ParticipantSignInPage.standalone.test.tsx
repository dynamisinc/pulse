/**
 * features/login/pages/ParticipantSignInPage.standalone.test.tsx
 * ---------------------------------------------------------------------------
 * #606 option A: the sign-in page inside the home-screen app. An app added to the
 * iOS home screen has its own storage, so it always opens signed out, and the
 * personal link opens in Safari, not in the app. When the page runs standalone it
 * leads with "Sign-in link": the participant pastes their link, and the page
 * exchanges its token through the EXISTING `POST /auth/join`. Today's word comes
 * next, and the "Pulse" product label is hidden.
 *
 * Pins:
 *  - standalone: "Sign-in link" is the first method and is selected; Today's word is
 *    second; the "Pulse" label is gone;
 *  - a pasted link (or a whole message) posts ONLY the token, in the body, to
 *    `/auth/join`, with no stored credential attached, then persists the pair and
 *    navigates to `/`;
 *  - non-token input is refused before any request;
 *  - 401 -> one generic message, the field cleared and focused; 429 -> "Too many
 *    tries"; network -> the generic copy; the pasted text never appears in an alert;
 *  - in a browser tab (not standalone) nothing changes: three methods, word first,
 *    "Pulse" shown.
 *
 * Mocks follow `ParticipantSignInPage.test.tsx`: `api.post` at the module boundary,
 * the live (non-mock) service path, and spies for `setTokens` / `navigate`.
 * `isStandalone` is mocked so each test picks the mode.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import { isStandalone } from '@/features/pwa/install/installEnv'
import { ParticipantSignInPage } from './ParticipantSignInPage'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn() } }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/auth', () => ({ setTokens: vi.fn(), resetClientSession: vi.fn() }))
vi.mock('@/core/exerciseContext', () => ({ resolveExerciseContext: vi.fn() }))
vi.mock('@/features/pwa/install/installEnv', () => ({ isStandalone: vi.fn() }))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

const mockPost = vi.mocked(api.post)
const mockSetTokens = vi.mocked(setTokens)
const mockIsStandalone = vi.mocked(isStandalone)

const TOKEN = 'aB3_dE6-gH9iJ2kL5mN8oP'
const LINK = `https://bayshield.example/join/${TOKEN}`
const ENVELOPE = {
  token: 'access-1',
  refreshToken: 'refresh-1',
  session: { exerciseId: 'ex-alpha', accountId: 'acct-1', role: 'participant' },
}

function axiosErrorWith(status: number): AxiosError {
  const response = { status, data: '', statusText: '', headers: {}, config: {} } as unknown as AxiosResponse
  return new AxiosError('Request failed', undefined, undefined, undefined, response)
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
  }
  return render(<ParticipantSignInPage />, { wrapper: Wrapper })
}

async function pasteAndSubmit(user: ReturnType<typeof userEvent.setup>, text: string) {
  const field = screen.getByLabelText('Paste your sign-in link')
  await user.click(field)
  await user.paste(text)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

beforeEach(() => {
  mockPost.mockReset()
  mockSetTokens.mockReset()
  mockNavigate.mockReset()
  mockIsStandalone.mockReset()
  mockIsStandalone.mockReturnValue(true)
  vi.mocked(resolveExerciseContext).mockResolvedValue({
    exerciseId: 'ex-alpha', exerciseName: 'Bay Shield', timeZone: 'UTC', status: 'active',
  })
})

describe('ParticipantSignInPage in the home-screen app (#606)', () => {
  it('leads with "Sign-in link" (selected), then Today\'s word', () => {
    renderPage()
    const group = screen.getByRole('group', { name: 'Sign-in method' })
    const labels = Array.from(group.querySelectorAll('button')).map(b => b.textContent)
    expect(labels).toEqual(['Sign-in link', "Today's word", 'Password', 'View-only code'])
    expect(screen.getByRole('button', { name: 'Sign-in link' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('form', { name: 'Sign in with your link' })).toBeInTheDocument()
  })

  it('labels and describes the field, with typing aids off', () => {
    renderPage()
    const field = screen.getByLabelText('Paste your sign-in link')
    expect(field).toHaveAttribute('type', 'text')
    expect(field).toHaveAttribute('autocomplete', 'off')
    expect(field).toHaveAttribute('autocapitalize', 'none')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(field).toHaveAccessibleDescription('Copy it from your invitation email or text message.')
  })

  it('hides the "Pulse" label and keeps the exercise name', async () => {
    renderPage()
    expect(screen.queryByText('Pulse')).toBeNull()
    expect(await screen.findByRole('heading', { name: 'Sign in to Bay Shield' })).toBeInTheDocument()
  })

  it('posts only the token to /auth/join anonymously, persists the pair and navigates', async () => {
    mockPost.mockResolvedValue({ data: ENVELOPE })
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, `Your link: ${LINK} (keep it private)`)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    const [endpoint, body, config] = mockPost.mock.calls[0] ?? []
    expect(endpoint).toBe('/auth/join')
    expect(body).toEqual({ token: TOKEN })
    expect(config).toMatchObject({ headers: { Authorization: false } })
    expect(mockSetTokens).toHaveBeenCalledWith(
      { token: 'access-1', refreshToken: 'refresh-1' },
      { persist: true },
    )
  })

  it('refuses input with no token before any request, and keeps it', async () => {
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, 'https://bayshield.example/home')

    expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a sign-in link.")
    expect(mockPost).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Paste your sign-in link')).toHaveValue('https://bayshield.example/home')
    expect(screen.getByLabelText('Paste your sign-in link')).toHaveFocus()
  })

  it('a repeated refusal re-mounts the alert so it is announced again (W-2)', async () => {
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, 'my-secret-word')
    const first = screen.getByRole('alert')
    expect(first.textContent).not.toContain('my-secret-word')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    const second = screen.getByRole('alert')
    expect(second).not.toBe(first)
    expect(second).toHaveTextContent("That doesn't look like a sign-in link.")
  })

  it('marks the field invalid and described by the alert while it shows an error', async () => {
    const user = userEvent.setup()
    renderPage()
    const field = screen.getByLabelText('Paste your sign-in link')
    expect(field).not.toHaveAttribute('aria-invalid')
    await pasteAndSubmit(user, 'nope')
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(field).toHaveAccessibleDescription(expect.stringContaining("doesn't look like a sign-in link"))
  })

  it('a bare value that is not exactly a token (e.g. today\'s word) is never posted', async () => {
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, 'harborlights')
    expect(mockPost).not.toHaveBeenCalled()
    expect(screen.getByRole('alert')).toHaveTextContent("That doesn't look like a sign-in link.")
  })

  it('a 400 reads as the same refused-link message as a 401', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(400))
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, LINK)
    expect(await screen.findByRole('alert')).toHaveTextContent("That link wasn't recognized.")
  })

  it('a 200 carrying a non-participant role is refused like a bad link and stores nothing', async () => {
    mockPost.mockResolvedValue({ data: { ...ENVELOPE, session: { ...ENVELOPE.session, role: 'controller' } } })
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, LINK)
    expect(await screen.findByRole('alert')).toHaveTextContent("That link wasn't recognized.")
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('401: one generic message, the field cleared and focused, the link never echoed', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, LINK)

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("That link wasn't recognized.")
    expect(alert.textContent).not.toContain(TOKEN)
    const field = screen.getByLabelText('Paste your sign-in link')
    expect(field).toHaveValue('')
    await waitFor(() => expect(field).toHaveFocus())
    expect(mockSetTokens).not.toHaveBeenCalled()
  })

  it('429: "Too many tries", the link kept, focus on Sign in', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(429))
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, LINK)

    expect(await screen.findByRole('alert')).toHaveTextContent('Too many tries.')
    expect(screen.getByLabelText('Paste your sign-in link')).toHaveValue(LINK)
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus())
  })

  it('no network: the generic copy, the link kept', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))
    const user = userEvent.setup()
    renderPage()
    await pasteAndSubmit(user, LINK)

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not sign in. Please try again.')
    expect(screen.getByLabelText('Paste your sign-in link')).toHaveValue(LINK)
  })

  it('Today\'s word is one tap away and still works', async () => {
    const user = userEvent.setup()
    renderPage()
    await user.click(screen.getByRole('button', { name: "Today's word" }))
    expect(screen.getByLabelText('Sign-in name')).toBeInTheDocument()
    expect(screen.queryByLabelText('Paste your sign-in link')).toBeNull()
  })
})

describe('ParticipantSignInPage in a browser tab', () => {
  it('is unchanged: three methods, Today\'s word first, "Pulse" shown, no link form', () => {
    mockIsStandalone.mockReturnValue(false)
    renderPage()
    expect(screen.queryByRole('button', { name: 'Sign-in link' })).toBeNull()
    expect(screen.getByRole('button', { name: "Today's word" })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Pulse')).toBeInTheDocument()
    expect(screen.queryByLabelText('Paste your sign-in link')).toBeNull()
  })
})
