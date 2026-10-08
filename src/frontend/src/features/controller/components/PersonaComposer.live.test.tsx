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
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import { uploadPickedMedia } from '@/core/media/uploadMedia'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, Post, ReplyTarget } from '@/features/social'
import { fakeFile, installFakeUploader, type FakeUploader } from '@/test/fakeMediaUploader'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer, type PersonaComposerProps } from './PersonaComposer'

vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/features/social/services/livePostActions', () => ({ publishPost: vi.fn() }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/media/uploadMedia', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/media/uploadMedia')>()
  return { ...actual, uploadPickedMedia: vi.fn() }
})

import { publishPost } from '@/features/social/services/livePostActions'

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
  return <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
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
    await user.type(screen.getByLabelText('Post text'), 'Zones 2-4 are clear.')

    await user.click(postButton())

    expect(await screen.findByTestId('publishing')).toHaveTextContent('Posting...')
    expect(postButton()).toBeDisabled()
    expect(screen.getByLabelText('Post text')).toHaveAttribute('readonly')
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(onPublished).not.toHaveBeenCalled()

    finish(CREATED)

    const success = await screen.findByTestId('publish-success')
    expect(success).toHaveTextContent('Posted')
    // 15:30Z is 11:30 AM in the exercise zone - SCENARIO time, from the server's response.
    expect(screen.getByTestId('publish-success-time')).toHaveTextContent('Sep 4, 2033, 11:30 AM')
    expect(screen.queryByTestId('publishing')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Post text')).toHaveValue('')
    expect(screen.getByLabelText('Post text')).not.toHaveAttribute('readonly')
    expect(screen.getByTestId('origin-label')).toHaveTextContent('SIMCELL · MANUAL')
    expect(screen.getByTestId('origin-line')).toHaveTextContent('SIMCELL-3')
    expect(onPublished).toHaveBeenCalledTimes(1)
    expect(onPublished.mock.calls[0]?.[0]?.id).toBe(CREATED.id)
  })

  it('emits NO client telemetry in live mode - the server\'s event is the one', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'One event, not two.')

    await user.click(postButton())
    await screen.findByTestId('publish-success')

    expect(publishPost).toHaveBeenCalledTimes(1)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('ignores a second Ctrl+Enter while a publish is in flight', async () => {
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(() => undefined))
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'Once only.')

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
    await user.type(screen.getByLabelText('Post text'), 'This one is refused.')

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
    expect(screen.getByLabelText('Post text')).toHaveValue('This one is refused.')
    expect(screen.getByLabelText('Post text')).not.toHaveAttribute('readonly')
    expect(postButton()).toBeEnabled()
  })

  it('Retry re-sends the same draft; success replaces the banner with "Posted"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(503, { error: 'unavailable' }))
    const onPublished = vi.fn<(post: Post) => void>()
    const user = userEvent.setup()
    renderComposer({ onPublished })
    await user.type(screen.getByLabelText('Post text'), 'Second time lucky.')
    await user.click(postButton())
    const banner = await screen.findByTestId('publish-error')
    expect(banner).toHaveTextContent('The service is not available right now.')

    await user.click(within(banner).getByRole('button', { name: 'Retry' }))

    expect(await screen.findByTestId('publish-success')).toBeInTheDocument()
    expect(screen.queryByTestId('publish-error')).not.toBeInTheDocument()
    // The Retry button went with the banner: focus lands on the text field, not <body>.
    expect(screen.getByLabelText('Post text')).toHaveFocus()
    expect(publishPost).toHaveBeenCalledTimes(2)
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].text).toBe('Second time lucky.')
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].text).toBe('Second time lucky.')
    expect(onPublished).toHaveBeenCalledTimes(1)
  })

  it('a network failure says the server could not be reached', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(new AxiosError('Network Error', 'ERR_NETWORK'))
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'Offline.')

    await user.click(postButton())

    expect(await screen.findByTestId('publish-error-message')).toHaveTextContent(
      'The server could not be reached.',
    )
  })

  it('an unreadable 2xx warns the post may ALREADY be live (no blind success, no silent retry)', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(
      new Error('publishPost: the server returned a malformed post'),
    )
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'Maybe sent.')

    await user.click(postButton())

    expect(await screen.findByTestId('publish-error-message')).toHaveTextContent(
      'The post may already be live - check the feed before posting again.',
    )
    expect(screen.queryByTestId('publish-success')).not.toBeInTheDocument()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('a stale "Posted" never sits beside a later failure', async () => {
    const user = userEvent.setup()
    renderComposer()
    await user.type(screen.getByLabelText('Post text'), 'First.')
    await user.click(postButton())
    await screen.findByTestId('publish-success')
    expect(screen.getByTestId('origin-line')).toBeInTheDocument()

    vi.mocked(publishPost).mockRejectedValueOnce(httpError(403, 'Exercise is not live.'))
    await user.type(screen.getByLabelText('Post text'), 'Second.')
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
    await user.type(screen.getByLabelText('Post text'), 'Photo.')
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
    await user.type(screen.getByLabelText('Post text'), 'Yes - it is safe.')

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
    await user.type(screen.getByLabelText('Post text'), 'Trending.')
    await user.click(screen.getByRole('button', { name: /Starting engagement/ }))
    await user.click(screen.getByRole('button', { name: 'Set Like to 2.3K' }))
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), '86')

    await user.click(postButton())
    await screen.findByTestId('publish-success')

    expect(lastBody()?.engagementBaseline).toEqual({ like: 2300, reply: 86 })
  })
})
