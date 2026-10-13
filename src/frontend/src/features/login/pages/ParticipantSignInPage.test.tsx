/**
 * features/login/pages/ParticipantSignInPage.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (participant sign-in) + easy-login story 09 ("Today's word") — RTL
 * coverage for the Acceptance Criteria:
 *
 * Story 02:
 *  - AC1: all forms exist on one page; the toggle swaps which is visible;
 *    the toggle + submit are real, keyboard-operable buttons.
 *  - AC2/AC3: a successful named or shared sign-in stores tokens
 *    (`setTokens`) and navigates to `/`.
 *  - AC4: a 401 from any endpoint shows exactly ONE generic,
 *    anti-enumeration `role="alert"` message and clears ONLY the secret
 *    field (NFR-009).
 *  - AC5: the exercise-name heading appears once the lookup resolves, and is
 *    replaced by a generic heading — with the form still fully present and
 *    working — when it doesn't (loading, error, or unknown host).
 *  - Cross-cutting: the submit-in-flight state is announced via
 *    `role="status"`/`aria-live="polite"` (mirrors
 *    `ExerciseSwitcher.test.tsx`'s idiom).
 *
 * Easy-login 09 (AC numbers are the story's, in order):
 *  - 09-AC1: three real `<button type="button">`s with `aria-pressed`, Today's
 *    word the default, relabelled Password / View-only code; keyboard
 *    switching keeps each form's typed values; switching clears the error.
 *  - 09-AC2: the Today's-word fields' labels and attributes (autocapitalize
 *    none, autocorrect off, spellcheck false, username / off, word is
 *    `type="text"`). The 16 px size is pinned by the source-scan test
 *    (`ParticipantSignInPage.boundary.test.ts`) because jsdom computes no CSS.
 *  - 09-AC3: `signInWithDayWord` posts `{ signInName, word }` to `/auth/word`;
 *    `setTokens(pair, { persist: true })`; navigates to `/`. The page trims
 *    surrounding whitespace and nothing else.
 *  - 09-AC4: 401 -> one generic alert, only the word cleared, focus on the word;
 *    429 -> its own copy; network / 5xx / 400 / malformed -> the generic
 *    "Could not sign in" copy; focus lands on a usable control, not <body>.
 *  - 09-AC5: Password and View-only code still behave as before but now persist.
 *    Gate-1 W-1: the view-only form uses one name throughout - field label
 *    "View-only code", form name "Sign in with a view-only code", 401
 *    "That view-only code wasn't recognized." - and nothing says "Exercise code".
 *  - 09-AC6: the exercise heading and the staff link are untouched (the
 *    story-02/04 tests below still run against the default view).
 *  - Content security (NFR-004 / NFR-009): the word and name never reach the
 *    console, the URL or the alert text; every form is `method="post"` so a
 *    native (script-less) submit can never put credentials in a GET query
 *    (Gate-1 S-6).
 *  - Status announcement (Gate-1 S-4): the `role="status"` region is mounted
 *    all the time, empty when idle, and only its text swaps to "Signing in…".
 *
 * `@/core/services/api` is mocked at the module boundary (never a real axios
 * sink — the repo's own worker-teardown footgun). `@/core/config/mockData` is
 * pinned to `false` so `signInWithDayWord` takes its LIVE path (a plain
 * two-argument `api.post`) — the day-word mock adapter is exercised in
 * `participantSignInService.mock.test.ts`. `@/core/auth` and
 * `@/core/exerciseContext` are mocked the same way so each test controls
 * `setTokens`/`resolveExerciseContext` directly. `react-router-dom` keeps its
 * REAL `Link`/`MemoryRouter` (via `importOriginal`) — this page now renders a
 * real `<Link to={STAFF_LOGIN_PATH}>` (feature: login, story 04, AC2) that
 * needs a genuine Router ancestor to resolve — and only overrides
 * `useNavigate()` with a spy.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { api } from '@/core/services/api'
import { setTokens } from '@/core/auth'
import { resolveExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { STAFF_LOGIN_PATH } from '@/features/app-shell/constants'
import { ParticipantSignInPage } from './ParticipantSignInPage'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn() },
}))

// Live path for signInWithDayWord (see the header): no mock adapter, two-arg post.
vi.mock('@/core/config/mockData', () => ({
  USE_MOCK_DATA: false,
}))

vi.mock('@/core/auth', () => ({
  setTokens: vi.fn(),
}))

vi.mock('@/core/exerciseContext', () => ({
  resolveExerciseContext: vi.fn(),
}))

const mockNavigate = vi.fn()
vi.mock('react-router-dom', async importOriginal => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => mockNavigate }
})

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
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    )
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

/** The Password form (the old "Account sign-in"), opened from the default view. */
async function openPasswordForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Password' }))
}

/** The View-only code form (the old "Exercise code"), opened from the default view. */
async function openViewOnlyForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'View-only code' }))
}

/** Types a name + word into the default Today's-word form and submits it. */
async function submitWordForm(
  user: ReturnType<typeof userEvent.setup>,
  signInName = 'dreyes',
  word = 'bluebird',
) {
  await user.type(screen.getByLabelText('Sign-in name'), signInName)
  await user.type(screen.getByLabelText("Today's word"), word)
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

/**
 * Submits the Today's-word form with a request that FAILS LATER, and while it is
 * in flight parks focus on the NAME field. A real browser drops focus to <body>
 * when the focused submit button becomes `disabled`; jsdom cannot blur a
 * disabled control, so this stands in for "focus is not where the page needs it
 * once the request settles". Without it the focus assertions below would pass
 * vacuously (user-event leaves focus on the clicked button).
 */
async function submitWordFormLosingFocusInFlight(
  user: ReturnType<typeof userEvent.setup>,
  error: AxiosError,
) {
  let rejectRequest: (reason: unknown) => void = () => {}
  mockPost.mockReturnValue(
    new Promise((_resolve, reject) => {
      rejectRequest = reject
    }),
  )
  await submitWordForm(user, 'dreyes', 'bluebird')
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signing in…'))
  screen.getByLabelText('Sign-in name').focus()
  expect(screen.getByLabelText('Sign-in name')).toHaveFocus()
  rejectRequest(error)
}

describe('ParticipantSignInPage — three methods, Today\'s word is the default (09-AC1)', () => {
  it('offers Today\'s word, Password and View-only code as real buttons in one labelled group', () => {
    renderPage()

    const group = screen.getByRole('group', { name: 'Sign-in method' })
    const buttons = Array.from(group.querySelectorAll('button'))
    expect(buttons.map(button => button.textContent)).toEqual([
      "Today's word",
      'Password',
      'View-only code',
    ])
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON')
      expect(button).toHaveAttribute('type', 'button')
    }
  })

  it('has Today\'s word pressed by default and the other two not pressed', () => {
    renderPage()

    expect(screen.getByRole('button', { name: "Today's word" })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: 'Password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
    expect(screen.getByRole('button', { name: 'View-only code' })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('no longer uses the old "Account sign-in" / "Exercise code" toggle labels', () => {
    renderPage()

    expect(screen.queryByRole('button', { name: 'Account sign-in' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Exercise code' })).not.toBeInTheDocument()
  })

  it('shows the Today\'s-word form by default and only that form', () => {
    renderPage()

    expect(screen.getByLabelText('Sign-in name')).toBeInTheDocument()
    expect(screen.getByLabelText("Today's word")).toBeInTheDocument()
    expect(screen.queryByLabelText('Handle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('View-only code')).not.toBeInTheDocument()
  })

  it('clicking Password swaps to the named-account form and moves aria-pressed', async () => {
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)

    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    expect(screen.queryByLabelText("Today's word")).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Password' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByRole('button', { name: "Today's word" })).toHaveAttribute(
      'aria-pressed',
      'false',
    )
  })

  it('clicking View-only code swaps to the shared-code form', async () => {
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)

    expect(screen.getByLabelText('View-only code')).toBeInTheDocument()
    expect(screen.queryByLabelText('Handle')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument()
    expect(screen.queryByLabelText("Today's word")).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'View-only code' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('clicking back to Today\'s word restores that form', async () => {
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)
    await user.click(screen.getByRole('button', { name: "Today's word" }))

    expect(screen.getByLabelText("Today's word")).toBeInTheDocument()
    expect(screen.queryByLabelText('View-only code')).not.toBeInTheDocument()
  })

  it('is operable from the keyboard alone: Tab reaches each toggle, Enter / Space activate it', async () => {
    const user = userEvent.setup()
    renderPage()

    const wordToggle = screen.getByRole('button', { name: "Today's word" })
    const passwordToggle = screen.getByRole('button', { name: 'Password' })
    const viewOnlyToggle = screen.getByRole('button', { name: 'View-only code' })

    await user.tab()
    expect(wordToggle).toHaveFocus()
    await user.tab()
    expect(passwordToggle).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(passwordToggle).toHaveAttribute('aria-pressed', 'true')

    await user.tab()
    expect(viewOnlyToggle).toHaveFocus()
    await user.keyboard(' ')
    expect(screen.getByLabelText('View-only code')).toBeInTheDocument()
    expect(viewOnlyToggle).toHaveAttribute('aria-pressed', 'true')
  })

  it('the submit button is a real, keyboard-reachable <button type="submit">', () => {
    renderPage()

    const submit = screen.getByRole('button', { name: 'Sign in' })
    expect(submit.tagName).toBe('BUTTON')
    expect(submit).toHaveAttribute('type', 'submit')
  })

  it('keeps what was typed in each form while switching between all three by keyboard', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.type(screen.getByLabelText('Sign-in name'), 'dreyes')
    await user.type(screen.getByLabelText("Today's word"), 'bluebird')

    const passwordToggle = screen.getByRole('button', { name: 'Password' })
    passwordToggle.focus()
    await user.keyboard('{Enter}')
    await user.type(screen.getByLabelText('Handle'), 'd.reyes')
    await user.type(screen.getByLabelText('Password'), 'pw-1234')

    const viewOnlyToggle = screen.getByRole('button', { name: 'View-only code' })
    viewOnlyToggle.focus()
    await user.keyboard('{Enter}')
    await user.type(screen.getByLabelText('View-only code'), 'shared-1')

    // ...and back round again: nothing was lost in any form.
    screen.getByRole('button', { name: "Today's word" }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('dreyes')
    expect(screen.getByLabelText("Today's word")).toHaveValue('bluebird')

    screen.getByRole('button', { name: 'Password' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('Handle')).toHaveValue('d.reyes')
    expect(screen.getByLabelText('Password')).toHaveValue('pw-1234')

    screen.getByRole('button', { name: 'View-only code' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText('View-only code')).toHaveValue('shared-1')
  })

  it('switching methods clears a showing error (and the error does not follow you back)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user)
    expect(await screen.findByRole('alert')).toBeInTheDocument()

    await openPasswordForm(user)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: "Today's word" }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})

describe('ParticipantSignInPage — Today\'s-word fields (09-AC2)', () => {
  it('has a labelled Sign-in name field, a labelled Today\'s word field and a Sign in button', () => {
    renderPage()

    expect(screen.getByLabelText('Sign-in name')).toBeInTheDocument()
    expect(screen.getByLabelText("Today's word")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('form', { name: "Sign in with today's word" })).toBeInTheDocument()
  })

  it('turns off auto-capitalisation, auto-correct and spell-check on BOTH fields', () => {
    renderPage()

    for (const field of [screen.getByLabelText('Sign-in name'), screen.getByLabelText("Today's word")]) {
      expect(field).toHaveAttribute('autocapitalize', 'none')
      expect(field).toHaveAttribute('autocorrect', 'off')
      expect(field).toHaveAttribute('spellcheck', 'false')
    }
  })

  it('autocompletes the name as "username" and switches autocomplete off for the word', () => {
    renderPage()

    expect(screen.getByLabelText('Sign-in name')).toHaveAttribute('autocomplete', 'username')
    expect(screen.getByLabelText("Today's word")).toHaveAttribute('autocomplete', 'off')
  })

  it('makes the word a visible type="text" field, never a masked password field', () => {
    renderPage()

    expect(screen.getByLabelText("Today's word")).toHaveAttribute('type', 'text')
    expect(screen.getByLabelText('Sign-in name')).toHaveAttribute('type', 'text')
  })

  it('requires both fields', () => {
    renderPage()

    expect(screen.getByLabelText('Sign-in name')).toBeRequired()
    expect(screen.getByLabelText("Today's word")).toBeRequired()
  })
})

describe('ParticipantSignInPage — Today\'s word stores tokens (persisted) and navigates (09-AC3)', () => {
  it('POSTs /auth/word { signInName, word }, persists the pair, and navigates to /', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'dreyes', 'bluebird')

    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(mockPost).toHaveBeenCalledWith('/auth/word', {
      signInName: 'dreyes',
      word: 'bluebird',
    })
    await waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith(
        { token: 'tok-123', refreshToken: 'ref-456' },
        { persist: true },
      ),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })

  it('trims surrounding whitespace and does NOTHING else to what was typed (server normalises)', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, '  D.Reyes ', '  Blue-Bird  ')

    // Case and punctuation survive; only the edges are trimmed.
    expect(mockPost).toHaveBeenCalledWith('/auth/word', {
      signInName: 'D.Reyes',
      word: 'Blue-Bird',
    })
  })

  it('persists a session that has no refresh token too', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-only' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user)

    await waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith(
        { token: 'tok-only', refreshToken: undefined },
        { persist: true },
      ),
    )
  })

  it('sends nothing and stores nothing when the page is just opened', () => {
    renderPage()

    expect(mockPost).not.toHaveBeenCalled()
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })
})

describe('ParticipantSignInPage — Today\'s word failures (09-AC4)', () => {
  it('401: one generic role="alert" with an icon, only the WORD cleared, focus back on the word', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'dreyes', 'wrong-word')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "That name or word wasn't recognized. Check today's word with your controller.",
    )
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()

    expect(screen.getByLabelText('Sign-in name')).toHaveValue('dreyes')
    expect(screen.getByLabelText("Today's word")).toHaveValue('')
    await waitFor(() => expect(screen.getByLabelText("Today's word")).toHaveFocus())
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('401: never says which half was wrong, whatever detail the server sends', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, { message: 'no such sign-in name: nobody' }))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'nobody', 'whatever')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(
      "That name or word wasn't recognized. Check today's word with your controller.",
    )
    expect(alert).not.toHaveTextContent(/no such/i)
    expect(alert).not.toHaveTextContent('nobody')
    expect(alert).not.toHaveTextContent('whatever')
  })

  it('429: shows the "Too many tries" copy and keeps both fields', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(429))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'dreyes', 'bluebird')

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Too many tries. Wait a minute and try again.')
    expect(alert.querySelector('svg[data-icon="triangle-exclamation"]')).not.toBeNull()
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('dreyes')
    expect(screen.getByLabelText("Today's word")).toHaveValue('bluebird')
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('429: focus is put back on the Sign in button after focus was lost in flight', async () => {
    const user = userEvent.setup()
    renderPage()

    await submitWordFormLosingFocusInFlight(user, axiosErrorWith(429))

    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus())
  })

  it('network failure (no response): the generic "Could not sign in" copy, values kept', async () => {
    mockPost.mockRejectedValue(new AxiosError('Network Error'))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'dreyes', 'bluebird')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in. Please try again.',
    )
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('dreyes')
    expect(screen.getByLabelText("Today's word")).toHaveValue('bluebird')
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('network failure: focus is put back on the Sign in button after focus was lost in flight', async () => {
    const user = userEvent.setup()
    renderPage()

    await submitWordFormLosingFocusInFlight(user, new AxiosError('Network Error'))

    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Sign in' })).toHaveFocus())
  })

  it('401: focus lands on the cleared word field even though focus was lost in flight', async () => {
    const user = userEvent.setup()
    renderPage()

    await submitWordFormLosingFocusInFlight(user, axiosErrorWith(401))

    await screen.findByRole('alert')
    await waitFor(() => expect(screen.getByLabelText("Today's word")).toHaveFocus())
    expect(screen.getByLabelText("Today's word")).toHaveValue('')
    expect(screen.getByLabelText('Sign-in name')).toHaveValue('dreyes')
  })

  it.each([400, 500, 503])('status %i: the generic "Could not sign in" copy', async status => {
    mockPost.mockRejectedValue(axiosErrorWith(status))
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in. Please try again.',
    )
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('a malformed 200 body fails closed with the generic copy and stores nothing', async () => {
    mockPost.mockResolvedValue({ data: {} } as unknown as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in. Please try again.',
    )
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('the three failure messages are distinct from each other', async () => {
    const messages = new Set<string>()
    for (const status of [401, 429, 500]) {
      mockPost.mockReset()
      mockPost.mockRejectedValue(axiosErrorWith(status))
      const user = userEvent.setup()
      const { unmount } = renderPage()
      await submitWordForm(user)
      messages.add((await screen.findByRole('alert')).textContent ?? '')
      unmount()
    }
    expect(messages.size).toBe(3)
  })

  it('the Sign in button is re-enabled after a failure so the participant can retry', async () => {
    mockPost.mockRejectedValueOnce(axiosErrorWith(500))
    mockPost.mockResolvedValueOnce({
      data: { token: 'tok-retry' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, 'dreyes', 'bluebird')
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()

    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith('/'))
  })
})

describe('ParticipantSignInPage — the word never leaks (NFR-004 / NFR-009)', () => {
  const SECRET_WORD = 'zq-secret-word-7'
  const NAME = 'quentin.test'

  it.each([
    ['401', () => axiosErrorWith(401, { message: `bad word ${SECRET_WORD}` })],
    ['429', () => axiosErrorWith(429)],
    ['500', () => axiosErrorWith(500)],
    ['network', () => new AxiosError('Network Error')],
  ])('%s: the word reaches no console method, no URL and no alert text', async (_label, makeError) => {
    const consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map(method =>
      vi.spyOn(console, method).mockImplementation(() => {}),
    )
    mockPost.mockRejectedValue(makeError())
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, NAME, SECRET_WORD)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).not.toContain(SECRET_WORD)
    expect(alert.textContent).not.toContain(NAME)

    const logged = JSON.stringify(consoleSpies.flatMap(spy => spy.mock.calls.map(String)))
    expect(logged).not.toContain(SECRET_WORD)
    expect(window.location.href).not.toContain(SECRET_WORD)
    expect(window.location.href).not.toContain(NAME)
    expect(mockNavigate).not.toHaveBeenCalled()
    consoleSpies.forEach(spy => spy.mockRestore())
  })

  it('on a success the word is only in the request body, never in the navigation target', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-1' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await submitWordForm(user, NAME, SECRET_WORD)

    await waitFor(() => expect(mockNavigate).toHaveBeenCalledTimes(1))
    expect(mockNavigate).toHaveBeenCalledWith('/')
    expect(JSON.stringify(mockSetTokens.mock.calls)).not.toContain(SECRET_WORD)
  })
})

describe('ParticipantSignInPage — Password sign-in stores tokens (persisted) and navigates', () => {
  it('POSTs /auth/login, persists the envelope, and navigates to /', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-123', refreshToken: 'ref-456' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockPost).toHaveBeenCalledWith('/auth/login', {
      username: 'dreyes',
      password: 'correct-password',
    })
    await vi.waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith(
        { token: 'tok-123', refreshToken: 'ref-456' },
        { persist: true },
      ),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})

describe('ParticipantSignInPage — View-only code sign-in stores tokens (persisted) and navigates', () => {
  it('POSTs /auth/shared, persists the envelope (EL-10), and navigates to /', async () => {
    mockPost.mockResolvedValue({
      data: { token: 'tok-999' },
    } as Awaited<ReturnType<typeof api.post>>)
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)
    await user.type(screen.getByLabelText('View-only code'), 'shared-code-123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(mockPost).toHaveBeenCalledWith('/auth/shared', { password: 'shared-code-123' })
    await vi.waitFor(() =>
      expect(mockSetTokens).toHaveBeenCalledWith(
        { token: 'tok-999', refreshToken: undefined },
        { persist: true },
      ),
    )
    expect(mockNavigate).toHaveBeenCalledWith('/')
  })
})

describe('ParticipantSignInPage — 401 anti-enumeration handling on the older forms (NFR-009)', () => {
  it('Password form: shows the generic message and clears ONLY the password field', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
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

  it('View-only form: shows the generic message and clears the shared password field', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)
    await user.type(screen.getByLabelText('View-only code'), 'wrong-code')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("That view-only code wasn't recognized.")
    expect(alert).not.toHaveTextContent(/exercise code/i)
    expect(screen.getByLabelText('View-only code')).toHaveValue('')
    expect(mockSetTokens).not.toHaveBeenCalled()
    expect(mockNavigate).not.toHaveBeenCalled()
  })

  it('never distinguishes "no such handle" from "wrong password" — same message either way', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401, { message: 'no such handle: nobody' }))
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
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

    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('Could not sign in. Please try again.')
  })

  it('a 429 on the older forms keeps their existing generic copy (only Today\'s word has its own)', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(429))
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not sign in. Please try again.',
    )
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
    expect(screen.getByLabelText('Sign-in name')).toBeInTheDocument()
    expect(screen.getByLabelText("Today's word")).toBeInTheDocument()

    await vi.waitFor(() => expect(mockResolveExerciseContext).toHaveBeenCalled())

    // Still generic + still a working form after the rejection settles.
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('renders the generic heading immediately while the lookup is still pending', () => {
    mockResolveExerciseContext.mockReturnValue(new Promise(() => {})) // never resolves
    renderPage()

    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByLabelText('Sign-in name')).toBeInTheDocument()
  })

  it('has exactly one <h1> and a <main> landmark', () => {
    renderPage()

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('main')).toBeInTheDocument()
  })
})

describe('ParticipantSignInPage — staff link (feature: login, story 04, AC2)', () => {
  it('renders a real, labelled <a> to STAFF_LOGIN_PATH — never a styled div/onClick', () => {
    renderPage()

    const link = screen.getByRole('link', { name: /sign in here/i })
    expect(link.tagName).toBe('A')
    expect(link).toHaveAttribute('href', STAFF_LOGIN_PATH)
  })

  it('renders the "Staff or controller?" copy alongside the link', () => {
    renderPage()

    expect(screen.getByText(/staff or controller\?/i)).toBeInTheDocument()
  })

  it('keeps the link on every method', async () => {
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
    expect(screen.getByRole('link', { name: /sign in here/i })).toBeInTheDocument()
    await openViewOnlyForm(user)
    expect(screen.getByRole('link', { name: /sign in here/i })).toBeInTheDocument()
  })
})

describe('ParticipantSignInPage — submit-in-flight is announced (aria-live; Gate-1 S-4)', () => {
  it('has the role="status" aria-live="polite" region mounted from the start, and EMPTY while idle', () => {
    renderPage()

    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()
  })

  it('Today\'s word: the SAME region swaps its text to "Signing in…" while in flight', async () => {
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()
    const statusBefore = screen.getByRole('status')

    await submitWordForm(user)

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signing in…'))
    const status = screen.getByRole('status')
    // Not a freshly inserted node: a live region that already existed is what
    // screen readers announce changes to.
    expect(status).toBe(statusBefore)
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('the region empties again, still the same node, once the request settles', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(500))
    const user = userEvent.setup()
    renderPage()
    const statusBefore = screen.getByRole('status')

    await submitWordForm(user)
    await screen.findByRole('alert')

    expect(screen.getByRole('status')).toBe(statusBefore)
    await waitFor(() => expect(statusBefore).toBeEmptyDOMElement())
    expect(screen.getAllByRole('status')).toHaveLength(1)
  })

  it('Password: the same region announces "Signing in…" and the submit button is disabled', async () => {
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)
    await user.type(screen.getByLabelText('Handle'), 'dreyes')
    await user.type(screen.getByLabelText('Password'), 'correct-password')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signing in…'))
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite')
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })

  it('View-only code: the same region announces "Signing in…" and the submit button is disabled', async () => {
    mockPost.mockReturnValue(new Promise(() => {})) // never resolves
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)
    await user.type(screen.getByLabelText('View-only code'), 'shared-code-123')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signing in…'))
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeDisabled()
  })
})

describe('ParticipantSignInPage — one credential, one name (Gate-1 W-1)', () => {
  it('the view-only form is "Sign in with a view-only code" with a "View-only code" field', async () => {
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)

    expect(
      screen.getByRole('form', { name: 'Sign in with a view-only code' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('View-only code')).toHaveAttribute('type', 'password')
  })

  it('"Exercise code" appears nowhere on the page, on any of the three methods', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(document.body).not.toHaveTextContent(/exercise code/i)
    await openPasswordForm(user)
    expect(document.body).not.toHaveTextContent(/exercise code/i)
    await openViewOnlyForm(user)
    expect(document.body).not.toHaveTextContent(/exercise code/i)
    expect(screen.queryByLabelText('Exercise code')).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: /exercise code/i })).not.toBeInTheDocument()
  })

  it('the toggle, the field and the 401 message all say "view-only code"', async () => {
    mockPost.mockRejectedValue(axiosErrorWith(401))
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)
    await user.type(screen.getByLabelText('View-only code'), 'wrong-code')
    await user.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(
      "That view-only code wasn't recognized.",
    )
  })
})

describe('ParticipantSignInPage — a native submit can never put credentials in the URL (Gate-1 S-6)', () => {
  it("Today's word form is method=\"post\"", () => {
    renderPage()

    expect(screen.getByRole('form', { name: "Sign in with today's word" })).toHaveAttribute(
      'method',
      'post',
    )
  })

  it('Password form is method="post"', async () => {
    const user = userEvent.setup()
    renderPage()

    await openPasswordForm(user)

    expect(screen.getByRole('form', { name: 'Sign in with your account' })).toHaveAttribute(
      'method',
      'post',
    )
  })

  it('View-only code form is method="post"', async () => {
    const user = userEvent.setup()
    renderPage()

    await openViewOnlyForm(user)

    expect(screen.getByRole('form', { name: 'Sign in with a view-only code' })).toHaveAttribute(
      'method',
      'post',
    )
  })
})
