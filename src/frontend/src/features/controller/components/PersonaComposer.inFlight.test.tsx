/**
 * features/controller/components/PersonaComposer.inFlight.test.tsx
 * ---------------------------------------------------------------------------
 * The duplicate-post probe, through the RENDERED composer in LIVE mode (Copilot review of PR #463,
 * finding 1; CTL-001, #455 "post create is not idempotent"). The sequence the controller can hit:
 *
 *   1. Post is pressed; the live `POST /api/posts` is slow (the gateway may hold it for 230 s);
 *   2. a toolstrip tool (ENGINE / USAGE) takes the dock over: the composer UNMOUNTS and its draft
 *      stays in the draft store (success has not cleared it yet);
 *   3. the controller reopens the same persona: a NEW composer, seeded with the SAME draft;
 *   4. Post goes out again - a second, identical post - unless the new composer knows.
 *
 * The in-flight guard is now session-wide (`useComposeAsPersona`'s `inFlightByKey`) and the new
 * composer ADOPTS the request. These tests pin, in the DOM:
 *   - the reopened composer shows the SAME "Posting..." state, read-only, with Post disabled;
 *   - pressing Post, the form's own submit, Ctrl+Enter, or (after a 504) "post again" sends
 *     exactly ONE request in total - never a second;
 *   - when the request settles the reopened composer shows the outcome: "Posted" with the empty
 *     field, the "Post status unknown" question with the draft kept, or the failure banner with a
 *     Retry - and raises NO toast (the off-screen toast is only for when nobody is looking).
 *
 * An EXPLICIT close (Esc / X: `closeDock` discards the draft) discards the draft, NOT the request:
 * the persona stays locked until that request settles (bounded by the publish deadline), so the
 * reopened composer is an adopter too - there is never a second request live on a key.
 *
 * The hook-level cases (reply target, sign-out, two personas, target switching) are in
 * `../hooks/useComposeAsPersona.inFlight.test.tsx`. Harness as `PersonaComposer.gate2.test.tsx`.
 */
import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosError } from 'axios'
import { toast } from 'react-toastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView } from '@/features/social'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer } from './PersonaComposer'

// Demo-feedback story 11 (DF-14): the console's write controls render only for a controller
// session, and this suite mounts none, so the read-only gate is fixed to "controller" here.
vi.mock('@/features/controller/access/useCanControl', () => ({
  useCanControl: () => true,
  useCanEditContent: () => true,
  useCanStaffPost: () => true,
  useCanStaffPin: () => true,
}))

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined), get: vi.fn() },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/features/social/services/livePostActions', () => ({ publishPost: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { publishPost } from '@/features/social/services/livePostActions'

vi.setConfig({ testTimeout: 30_000 })

const POST_FIELD = /^(Post|Reply) as Fairhaven Water$/
const DRAFT = 'Boil-water order lifted for zones 2-4.'

const PERSONA: StaffPersona = {
  id: 'persona-fairhavenwater',
  exerciseId: 'ex-live-0001',
  templateId: 'tmpl-fairhaven-water',
  displayName: 'Fairhaven Water',
  handle: 'FairhavenWater',
  kind: 'org',
  personaType: 'agency',
  verified: true,
  avatarColor: '#1d4ed8',
  initials: 'FW',
  audienceBand: 'mid',
  followerCount: 4200,
  joinedAt: '2030-01-01T00:00:00Z',
}

const CREATED: CreatedPostView = {
  id: '4f9c1f6e-0000-4000-8000-0000000000aa',
  authorPersonaId: 'persona-fairhavenwater',
  text: DRAFT,
  scenarioTime: '2033-09-04T15:30:00.0000000+00:00',
  counts: { reply: 0, repost: 0, like: 0 },
}

function httpError(status: number): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data: undefined,
  })
}

function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  )
  return (
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </ThemeProvider>
  )
}

/** The dock: the composer is on screen while `open` (closing it is the ENGINE takeover). */
function Dock({ open }: { open: boolean }) {
  return (
    <Providers>
      {open && (
        <PersonaComposer activePersona={PERSONA} actingHumanId="human-ctl-7" callSign="SIMCELL-3" />
      )}
    </Providers>
  )
}

/** The next `publishPost` call, settled by hand. */
function pendingRequest() {
  let resolve: (view: CreatedPostView) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<CreatedPostView>((res, rej) => {
    resolve = res
    reject = rej
  })
  vi.mocked(publishPost).mockReturnValueOnce(promise)
  return {
    succeed: () => act(async () => { resolve(CREATED) }),
    fail: (status: number) => act(async () => { reject(httpError(status)) }),
  }
}

const field = () => screen.getByLabelText<HTMLTextAreaElement>(POST_FIELD)
const postButton = () => screen.getByRole('button', { name: 'Post' })

/**
 * Post is pressed (Ctrl+Enter) with the draft typed; the request stays out; then the dock is taken
 * over (the composer unmounts) and reopened (a new composer mounts).
 */
async function postThenTakeOverThenReopen() {
  const view = render(<Dock open />)
  fireEvent.change(field(), { target: { value: DRAFT } })
  fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
  expect(await screen.findByTestId('publishing')).toBeInTheDocument()
  expect(publishPost).toHaveBeenCalledTimes(1)

  view.rerender(<Dock open={false} />)
  expect(screen.queryByTestId('persona-composer')).toBeNull()
  view.rerender(<Dock open />)
  return view
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(publishPost).mockReset().mockResolvedValue(CREATED)
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  composeAsPersonaDraftStore.resetForTests()
})

describe('the composer reopened while its post is still out', () => {
  it('comes back LOCKED on the same draft, showing the same "Posting..." state', async () => {
    pendingRequest()
    await postThenTakeOverThenReopen()

    expect(screen.getByTestId('publishing')).toHaveTextContent('Posting...')
    expect(field().value).toBe(DRAFT)
    expect(field().readOnly).toBe(true)
    expect(postButton()).toBeDisabled()
    expect(screen.queryByTestId('publish-unconfirmed')).toBeNull()
    expect(screen.queryByTestId('publish-error')).toBeNull()
  })

  it('pressing Post sends NO second request (the duplicate-post probe)', async () => {
    const request = pendingRequest()
    await postThenTakeOverThenReopen()

    // The button is disabled (a real click does nothing) ...
    fireEvent.click(postButton())
    // ... and the form's own submit, which skips the button, must not be the way through either.
    fireEvent.submit(screen.getByTestId('persona-composer'))

    expect(publishPost).toHaveBeenCalledTimes(1)
    await request.succeed()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+Enter on the reopened composer sends NO second request either', async () => {
    const request = pendingRequest()
    await postThenTakeOverThenReopen()

    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })

    expect(publishPost).toHaveBeenCalledTimes(1)
    await request.succeed()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('a "post again anyway" that is still out locks the reopened composer: no third request', async () => {
    const first = pendingRequest()
    const view = render(<Dock open />)
    fireEvent.change(field(), { target: { value: DRAFT } })
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    await screen.findByTestId('publishing')
    await first.fail(504)
    await screen.findByTestId('publish-unconfirmed')

    const repost = pendingRequest()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Post again anyway…' }))
    await user.click(screen.getByRole('button', { name: 'I checked the feed — post again' }))
    await screen.findByTestId('publishing')
    expect(publishPost).toHaveBeenCalledTimes(2)

    view.rerender(<Dock open={false} />)
    view.rerender(<Dock open />)

    // Not the question again (which would offer yet another send): the repost is what is out.
    expect(screen.getByTestId('publishing')).toBeInTheDocument()
    expect(screen.queryByTestId('publish-unconfirmed')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Post again anyway…' })).toBeNull()
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    fireEvent.submit(screen.getByTestId('persona-composer'))
    expect(publishPost).toHaveBeenCalledTimes(2)

    await repost.succeed()
    expect(await screen.findByTestId('publish-success')).toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(2)
  })
})

describe('the reopened composer takes over the outcome', () => {
  it('SUCCESS: "Posted" with the scenario time, an empty field, no toast, and no draft left behind', async () => {
    const request = pendingRequest()
    const view = await postThenTakeOverThenReopen()

    await request.succeed()

    expect(await screen.findByTestId('publish-success')).toBeInTheDocument()
    expect(screen.getByTestId('publish-success-time')).toHaveTextContent('2033')
    expect(screen.getByTestId('origin-label')).toBeInTheDocument()
    expect(screen.queryByTestId('publishing')).toBeNull()
    expect(field().value).toBe('')
    expect(field().readOnly).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    // The next time the dock opens there is no leftover draft to send again.
    view.rerender(<Dock open={false} />)
    view.rerender(<Dock open />)
    expect(field().value).toBe('')
    expect(screen.queryByTestId('publish-success')).toBeNull()
  })

  it('UNCONFIRMED: the "Post status unknown" question with the draft kept, and no toast', async () => {
    const request = pendingRequest()
    await postThenTakeOverThenReopen()

    await request.fail(504)

    const banner = await screen.findByTestId('publish-unconfirmed')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Post status unknown')
    expect(field().value).toBe(DRAFT)
    expect(postButton()).toBeDisabled()
    expect(screen.queryByTestId('publishing')).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    // Still gated: a stray Ctrl+Enter does nothing; only the explicit two-step does.
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('FAILURE: the draft is back with the failure banner and a working Retry, and no toast', async () => {
    const request = pendingRequest()
    await postThenTakeOverThenReopen()

    await request.fail(429)

    const banner = await screen.findByTestId('publish-error')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Post failed (HTTP 429)')
    expect(field().value).toBe(DRAFT)
    expect(field().readOnly).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(publishPost).toHaveBeenCalledTimes(2)
  })

  it('CONTROL: with the dock still closed when the response lands, the toast is raised', async () => {
    const request = pendingRequest()
    const view = render(<Dock open />)
    fireEvent.change(field(), { target: { value: DRAFT } })
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    await screen.findByTestId('publishing')
    view.rerender(<Dock open={false} />)

    await request.fail(429)

    expect(toast.error).toHaveBeenCalledTimes(1)
    view.rerender(<Dock open />)
    expect(field().value).toBe(DRAFT)
    expect(screen.queryByTestId('publishing')).toBeNull()
  })
})

describe('after an explicit close (Esc / X) the persona stays locked', () => {
  /** Post is pressed, then the dock is closed the way `closeDock` does: unmount + discard. */
  async function postThenEscapeThenReopen() {
    const view = render(<Dock open />)
    fireEvent.change(field(), { target: { value: DRAFT } })
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(await screen.findByTestId('publishing')).toBeInTheDocument()
    view.rerender(<Dock open={false} />)
    composeAsPersonaDraftStore.discardDraft('ex-live-0001', PERSONA.id)
    view.rerender(<Dock open />)
    return view
  }

  it('the reopened composer is an adopter: "Posting...", read-only, nothing sendable', async () => {
    const request = pendingRequest()
    await postThenEscapeThenReopen()

    expect(screen.getByTestId('publishing')).toBeInTheDocument()
    expect(field().value).toBe('') // the draft was discarded; the request was not
    expect(field().readOnly).toBe(true)
    expect(postButton()).toBeDisabled()
    // Even a change event that gets past the read-only field (a script, a paste hook) is refused
    // by the hook: the field stays empty and so there is nothing for Post to send.
    fireEvent.change(field(), { target: { value: 'Correction: zones 2-3 only.' } })
    expect(field().value).toBe('')
    fireEvent.click(postButton())
    fireEvent.submit(screen.getByTestId('persona-composer'))
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true })

    expect(publishPost).toHaveBeenCalledTimes(1)
    await request.succeed()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('SUCCESS: "Posted", an empty field, no toast', async () => {
    const request = pendingRequest()
    await postThenEscapeThenReopen()

    await request.succeed()

    expect(await screen.findByTestId('publish-success')).toBeInTheDocument()
    expect(field().value).toBe('')
    expect(field().readOnly).toBe(false)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('UNCONFIRMED: the "Post status unknown" question with the text that was sent, no toast', async () => {
    const request = pendingRequest()
    await postThenEscapeThenReopen()

    await request.fail(504)

    const banner = await screen.findByTestId('publish-unconfirmed')
    expect(banner).toHaveTextContent('Post status unknown')
    expect(field().value).toBe(DRAFT)
    expect(postButton()).toBeDisabled()
    expect(toast.warning).not.toHaveBeenCalled()
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true })
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('FAILURE: the failure banner with the text back and a working Retry, no toast', async () => {
    const request = pendingRequest()
    await postThenEscapeThenReopen()

    await request.fail(429)

    expect(await screen.findByTestId('publish-error')).toHaveTextContent('Post failed (HTTP 429)')
    expect(field().value).toBe(DRAFT)
    expect(toast.error).not.toHaveBeenCalled()
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(publishPost).toHaveBeenCalledTimes(2)
  })
})
