/**
 * features/controller/components/PersonaComposer.live.test.tsx
 * ---------------------------------------------------------------------------
 * The v2 composer in LIVE mode through the rendered DOM (demo-polish C1, story 17
 * "Visible errors, no false success"; CTL-001, XC-004, NFR-001). `USE_MOCK_DATA` is
 * forced false file-wide and `livePostActions.publishPost` is replaced, so the test
 * decides what the server answers.
 *
 *  - a publish is AWAITED: "Posting..." while in flight (form locked, Post disabled),
 *    then "Posted" with the NEW post's scenario time (the server's, in the exercise
 *    zone) and the unchanged R-003 origin line;
 *  - a rejection shows an error banner (role="alert") with the SERVER's message and a
 *    Retry, KEEPS the draft, and never shows "Posted" or the origin line - the old
 *    `.catch(() => {})` that made the console look successful is gone;
 *  - Retry re-sends the same draft; an unreadable 2xx warns that the post may already
 *    be live;
 *  - in live mode the client emits NO XC-004 event (the server's is the one);
 *  - media / reply ride on the body; the reply target is dropped only after success.
 *
 * `@/core/exerciseContext` is mocked (no provider tree); the picker (a `useQuery`) is
 * covered in `PersonaComposer.v2.test.tsx`, so this file attaches via the fake uploader.
 */
import { useState, type ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { uploadPickedMedia } from '@/core/media/uploadMedia'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, Post, ReplyTarget } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer, type PersonaComposerProps } from './PersonaComposer'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined), get: vi.fn() },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/features/social/services/livePostActions', () => ({ publishPost: vi.fn() }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/media/uploadMedia', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media/uploadMedia')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

import { publishPost } from '@/features/social/services/livePostActions'

/** The text field is named by its visible label: "Post as X" / "Reply as X". */
const POST_FIELD = /^(Post|Reply) as Fairhaven Water$/

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

const REPLY_TARGET: ReplyTarget = {
  postId: '4f9c1f6e-0000-4000-8000-000000000042',
  authorHandle: 'pio_jones',
  authorDisplayName: 'PIO Jones',
  excerpt: 'Is the water safe to drink?',
}

/** The server's 201 body (a `StaffPostDto`): its scenario time is what "Posted" shows. */
const CREATED: CreatedPostView = {
  id: '4f9c1f6e-0000-4000-8000-0000000000aa',
  authorPersonaId: 'persona-fairhavenwater',
  text: 'Zones 2-4 are clear.',
  scenarioTime: '2033-09-04T15:30:00.0000000+00:00',
  counts: { reply: 0, repost: 0, like: 0 },
}

let uploader: FakeUploader

function httpError(status: number, data: unknown): AxiosError {
  return new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: {} as never,
    data,
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

function renderComposer(props: Partial<PersonaComposerProps> = {}) {
  return render(
    <Providers>
      <PersonaComposer
        activePersona={PERSONA}
        actingHumanId="human-ctl-7"
        callSign="SIMCELL-3"
        {...props}
      />
    </Providers>,
  )
}

function lastBody() {
  const calls = vi.mocked(publishPost).mock.calls
  return calls[calls.length - 1]?.[0]
}

const postButton = () => screen.getByRole('button', { name: 'Post' })

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(publishPost).mockReset().mockResolvedValue(CREATED)
  resetTelemetryBuffer()
  composeAsPersonaDraftStore.resetForTests()
  uploader = installFakeUploader(vi.mocked(uploadPickedMedia))
})

describe('PersonaComposer (live) — success is awaited and shown', () => {
  it('says "Posting..." and locks the form while in flight, then "Posted" with the post\'s scenario time', async () => {
    let finish: (view: CreatedPostView) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(resolve => {
      finish = resolve
    }))
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Zones 2-4 are clear.')

    await user.click(postButton())

    expect(await screen.findByTestId('publishing')).toHaveTextContent('Posting...')
    expect(postButton()).toBeDisabled()
    expect(screen.getByLabelText(POST_FIELD)).toHaveAttribute('readonly')
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(onPublished).not.toHaveBeenCalled()

    finish(CREATED)

    const success = await screen.findByTestId('publish-success')
    expect(success).toHaveTextContent('Posted')
    // 15:30Z is 11:30 AM in the exercise zone - SCENARIO time, from the server's response.
    expect(screen.getByTestId('publish-success-time')).toHaveTextContent('Sep 4, 2033, 11:30 AM')
    expect(screen.queryByTestId('publishing')).not.toBeInTheDocument()
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('')
    expect(screen.getByLabelText(POST_FIELD)).not.toHaveAttribute('readonly')
    expect(screen.getByTestId('origin-label')).toHaveTextContent('SIMCELL · MANUAL')
    expect(screen.getByTestId('origin-line')).toHaveTextContent('SIMCELL-3')
    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished.mock.calls[0]?.[0]?.id).toBe(CREATED.id)
  })

  it('emits NO client telemetry in live mode - the server\'s event is the one', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'One event, not two.')

    await user.click(postButton())
    await screen.findByTestId('publish-success')

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('ignores a second Ctrl+Enter while a publish is in flight', async () => {
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(() => undefined))
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Once only.')

    await user.keyboard('{Control>}{Enter}{Enter}{Enter}{/Control}')

    expect(publishPost).toHaveBeenCalledTimes(1)
  })
})

describe('PersonaComposer (live) — failure is visible, keeps the draft, never claims success', () => {
  it('shows the server\'s message with a Retry; the draft stays; no "Posted", no origin line', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(
      httpError(400, 'engagementBaseline values must be between 0 and 1000000.'),
    )
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'This one is refused.')

    await user.click(postButton())

    const banner = await screen.findByTestId('publish-error')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Post failed (HTTP 400)')
    expect(screen.getByTestId('publish-error-message')).toHaveTextContent(
      'engagementBaseline values must be between 0 and 1000000.',
    )
    expect(banner).toHaveTextContent('Your draft is kept.')
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeEnabled()
    // Focus stays on the (re-enabled) Post button - it never falls to <body>.
    expect(postButton()).toHaveFocus()
    // No false success anywhere.
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(screen.queryByTestId('origin-line')).not.toBeInTheDocument()
    expect(onPublished).not.toHaveBeenCalled()
    // The draft is intact and editable.
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('This one is refused.')
    expect(screen.getByLabelText(POST_FIELD)).not.toHaveAttribute('readonly')
    expect(postButton()).toBeEnabled()
  })

  it('Retry re-sends the same draft; success replaces the banner with "Posted"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(503, { error: 'unavailable' }))
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    renderComposer({ onPublished })
    await user.type(screen.getByLabelText(POST_FIELD), 'Second time lucky.')
    await user.click(postButton())
    const banner = await screen.findByTestId('publish-error')
    expect(banner).toHaveTextContent('The service is not available right now.')

    await user.click(within(banner).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('publish-success')).toBeInTheDocument()
    expect(screen.queryByTestId('publish-error')).not.toBeInTheDocument()
    // The Retry button went with the banner: focus lands on the text field, not <body>.
    expect(screen.getByLabelText(POST_FIELD)).toHaveFocus()
    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].text).toBe('Second time lucky.')
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].text).toBe('Second time lucky.')
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('a stale "Posted" never sits beside a later failure', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'First.')
    await user.click(postButton())
    await screen.findByTestId('publish-success')
    expect(screen.getByTestId('origin-line')).toBeInTheDocument()

    vi.mocked(publishPost).mockRejectedValueOnce(httpError(403, 'Exercise is not live.'))
    await user.type(screen.getByLabelText(POST_FIELD), 'Second.')
    await user.click(postButton())

    expect(await screen.findByTestId('publish-error')).toHaveTextContent('Exercise is not live.')
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(screen.queryByTestId('origin-line')).not.toBeInTheDocument()
  })
})

describe('PersonaComposer (live) — media, reply and baseline on the body', () => {
  it('sends the uploaded asset as { mediaId, alt } and no exercise id on the wire body', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Photo.')
    fireEvent.change(screen.getByTestId('persona-composer-file-input'), {
      target: { files: [fakeFile('flood.png', 'image/png')] },
    })
    await screen.findByTestId('attachment')
    const asset = uploader.byName('flood.png').resolve()
    await waitFor(() => expect(screen.getByText('Uploaded')).toBeInTheDocument())
    await user.type(screen.getByRole('textbox', { name: /Alt text for flood\.png/ }), 'Flooded street')

    await user.click(postButton())
    await screen.findByTestId('publish-success')

    expect(lastBody()?.media).toEqual([{ mediaId: asset.id, alt: 'Flooded street' }])
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('a reply carries parentPostId; the target is dropped only AFTER success', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(400, 'parentPostId is not a valid post.'))
    const onClearReply = vi.fn()
    const user = userEvent.setup()
    renderComposer({ replyTo: REPLY_TARGET, onClearReply })
    await user.type(screen.getByLabelText(POST_FIELD), 'Yes - it is safe.')

    await user.click(postButton())
    await screen.findByTestId('publish-error')
    expect(lastBody()?.parentPostId).toBe(REPLY_TARGET.postId)
    expect(onClearReply).not.toHaveBeenCalled()
    expect(screen.getByTestId('reply-banner')).toBeInTheDocument()

    await user.click(within(screen.getByTestId('publish-error')).getByRole('button', { name: 'Retry' }))
    await screen.findByTestId('publish-success')

    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('sends the starting engagement as engagementBaseline', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Trending.')
    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))
    await user.click(screen.getByRole('button', { name: 'Set Like to 2.3K' }))
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '86')

    await user.click(postButton())
    await screen.findByTestId('publish-success')

    expect(lastBody()?.engagementBaseline).toEqual({ like: 2300, reply: 86 })
  })
})

describe('PersonaComposer (live) — a post that MAY ALREADY BE LIVE (status unknown)', () => {
  const GATEWAY_TIMEOUT = () => httpError(504, undefined)

  async function fireAndFailWith504(props: Partial<PersonaComposerProps> = {}) {
    vi.mocked(publishPost).mockRejectedValueOnce(GATEWAY_TIMEOUT())
    const user = userEvent.setup()
    const utils = renderComposer(props)
    await user.type(screen.getByLabelText(POST_FIELD), 'Boil-water order lifted for Zones 2-4.')
    await user.click(postButton())
    await screen.findByTestId('publish-unconfirmed')
    return { user, ...utils }
  }

  it('is titled "Post status unknown" (not "failed"), says why, and offers NO plain Retry', async () => {
    await fireAndFailWith504()

    const banner = screen.getByTestId('publish-unconfirmed')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Post status unknown (HTTP 504)')
    expect(banner).not.toHaveTextContent('Post failed')
    expect(banner).toHaveTextContent('The post may already be live - check the feed')
    expect(within(banner).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('publish-error')).not.toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: 'Post again anyway…' })).toBeEnabled()
    expect(within(banner).getByRole('button', { name: 'Discard draft (it went out)' }))
      .toBeEnabled()
    // Still no false success.
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(screen.queryByTestId('origin-line')).not.toBeInTheDocument()
  })

  it('treats a response-less failure (a dropped connection) the same way', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Dropped.')

    await user.click(postButton())

    const banner = await screen.findByTestId('publish-unconfirmed')
    expect(banner).toHaveTextContent('Post status unknown')
    expect(screen.getByTestId('publish-error-message')).toHaveTextContent(/may have gone out/)
    expect(within(banner).queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument()
  })

  it('an unreadable 2xx is the same: status unknown, nothing auto-sent', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(
      new Error('publishPost: the server returned a malformed post'),
    )
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Maybe sent.')

    await user.click(postButton())

    expect(await screen.findByTestId('publish-unconfirmed')).toBeInTheDocument()
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('focus goes to the MESSAGE (tabIndex -1), never to a button; Post is disabled and explained', async () => {
    await fireAndFailWith504()

    const message = screen.getByTestId('publish-error-message')
    expect(message).toHaveAttribute('tabindex', '-1')
    expect(message).toHaveFocus()
    expect(postButton()).toBeDisabled()
    expect(screen.getByTestId('publish-blockers')).toHaveTextContent('Post is paused')
    expect(postButton()).toHaveAccessibleDescription(/Post is paused/)
  })

  it('ONE Enter (or a click, or Ctrl/Cmd+Enter) after a 504 does not call publishPost again', async () => {
    const { user } = await fireAndFailWith504()
    expect(publishPost).toHaveBeenCalledTimes(1)

    await user.keyboard('{Enter}')
    await user.keyboard('{Enter}')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    // A disabled button takes no pointer input at all; the click handler is never reached.
    fireEvent.click(postButton())
    fireEvent.submit(screen.getByTestId('persona-composer'))

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(screen.getByTestId('publish-unconfirmed')).toBeInTheDocument()
  })

  it('also blocks Ctrl+Enter from inside the text field', async () => {
    const { user } = await fireAndFailWith504()

    await user.click(screen.getByLabelText(POST_FIELD))
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('the two-step path re-sends: "Post again anyway…" -> "I checked the feed — post again"', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { user } = await fireAndFailWith504({ onPublished })

    await user.click(screen.getByRole('button', { name: 'Post again anyway…' }))

    // Step one only ARMS the choice: nothing is sent, the message holds focus, the
    // confirm is one deliberate Tab away.
    expect(publishPost).toHaveBeenCalledTimes(1)
    const banner = screen.getByTestId('publish-unconfirmed')
    expect(within(banner).queryByRole('button', { name: 'Post again anyway…' })).not.toBeInTheDocument()
    expect(screen.getByTestId('publish-error-message')).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(publishPost).toHaveBeenCalledTimes(1)

    await user.tab()
    expect(within(banner).getByRole('button', { name: 'I checked the feed — post again' }))
      .toHaveFocus()
    await user.keyboard('{Enter}')

    await screen.findByTestId('publish-success')
    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].text).toBe('Boil-water order lifted for Zones 2-4.')
    expect(screen.queryByTestId('publish-unconfirmed')).not.toBeInTheDocument()
    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('')
    expect(screen.getByLabelText(POST_FIELD)).toHaveFocus()
  })

  it('"Back" returns from the confirm step to the two choices without sending', async () => {
    const { user } = await fireAndFailWith504()
    await user.click(screen.getByRole('button', { name: 'Post again anyway…' }))

    await user.click(screen.getByRole('button', { name: 'Back' }))

    expect(screen.getByRole('button', { name: 'Post again anyway…' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard draft (it went out)' })).toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('"Discard draft (it went out)" clears the draft and the gate without posting', async () => {
    const onPublished = vi.fn<(post: Post) => void>()
    const { user } = await fireAndFailWith504({ onPublished })

    await user.click(screen.getByRole('button', { name: 'Discard draft (it went out)' }))

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(onPublished).not.toHaveBeenCalled()
    expect(screen.queryByTestId('publish-unconfirmed')).not.toBeInTheDocument()
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('')
    expect(screen.getByLabelText(POST_FIELD)).toHaveFocus()
    expect(postButton()).toBeDisabled()
  })

  it('discarding a reply that went out drops its reply target', async () => {
    const onClearReply = vi.fn()
    const { user } = await fireAndFailWith504({ replyTo: REPLY_TARGET, onClearReply })

    await user.click(screen.getByRole('button', { name: 'Discard draft (it went out)' }))

    expect(onClearReply).toHaveBeenCalledTimes(1)
  })

  it('a plain failure (a 503 answer) keeps the ordinary Retry - the gate is only for "may be live"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(503, { error: 'unavailable' }))
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText(POST_FIELD), 'Server busy.')

    await user.click(postButton())

    const banner = await screen.findByTestId('publish-error')
    expect(banner).toHaveTextContent('Post failed (HTTP 503)')
    expect(within(banner).getByRole('button', { name: 'Retry' })).toBeEnabled()
    expect(screen.queryByTestId('publish-unconfirmed')).not.toBeInTheDocument()
    expect(postButton()).toBeEnabled()
  })

  it('a remount (dock closed and reopened) still asks before it will post again', async () => {
    const { unmount } = await fireAndFailWith504()
    unmount()

    renderComposer()

    expect(await screen.findByTestId('publish-unconfirmed')).toBeInTheDocument()
    expect(screen.getByLabelText(POST_FIELD)).toHaveValue('Boil-water order lifted for Zones 2-4.')
    expect(postButton()).toBeDisabled()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })
})

describe('PersonaComposer (live) — the library cannot change under a post in flight', () => {
  const LIBRARY_ROW = {
    id: 'asset-live-1',
    kind: 'image',
    url: 'https://blob.example.test/a.png',
    fileName: 'live-a.png',
    uploadedAtScenario: '2033-09-04T12:00:00.000Z',
  }

  it('the open picker panel is inert (and its button disabled) until the response lands', async () => {
    vi.mocked(api.get).mockResolvedValue({ data: [LIBRARY_ROW] })
    let finish: (view: CreatedPostView) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(resolve => {
      finish = resolve
    }))
    const user = userEvent.setup()
    renderComposer()
    await user.click(screen.getByRole('button', { name: 'From library' }))
    await user.click(await screen.findByRole('option', { name: /live-a\.png/ }))
    await user.type(screen.getByRole('textbox', { name: /Alt text for live-a\.png/ }), 'A picture')
    await user.type(screen.getByLabelText(POST_FIELD), 'With a picture.')
    expect(screen.getByTestId('library-panel')).not.toHaveAttribute('inert')

    await user.click(postButton())

    expect(await screen.findByTestId('publishing')).toBeInTheDocument()
    expect(screen.getByTestId('library-panel')).toHaveAttribute('inert')
    expect(screen.getByRole('button', { name: 'From library' })).toBeDisabled()
    // Even a click that reaches the picker (inert is a browser behaviour) cannot edit the tray.
    fireEvent.click(screen.getByRole('option', { name: /live-a\.png/ }))
    expect(screen.getAllByTestId('attachment')).toHaveLength(1)
    expect(lastBody()?.media).toEqual([{ mediaId: 'asset-live-1', alt: 'A picture' }])

    finish(CREATED)
    await screen.findByTestId('publish-success')
    expect(screen.queryByTestId('attachment')).not.toBeInTheDocument()
    expect(screen.getByTestId('library-panel')).not.toHaveAttribute('inert')
  })
})
