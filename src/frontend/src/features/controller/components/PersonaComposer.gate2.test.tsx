/**
 * features/controller/components/PersonaComposer.gate2.test.tsx
 * ---------------------------------------------------------------------------
 * The composer's seams found at Wave 3 Gate-2 (reviewer A), through the rendered DOM in LIVE
 * mode (`PersonaComposer.live.test.tsx`'s setup):
 *
 *  M-4  A "Post status unknown" outcome that lands LATE moves focus to its message ONLY when
 *       focus is lost (body / detached / disabled) or still inside the composer. Focus that
 *       the controller parked in a run-sheet control or a field elsewhere stays put (the
 *       banner is `role="alert"`, so it is announced anyway). The probe, as a test.
 *  M-2  The remounted draft's reply: "Replying to" comes back through `onRestoreReply`; with
 *       no way to restore it the composer explains what the draft was and pauses Post, and
 *       the (x) is disabled while a "did it go out?" question is open.
 *  L-3  A reply whose post was taken down: "The post you're replying to was taken down." with a
 *       Clear reply control, Post blocked and the reason said in words.
 *  S-1  "Reply as..." on another row while the dock is open focuses the text field.
 */
import { useState, type ReactNode } from 'react'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { AxiosError } from 'axios'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, ReplyTarget } from '@/features/social'
import { removedPosts } from '@/features/social/services/removedPosts'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { PersonaComposer, type PersonaComposerProps } from './PersonaComposer'

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

const TARGET_A: ReplyTarget = {
  postId: '4f9c1f6e-0000-4000-8000-00000000000a',
  authorHandle: 'pio_jones',
  authorDisplayName: 'PIO Jones',
  excerpt: 'Is the water safe to drink?',
}
const TARGET_B: ReplyTarget = {
  postId: '4f9c1f6e-0000-4000-8000-00000000000b',
  authorHandle: 'mvega_fh',
  authorDisplayName: 'Maria Vega',
  excerpt: 'My kids drank tap water this morning.',
}

const CREATED: CreatedPostView = {
  id: '4f9c1f6e-0000-4000-8000-0000000000aa',
  authorPersonaId: 'persona-fairhavenwater',
  text: 'x',
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

function composer(props: Partial<PersonaComposerProps> = {}) {
  return (
    <PersonaComposer
      activePersona={PERSONA}
      actingHumanId="human-ctl-7"
      callSign="SIMCELL-3"
      {...props}
    />
  )
}

/** The route's role, minimally: holds the reply target and restores it on request. */
function ReplyHarness({
  initial,
  dockOpen = true,
  withRestore = true,
}: {
  initial?: ReplyTarget
  dockOpen?: boolean
  withRestore?: boolean
}) {
  const [replyTo, setReplyTo] = useState<ReplyTarget | undefined>(initial)
  return (
    <>
      <button type="button" onClick={() => setReplyTo(TARGET_B)}>reply as B (elsewhere)</button>
      <button type="button" onClick={() => setReplyTo(undefined)}>route drops the target</button>
      {dockOpen && composer({
        ...(replyTo !== undefined ? { replyTo } : {}),
        onClearReply: () => setReplyTo(undefined),
        ...(withRestore ? { onRestoreReply: setReplyTo } : {}),
      })}
    </>
  )
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-live-0001',
    exerciseName: 'Coastal Surge (Live)',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(publishPost).mockReset().mockResolvedValue(CREATED)
  composeAsPersonaDraftStore.resetForTests()
  removedPosts.resetForTests()
})

describe('M-4 - a late "status unknown" does not steal focus', () => {
  /** Starts a publish that stays in flight; resolves to a function that fails it with `status`. */
  async function inFlightPost() {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    render(
      <Providers>
        <input aria-label="run sheet name (elsewhere)" />
        <button type="button">a run-sheet control (elsewhere)</button>
        {composer()}
      </Providers>,
    )
    const field = screen.getByLabelText(POST_FIELD)
    fireEvent.change(field, { target: { value: 'Breaking: boil-water order' } })
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true })
    expect(await screen.findByTestId('publishing')).toBeInTheDocument()
    return (status: number) => act(async () => { fail(httpError(status)) })
  }

  it('leaves focus in a text field the controller moved to (the probe)', async () => {
    const land = await inFlightPost()
    const elsewhere = screen.getByLabelText('run sheet name (elsewhere)')
    elsewhere.focus()

    await land(504)

    const banner = await screen.findByTestId('publish-unconfirmed')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(document.activeElement).toBe(elsewhere)
  })

  it('leaves focus on a control in another panel (a run-sheet beat, a live-world row)', async () => {
    const land = await inFlightPost()
    const control = screen.getByRole('button', { name: 'a run-sheet control (elsewhere)' })
    control.focus()

    await land(503)

    await screen.findByTestId('publish-unconfirmed')
    expect(document.activeElement).toBe(control)
  })

  it('still moves focus to the message when focus is LOST (body)', async () => {
    const land = await inFlightPost()
    ;(document.activeElement as HTMLElement | null)?.blur()
    expect(document.activeElement).toBe(document.body)

    await land(504)

    await screen.findByTestId('publish-unconfirmed')
    expect(document.activeElement).toBe(screen.getByTestId('publish-error-message'))
  })

  it('still moves focus to the message when focus is still inside the composer', async () => {
    const land = await inFlightPost()
    // The text field (read-only while posting) keeps the focus the Ctrl+Enter left there.
    screen.getByLabelText(POST_FIELD).focus()

    await land(504)

    await screen.findByTestId('publish-unconfirmed')
    expect(document.activeElement).toBe(screen.getByTestId('publish-error-message'))
  })

  it('still moves focus to the message when the focused control was removed from the page', async () => {
    const land = await inFlightPost()
    const gone = document.createElement('button')
    document.body.appendChild(gone)
    gone.focus()
    gone.remove()

    await land(504)

    await screen.findByTestId('publish-unconfirmed')
    expect(document.activeElement).toBe(screen.getByTestId('publish-error-message'))
  })
})

describe('M-2 - the remounted draft and its reply', () => {
  async function replyThatMayBeLive() {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const user = userEvent.setup()
    const view = render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), '@pio_jones yes, it is safe')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByTestId('publish-unconfirmed')
    return { user, view }
  }

  it('disables the (x) while a "did it go out?" question about the reply is open', async () => {
    await replyThatMayBeLive()
    expect(screen.getByRole('button', { name: 'Clear reply target' })).toBeDisabled()
  })

  it('a remounted question brings the "Replying to" banner back (restore) and posts as a reply', async () => {
    const { user, view } = await replyThatMayBeLive()
    view.unmount()

    // The dock reopened: the route holds no target any more.
    render(<Providers><ReplyHarness /></Providers>)

    expect(await screen.findByTestId('publish-unconfirmed')).toBeInTheDocument()
    expect(screen.getByTestId('reply-banner')).toHaveTextContent('Replying to @pio_jones')
    expect(screen.queryByTestId('draft-reply-notice')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Post again anyway…' }))
    await user.click(screen.getByRole('button', { name: 'I checked the feed — post again' }))
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe(TARGET_A.postId)
  })

  it('with no way to restore it explains what the draft was and keeps "post again" disabled', async () => {
    const { view } = await replyThatMayBeLive()
    view.unmount()

    render(<Providers><ReplyHarness withRestore={false} /></Providers>)

    const notice = await screen.findByTestId('draft-reply-notice')
    expect(notice).toHaveAttribute('role', 'alert')
    expect(notice).toHaveTextContent('This draft was a reply to @pio_jones')
    expect(notice).toHaveTextContent('Post is paused')
    // Gate-2 A S-NEW-3: the cause is not guessed (a panel close, a persona switch and a cleared
    // reply all end here), so the copy does not blame the panel.
    expect(notice).toHaveTextContent('The reply is no longer set.')
    expect(notice).not.toHaveTextContent(/dropped when the panel closed/)
    expect(within(notice).getByRole('button', { name: 'Reply to @pio_jones again' })).toBeDisabled()
    // A pending "did it go out?" question is not "kept as it is now" - only the discard is open.
    expect(within(notice).queryByRole('button', { name: /instead/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Post again anyway…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('a restored plain draft under a DIFFERENT reply offers both ways out', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    const user = userEvent.setup()
    const first = render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), 'We are looking into it.')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByTestId('publishing')
    first.unmount()
    await act(async () => { fail(httpError(429)) })

    // Reopened by "Reply as..." on ANOTHER post: B is set, the draft was written for A.
    render(<Providers><ReplyHarness initial={TARGET_B} /></Providers>)
    const notice = await screen.findByTestId('draft-reply-notice')
    expect(notice).toHaveTextContent('This draft was a reply to @pio_jones')
    expect(notice).toHaveTextContent('@mvega_fh')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()

    // "Reply to @pio_jones again" puts A back and unblocks.
    await user.click(within(notice).getByRole('button', { name: 'Reply to @pio_jones again' }))
    await waitFor(() => expect(screen.queryByTestId('draft-reply-notice')).toBeNull())
    expect(screen.getByTestId('reply-banner')).toHaveTextContent('@pio_jones')
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
  })

  it('"Reply to @mvega_fh instead" accepts what is on screen', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    const user = userEvent.setup()
    const first = render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), 'We are looking into it.')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByTestId('publishing')
    first.unmount()
    await act(async () => { fail(httpError(429)) })

    render(<Providers><ReplyHarness initial={TARGET_B} /></Providers>)
    const notice = await screen.findByTestId('draft-reply-notice')
    await user.click(within(notice).getByRole('button', { name: 'Reply to @mvega_fh instead' }))

    expect(screen.queryByTestId('draft-reply-notice')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Post' }))
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe(TARGET_B.postId)
  })
})

describe('L-3 - the post being replied to was taken down', () => {
  it('says so in words, blocks Post, and Clear reply returns to a normal post', async () => {
    const user = userEvent.setup()
    render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), 'Too late to answer.')
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()

    // Taken down after the target was set (this console, or another controller's push).
    act(() => removedPosts.add(TARGET_A.postId))

    const banner = await screen.findByTestId('reply-banner-removed')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent("The post you're replying to was taken down.")
    // Words, not a server 400 and not colour alone.
    expect(banner).not.toHaveTextContent(/parentPostId|HTTP 400/)
    expect(screen.queryByTestId('reply-banner')).toBeNull()
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
    expect(screen.getByTestId('persona-composer')).toHaveTextContent(
      'The post you are replying to was taken down. Clear the reply to post.',
    )
    fireEvent.keyDown(screen.getByLabelText(POST_FIELD), { key: 'Enter', ctrlKey: true })
    expect(publishPost).not.toHaveBeenCalled()

    await user.click(within(banner).getByRole('button', { name: 'Clear reply' }))

    expect(screen.queryByTestId('reply-banner-removed')).toBeNull()
    expect(screen.getByLabelText(/^Post as Fairhaven Water$/)).toHaveFocus()
    expect(screen.getByRole('button', { name: 'Post' })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: 'Post' }))
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBeUndefined()
  })

  it('a reply to a post that is NOT taken down is unaffected', async () => {
    render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    act(() => removedPosts.add('some-other-post'))
    expect(screen.getByTestId('reply-banner')).toBeInTheDocument()
    expect(screen.queryByTestId('reply-banner-removed')).toBeNull()
  })
})

describe('S-1 - "Reply as..." while the dock is open focuses the text field', () => {
  it('moves focus into the text field when the target changes to another post', async () => {
    const user = userEvent.setup()
    render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    const trigger = screen.getByRole('button', { name: 'reply as B (elsewhere)' })
    trigger.focus()
    expect(trigger).toHaveFocus()

    await user.click(trigger)

    expect(screen.getByTestId('reply-banner')).toHaveTextContent('@mvega_fh')
    expect(screen.getByLabelText(POST_FIELD)).toHaveFocus()
  })

  it('does not take focus on first mount (the dock host places it) or when the target is dropped', async () => {
    const user = userEvent.setup()
    render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    expect(screen.getByLabelText(POST_FIELD)).not.toHaveFocus()

    const drop = screen.getByRole('button', { name: 'route drops the target' })
    await user.click(drop)
    expect(screen.queryByTestId('reply-banner')).toBeNull()
    expect(drop).toHaveFocus()
  })
})

describe('S-NEW-1 - no alert is inserted before the restore has run', () => {
  it('a remount whose restore succeeds never puts the notice in the DOM', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const user = userEvent.setup()
    const first = render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), '@pio_jones yes, it is safe')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByTestId('publish-unconfirmed')
    first.unmount()

    let inserted = 0
    const observer = new MutationObserver(records => {
      for (const record of records) {
        for (const node of Array.from(record.addedNodes)) {
          if (!(node instanceof Element)) continue
          if (node.matches('[data-testid="draft-reply-notice"]')
            || node.querySelector('[data-testid="draft-reply-notice"]') !== null) inserted += 1
        }
      }
    })
    observer.observe(document.body, { childList: true, subtree: true })
    render(<Providers><ReplyHarness /></Providers>)
    await screen.findByTestId('reply-banner')
    await new Promise(resolve => setTimeout(resolve, 50))
    observer.disconnect()

    expect(inserted).toBe(0)
    expect(screen.queryByTestId('draft-reply-notice')).toBeNull()
  })
})

describe('S-NEW-2 - "Post as a new post instead" when the original reply was taken down', () => {
  async function questionAboutAReplyThenTakedown() {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const user = userEvent.setup()
    const first = render(<Providers><ReplyHarness initial={TARGET_A} /></Providers>)
    await user.type(screen.getByLabelText(POST_FIELD), '@pio_jones yes, it is safe')
    await user.click(screen.getByRole('button', { name: 'Post' }))
    await screen.findByTestId('publish-unconfirmed')
    first.unmount()
    act(() => removedPosts.add(TARGET_A.postId))
    // Reopened: the route restores A, which is gone - the composer says so and blocks.
    render(<Providers><ReplyHarness /></Providers>)
    const removedBanner = await screen.findByTestId('reply-banner-removed')
    await user.click(within(removedBanner).getByRole('button', { name: 'Clear reply' }))
    return { user }
  }

  it('offers it (and not "Reply to @x again", which can never work)', async () => {
    await questionAboutAReplyThenTakedown()

    const notice = await screen.findByTestId('draft-reply-notice')
    expect(notice).toHaveTextContent('This draft was a reply to @pio_jones')
    expect(notice).toHaveTextContent('The post it replied to was taken down')
    expect(within(notice).queryByRole('button', { name: /Reply to @pio_jones again/ })).toBeNull()
    expect(within(notice).getByRole('button', { name: 'Post as a new post instead' }))
      .toBeEnabled()
  })

  it('choosing it unblocks the (still two-step) "post again", which then goes out top-level', async () => {
    const { user } = await questionAboutAReplyThenTakedown()
    vi.mocked(publishPost).mockResolvedValueOnce(CREATED)
    const notice = await screen.findByTestId('draft-reply-notice')
    expect(screen.getByRole('button', { name: 'Post again anyway…' })).toBeDisabled()

    await user.click(within(notice).getByRole('button', { name: 'Post as a new post instead' }))

    expect(screen.queryByTestId('draft-reply-notice')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Post again anyway…' }))
    await user.click(screen.getByRole('button', { name: 'I checked the feed — post again' }))
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBeUndefined()
  })
})
