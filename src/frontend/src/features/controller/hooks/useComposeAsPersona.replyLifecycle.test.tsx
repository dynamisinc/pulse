/**
 * features/controller/hooks/useComposeAsPersona.replyLifecycle.test.tsx
 * ---------------------------------------------------------------------------
 * The reply target's lifecycle ACROSS the composer's mounts (Wave 3 Gate-2 A, M-1 and M-2;
 * the reviewer's probes, turned into tests). The REAL `useReplyTarget` (the route's state) is
 * driven together with the REAL `useComposeAsPersona`, in LIVE mode, the way
 * `ControllerConsoleRoute` composes them: the route holds the target and hands the composer
 * `replyTo` / `onClearReply` / `onRestoreReply`; the dock closing unmounts the composer and
 * clears the route's target (`onDockClose`).
 *
 * M-1  A late success from an UNMOUNTED composer must not clear the route's NEW target. The
 *      route already dropped the target that post answered when the dock closed; whatever it
 *      holds now was set later - wiping it would turn that reply into a top-level post.
 * M-2  What persists across a remount - the "Post status unknown" question, and the draft an
 *      off-screen failure restored - persists WITH the reply it was sent for. A fresh composer
 *      gets the target put back (the "Replying to" banner shows again); if it cannot (no
 *      restore callback, a different or cleared target) Post is BLOCKED and says why. It
 *      never sends that text as a top-level post. Covers the unconfirmed question, the
 *      "Draft restored" path, and a persona switch X -> Y -> X.
 * L-3  A reply whose target was taken down is blocked, with the reason in `blockers`.
 */
import { useLayoutEffect, useMemo } from 'react'
import { act, render } from '@testing-library/react'
import { AxiosError } from 'axios'
import { toast } from 'react-toastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, ReplyTarget } from '@/features/social'
import {
  composeAsPersonaDraftStore,
  useComposeAsPersona,
  type ReplyMismatch,
  type UseComposeAsPersonaResult,
} from './useComposeAsPersona'
import { useReplyTarget } from './useReplyTarget'
import { endSession } from '@/core/auth/endSession'

vi.mock('@/core/services/api', () => ({ api: { post: vi.fn().mockResolvedValue(undefined) } }))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('@/features/social/services/livePostActions', () => ({ publishPost: vi.fn() }))
vi.mock('react-toastify', () => ({ toast: { error: vi.fn(), warning: vi.fn() } }))
vi.mock('@/core/auth/logout', () => ({ logout: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

import { publishPost } from '@/features/social/services/livePostActions'

const persona = (id: string): StaffPersona => ({
  id,
  exerciseId: 'ex-1',
  templateId: 't',
  displayName: id,
  handle: id,
  kind: 'org',
  personaType: 'agency',
  verified: false,
  avatarColor: '#000',
  initials: 'X',
  audienceBand: 'mid',
  followerCount: 1,
  joinedAt: '2030-01-01T00:00:00Z',
})
const X = persona('persona-x')
const Y = persona('persona-y')

const A: ReplyTarget = { postId: 'post-A', authorHandle: 'a', authorDisplayName: 'A', excerpt: 'a' }
const B: ReplyTarget = { postId: 'post-B', authorHandle: 'b', authorDisplayName: 'B', excerpt: 'b' }
const VIEW: CreatedPostView = {
  id: 'new-1',
  authorPersonaId: 'persona-x',
  text: 'x',
  counts: { reply: 0, repost: 0, like: 0 },
  scenarioTime: '2033-09-04T14:00:00Z',
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

/** What the harness exposes to the test (re-assigned on every render). */
const h: {
  reply?: ReplyTarget | null
  request?: (target: ReplyTarget) => void
  clear?: () => void
  compose?: UseComposeAsPersonaResult
  onClearReply?: ReturnType<typeof vi.fn>
  onPublished?: ReturnType<typeof vi.fn>
  /** The `replyMismatch` ANNOUNCED by every commit of the composer, in order (S-NEW-1). */
  mismatchLog: (ReplyMismatch | undefined)[]
} = { mismatchLog: [] }

interface ComposerProps {
  readonly activePersona: StaffPersona
  readonly replyTo: ReplyTarget | undefined
  readonly onClearReply: () => void
  readonly onRestoreReply: ((target: ReplyTarget) => void) | undefined
  readonly removedIds: ReadonlySet<string>
}

const onPublished = vi.fn()

function Composer(props: ComposerProps) {
  const compose = useComposeAsPersona({
    activePersona: props.activePersona,
    actingHumanId: 'human-1',
    onPublished,
    ...(props.replyTo !== undefined ? { replyTo: props.replyTo } : {}),
    onClearReply: props.onClearReply,
    ...(props.onRestoreReply !== undefined ? { onRestoreReply: props.onRestoreReply } : {}),
    replyTargetRemoved: props.replyTo !== undefined && props.removedIds.has(props.replyTo.postId),
    removedPostIds: props.removedIds,
  })
  // Published for the test to read after each `act` (a layout effect: never during render).
  useLayoutEffect(() => {
    h.compose = compose
    h.onPublished = onPublished
    h.mismatchLog.push(compose.replyMismatch)
  })
  return null
}

interface RouteProps {
  readonly dockOpen: boolean
  readonly active?: StaffPersona
  readonly withRestore?: boolean
  /** Shorthand: the reply target `A` has been taken down. */
  readonly removed?: boolean
  readonly removedIds?: ReadonlySet<string>
}

/** The route: holds the reply target; the composer is mounted only while the dock is open. */
const NONE_REMOVED: ReadonlySet<string> = new Set()
const A_REMOVED: ReadonlySet<string> = new Set([A.postId])

function Route({
  dockOpen,
  active = X,
  withRestore = true,
  removed = false,
  removedIds = removed ? A_REMOVED : NONE_REMOVED,
}: RouteProps) {
  const { replyTo, requestReply, clearReply } = useReplyTarget({
    exerciseId: 'ex-1',
    activePersonaId: active.id,
    paletteOpen: false,
  })
  // A spy around `clearReply` so a test can see whether the composer asked to clear.
  const onClearReply = useMemo(() => vi.fn(clearReply), [clearReply])
  useLayoutEffect(() => {
    h.reply = replyTo
    h.request = requestReply
    h.clear = clearReply
    h.onClearReply = onClearReply
  })
  return dockOpen ? (
    <Composer
      activePersona={active}
      replyTo={replyTo ?? undefined}
      onClearReply={onClearReply}
      onRestoreReply={withRestore ? requestReply : undefined}
      removedIds={removedIds}
    />
  ) : null
}

/** Closes the dock the way `ControllerConsole` does: unmount the composer, then `onDockClose`. */
function closeDock(view: ReturnType<typeof render>, props: Omit<RouteProps, 'dockOpen'> = {}) {
  view.rerender(<Route dockOpen={false} {...props} />)
  act(() => h.clear?.())
}

beforeEach(() => {
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-1',
    exerciseName: 'E',
    timeZone: 'UTC',
    status: 'active',
  } as never)
  composeAsPersonaDraftStore.resetForTests()
  vi.mocked(publishPost).mockReset()
  vi.mocked(toast.error).mockClear()
  vi.mocked(toast.warning).mockClear()
  onPublished.mockClear()
  h.mismatchLog = []
})

describe('M-1 - a stale success from an unmounted composer', () => {
  it('does NOT clear the route\'s NEW reply target (the probe)', async () => {
    let resolve: (view: CreatedPostView) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(res => { resolve = res }))

    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    expect(h.reply?.postId).toBe('post-A')
    act(() => h.compose?.setText('reply to A'))
    act(() => h.compose?.publish())
    expect(h.compose?.isPublishing).toBe(true)

    // Esc on the dock: the composer unmounts and the route drops A.
    closeDock(view)
    expect(h.reply).toBeNull()

    // "Reply as..." on post B (same persona): the dock reopens with a NEW composer.
    act(() => h.request?.(B))
    view.rerender(<Route dockOpen />)
    expect(h.reply?.postId).toBe('post-B')
    h.onClearReply?.mockClear()

    // A's request finally succeeds.
    await act(async () => { resolve(VIEW) })

    expect(h.reply?.postId).toBe('post-B')
    expect(h.onClearReply).not.toHaveBeenCalled()
  })

  it('CONTROL: a success from the composer that is still on screen clears its own target', async () => {
    vi.mocked(publishPost).mockResolvedValueOnce(VIEW)
    render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('reply to A'))
    await act(async () => { h.compose?.publish() })
    expect(h.reply).toBeNull()
  })

  it('a late success after a persona switch (still mounted, another persona on screen) leaves the new target', async () => {
    let resolve: (view: CreatedPostView) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(res => { resolve = res }))

    const view = render(<Route dockOpen active={X} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('reply to A'))
    act(() => h.compose?.publish())

    view.rerender(<Route dockOpen active={Y} />)
    expect(h.reply).toBeNull() // dropped: it was set as persona X
    act(() => h.request?.(B))
    expect(h.reply?.postId).toBe('post-B')

    await act(async () => { resolve(VIEW) })
    expect(h.reply?.postId).toBe('post-B')
  })
})

describe('M-2 - an unconfirmed reply comes back with its reply (the probe)', () => {
  async function replyThatMayBeLive(options: Omit<RouteProps, 'dockOpen'> = {}) {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce(VIEW)
    const view = render(<Route dockOpen {...options} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes, it is safe'))
    await act(async () => { h.compose?.publish() })
    expect(h.compose?.awaitingDecision).toBe(true)
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBe('post-A')
    return view
  }

  it('the reopened composer RESTORES the target, and "post again" is still a reply to it', async () => {
    const view = await replyThatMayBeLive()

    closeDock(view)
    expect(h.reply).toBeNull()
    view.rerender(<Route dockOpen />)

    // The question and the text come back - and so does the reply target (the banner).
    expect(h.compose?.awaitingDecision).toBe(true)
    expect(h.compose?.text).toBe('@a yes, it is safe')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.replyMismatch).toBeUndefined()

    await act(async () => { h.compose?.repostAnyway() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe('post-A')
  })

  it('with NO way to restore, Post-again is BLOCKED and says what the draft was', async () => {
    const view = await replyThatMayBeLive({ withRestore: false })

    closeDock(view, { withRestore: false })
    view.rerender(<Route dockOpen withRestore={false} />)

    expect(h.reply).toBeNull()
    expect(h.compose?.awaitingDecision).toBe(true)
    expect(h.compose?.replyMismatch?.original?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(false)
    expect(h.compose?.blockers.join(' ')).toMatch(/This draft was a reply to @a/)

    await act(async () => { h.compose?.repostAnyway() })
    // Nothing went out: never as a top-level post.
    expect(publishPost).toHaveBeenCalledTimes(1)
  })

  it('a DIFFERENT "Reply as" while the question is open blocks the re-send; matching puts A back', async () => {
    const view = await replyThatMayBeLive()
    closeDock(view)
    act(() => h.request?.(B))
    view.rerender(<Route dockOpen />)

    expect(h.reply?.postId).toBe('post-B')
    expect(h.compose?.replyMismatch).toMatchObject({
      original: { postId: 'post-A' },
      current: { postId: 'post-B' },
    })
    await act(async () => { h.compose?.repostAnyway() })
    expect(publishPost).toHaveBeenCalledTimes(1)

    // "Keep what is on screen" is NOT offered for a pending "did it go out?" question.
    act(() => h.compose?.keepCurrentReply())
    expect(h.compose?.replyMismatch).toBeDefined()

    act(() => h.compose?.matchDraftReply())
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.replyMismatch).toBeUndefined()
    await act(async () => { h.compose?.repostAnyway() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe('post-A')
  })

  it('an unconfirmed TOP-LEVEL post is not turned into a reply by a later "Reply as"', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce(VIEW)
    const view = render(<Route dockOpen />)
    act(() => h.compose?.setText('Boil-water advisory lifted.'))
    await act(async () => { h.compose?.publish() })
    expect(h.compose?.awaitingDecision).toBe(true)

    closeDock(view)
    act(() => h.request?.(B))
    view.rerender(<Route dockOpen />)

    expect(h.compose?.replyMismatch).toMatchObject({ original: undefined, current: { postId: 'post-B' } })
    await act(async () => { h.compose?.repostAnyway() })
    expect(publishPost).toHaveBeenCalledTimes(1)

    // The way back: clear the reply target, then the re-send is a top-level post again.
    act(() => h.compose?.matchDraftReply())
    expect(h.reply).toBeNull()
    await act(async () => { h.compose?.repostAnyway() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBeUndefined()
  })

  it('"Discard draft (it went out)" after a remount drops the restored target', async () => {
    const view = await replyThatMayBeLive()
    closeDock(view)
    view.rerender(<Route dockOpen />)
    expect(h.reply?.postId).toBe('post-A')

    act(() => h.compose?.discardUnconfirmed())

    expect(h.reply).toBeNull()
    expect(h.compose?.awaitingDecision).toBe(false)
    expect(h.compose?.text).toBe('')
    expect(h.compose?.replyMismatch).toBeUndefined()
  })

  it('an explicit discard of the draft (Esc / X on the dock) forgets the reply too', async () => {
    const view = await replyThatMayBeLive()
    // `ControllerConsole.closeDock` discards the persisted draft, then closes.
    composeAsPersonaDraftStore.discardDraft('ex-1', X.id)
    closeDock(view)
    view.rerender(<Route dockOpen />)

    expect(h.reply).toBeNull()
    expect(h.compose?.text).toBe('')
    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.compose?.awaitingDecision).toBe(false)
  })
})

describe('M-2 - the "Draft restored" path (a failure that landed off-screen)', () => {
  it('a reply whose request failed after the dock closed reopens as a reply to the same post', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost)
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
      .mockResolvedValueOnce(VIEW)

    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('We are looking into it.'))
    act(() => h.compose?.publish())
    closeDock(view)

    await act(async () => { fail(httpError(429)) })

    view.rerender(<Route dockOpen />)
    expect(h.compose?.text).toBe('We are looking into it.')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(true)

    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe('post-A')
  })

  it('without a restore callback the restored draft cannot be posted top-level; "as a new post" is explicit', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost)
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
      .mockResolvedValueOnce(VIEW)

    const view = render(<Route dockOpen withRestore={false} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('We are looking into it.'))
    act(() => h.compose?.publish())
    closeDock(view, { withRestore: false })
    await act(async () => { fail(httpError(429)) })

    view.rerender(<Route dockOpen withRestore={false} />)
    expect(h.compose?.replyMismatch?.original?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(false)
    act(() => h.compose?.publish())
    expect(publishPost).toHaveBeenCalledTimes(1)

    // The controller chooses "Post as a new post instead".
    act(() => h.compose?.keepCurrentReply())
    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBeUndefined()
  })

  it('X -> Y -> X: a reply to A as X that fails while Y is on screen comes back as a reply', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost)
      .mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
      .mockResolvedValueOnce(VIEW)

    const view = render(<Route dockOpen active={X} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('Reply from X.'))
    act(() => h.compose?.publish())

    // The controller picks Y: the route drops the target (it was set as X).
    view.rerender(<Route dockOpen active={Y} />)
    expect(h.reply).toBeNull()
    expect(h.compose?.text).toBe('')

    // X's request fails while Y is on screen -> draft restored for X, reply remembered.
    await act(async () => { fail(httpError(429)) })

    // Back to X.
    view.rerender(<Route dockOpen active={X} />)
    expect(h.compose?.text).toBe('Reply from X.')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(true)

    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBe('post-A')
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].authorPersonaId).toBe('persona-x')
  })

  it('Y never inherits X\'s remembered reply', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    const view = render(<Route dockOpen active={X} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('Reply from X.'))
    act(() => h.compose?.publish())
    view.rerender(<Route dockOpen active={Y} />)
    await act(async () => { fail(httpError(429)) })

    expect(h.reply).toBeNull()
    expect(h.compose?.text).toBe('')
    expect(h.compose?.replyMismatch).toBeUndefined()
  })
})

describe('L-3 - a reply to a post that was taken down', () => {
  it('blocks Post and says why; clearing the target unblocks it', async () => {
    vi.mocked(publishPost).mockResolvedValueOnce(VIEW)
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('Too late.'))
    expect(h.compose?.canPublish).toBe(true)

    view.rerender(<Route dockOpen removed />)
    expect(h.compose?.canPublish).toBe(false)
    expect(h.compose?.blockers.join(' ')).toContain('was taken down')
    act(() => h.compose?.publish())
    expect(publishPost).not.toHaveBeenCalled()

    act(() => h.clear?.())
    view.rerender(<Route dockOpen />)
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBeUndefined()
  })
})

describe('L-5 - sign-out forgets drafts, questions and reply contexts', () => {
  it('a "Post status unknown" question and its draft do not survive endSession()', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes, it is safe'))
    await act(async () => { h.compose?.publish() })
    expect(h.compose?.awaitingDecision).toBe(true)
    closeDock(view)

    await endSession()

    // The NEXT staff user opens the dock for the same exercise and persona.
    view.rerender(<Route dockOpen />)
    expect(h.compose?.awaitingDecision).toBe(false)
    expect(h.compose?.text).toBe('')
    expect(h.reply).toBeNull()
    expect(h.compose?.replyMismatch).toBeUndefined()
  })

  it('an unsent persisted draft does not survive endSession() either', async () => {
    const view = render(<Route dockOpen />)
    act(() => h.compose?.setText('half-typed for the previous user'))
    closeDock(view)

    await endSession()

    view.rerender(<Route dockOpen />)
    expect(h.compose?.text).toBe('')
  })
})

describe('L-NEW-1 - a typed, never-sent reply comes back as a reply (the "GAP" probe)', () => {
  /** Types a reply to A, then the ENGINE flyout takes the dock over: the draft is KEPT. */
  function typedReplyThenEngineTakeover(options: Omit<RouteProps, 'dockOpen'> = {}) {
    const view = render(<Route dockOpen {...options} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a we are on it'))
    closeDock(view, options) // unmount + onDockClose; NO discardDraft (that is the explicit Esc/X)
    return view
  }

  it('reopened, the reply target is restored and Post goes out as THAT reply', async () => {
    vi.mocked(publishPost).mockResolvedValue(VIEW)
    const view = typedReplyThenEngineTakeover()
    expect(h.reply).toBeNull()

    view.rerender(<Route dockOpen />)

    expect(h.compose?.text).toBe('@a we are on it')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBe('post-A')
  })

  it('with no way to restore it, the draft is BLOCKED (never a silent top-level post)', async () => {
    vi.mocked(publishPost).mockResolvedValue(VIEW)
    const view = typedReplyThenEngineTakeover({ withRestore: false })

    view.rerender(<Route dockOpen withRestore={false} />)

    expect(h.reply).toBeNull()
    expect(h.compose?.replyMismatch).toMatchObject({ original: { postId: 'post-A' } })
    expect(h.compose?.canPublish).toBe(false)
    await act(async () => { h.compose?.publish() })
    expect(publishPost).not.toHaveBeenCalled()
    // The controller's choices: put it back, or accept a new post.
    act(() => h.compose?.keepCurrentReply())
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBeUndefined()
  })

  it('typing on a reopened, unresolved draft does not quietly accept the mismatch', () => {
    const view = typedReplyThenEngineTakeover({ withRestore: false })
    view.rerender(<Route dockOpen withRestore={false} />)
    expect(h.compose?.replyMismatch).toBeDefined()

    act(() => h.compose?.setText('@a we are on it, more'))

    expect(h.compose?.replyMismatch?.original?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(false)
  })

  it('"Reply as" on ANOTHER post while this composer stays open is a deliberate retarget (no block)', async () => {
    vi.mocked(publishPost).mockResolvedValue(VIEW)
    render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('wrong post, sorry'))

    act(() => h.request?.(B))

    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBe('post-B')
  })

  it('clearing the reply while the composer stays open makes it a plain draft again', async () => {
    vi.mocked(publishPost).mockResolvedValue(VIEW)
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('actually a plain announcement'))
    act(() => h.clear?.()) // the banner's (x)

    // After a non-explicit close the draft does NOT come back as a reply it no longer is.
    closeDock(view)
    view.rerender(<Route dockOpen />)
    expect(h.reply).toBeNull()
    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.compose?.canPublish).toBe(true)
    await act(async () => { h.compose?.publish() })
    expect(vi.mocked(publishPost).mock.calls[0]?.[0].parentPostId).toBeUndefined()
  })

  it('emptying the text forgets the reply (nothing left to restore)', () => {
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('a'))
    act(() => h.compose?.setText(''))
    closeDock(view)

    view.rerender(<Route dockOpen />)

    expect(h.reply).toBeNull()
    expect(h.compose?.replyMismatch).toBeUndefined()
  })

  it('an explicit discard (Esc / X on the dock) forgets the typed reply too', () => {
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a we are on it'))
    composeAsPersonaDraftStore.discardDraft('ex-1', X.id)
    closeDock(view)

    view.rerender(<Route dockOpen />)

    expect(h.reply).toBeNull()
    expect(h.compose?.text).toBe('')
  })

  it('X -> Y -> X: the typed reply for X comes back for X only', () => {
    const view = render(<Route dockOpen active={X} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('reply from X'))

    view.rerender(<Route dockOpen active={Y} />)
    expect(h.reply).toBeNull()
    expect(h.compose?.text).toBe('')
    expect(h.compose?.replyMismatch).toBeUndefined()

    view.rerender(<Route dockOpen active={X} />)
    expect(h.compose?.text).toBe('reply from X')
    expect(h.reply?.postId).toBe('post-A')
  })
})

describe('L-NEW-2 - a response that lands after sign-out changes nothing (the "RACE" probe)', () => {
  it('a FAILURE does not re-create the previous user\'s draft, question, reply or toast', async () => {
    let fail: (error: unknown) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('previous user text'))
    act(() => h.compose?.publish())
    view.unmount() // navigation to /login
    await endSession() // sign-out: composer state is reset, the epoch moves on

    await act(async () => { fail(httpError(504)) })

    // The next user signs in on the same tab, same exercise and persona.
    render(<Route dockOpen />)
    expect(h.compose?.text).toBe('')
    expect(h.compose?.awaitingDecision).toBe(false)
    expect(h.compose?.replyMismatch).toBeUndefined()
    expect(h.reply).toBeNull()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a SUCCESS neither clears a reply target nor reports a publish for the previous session', async () => {
    let resolve: (view: CreatedPostView) => void = () => undefined
    vi.mocked(publishPost).mockReturnValueOnce(new Promise(res => { resolve = res }))
    render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('previous user text'))
    act(() => h.compose?.publish())
    await endSession()
    // The next user is (on this tab) replying to the same post, with the composer still mounted.
    act(() => h.request?.(A))
    h.onClearReply?.mockClear()
    h.onPublished?.mockClear()

    await act(async () => { resolve(VIEW) })

    expect(h.onClearReply).not.toHaveBeenCalled()
    expect(h.onPublished).not.toHaveBeenCalled()
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.lastPublished).toBeNull()
  })

  it('a request sent AFTER the sign-out is a normal one (the epoch is captured per send)', async () => {
    vi.mocked(publishPost).mockResolvedValueOnce(VIEW)
    render(<Route dockOpen />)
    await endSession()
    act(() => h.compose?.setText('second user'))

    await act(async () => { h.compose?.publish() })

    expect(h.onPublished).toHaveBeenCalledTimes(1)
    expect(h.compose?.status).toBe('success')
  })
})

describe('S-NEW-1 - the mismatch alert is not inserted before the restore has run', () => {
  it('a remount whose restore succeeds never announces a mismatch', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes'))
    await act(async () => { h.compose?.publish() })
    closeDock(view)
    h.mismatchLog = []

    view.rerender(<Route dockOpen />)

    expect(h.reply?.postId).toBe('post-A')
    expect(h.mismatchLog.length).toBeGreaterThan(0)
    expect(h.mismatchLog.every(announced => announced === undefined)).toBe(true)
    // ... yet nothing could be sent in the window (the guard is not the announcement).
    expect(h.compose?.canPublish).toBe(false) // still the pending question
  })

  it('a mismatch that CANNOT be restored is announced at once', () => {
    const view = render(<Route dockOpen withRestore={false} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a we are on it'))
    closeDock(view, { withRestore: false })
    h.mismatchLog = []

    view.rerender(<Route dockOpen withRestore={false} />)

    expect(h.mismatchLog[0]?.original?.postId).toBe('post-A')
  })

  it('a different reply set before reopening is announced at once (nothing to restore)', () => {
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a we are on it'))
    closeDock(view)
    act(() => h.request?.(B))
    h.mismatchLog = []

    view.rerender(<Route dockOpen />)

    expect(h.mismatchLog[0]).toMatchObject({
      original: { postId: 'post-A' },
      current: { postId: 'post-B' },
    })
  })
})

describe('S-NEW-2 - a pending question about a reply whose post was taken down', () => {
  async function questionThenTakedown() {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504)).mockResolvedValueOnce(VIEW)
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes'))
    await act(async () => { h.compose?.publish() })
    view.rerender(<Route dockOpen removed />) // A is taken down
    act(() => h.clear?.()) // the removed banner's "Clear reply"
    return view
  }

  it('offers "post as a new post instead": that request can never be re-sent', async () => {
    await questionThenTakedown()

    expect(h.compose?.replyMismatch).toMatchObject({
      original: { postId: 'post-A' },
      originalRemoved: true,
      canKeepCurrent: true,
    })
    expect(h.compose?.awaitingDecision).toBe(true)

    act(() => h.compose?.keepCurrentReply())
    expect(h.compose?.replyMismatch).toBeUndefined()
    // The question itself is still open: the two-step "post again anyway" follows, top-level.
    expect(h.compose?.awaitingDecision).toBe(true)
    expect(publishPost).toHaveBeenCalledTimes(1)
    await act(async () => { h.compose?.repostAnyway() })
    expect(vi.mocked(publishPost).mock.calls[1]?.[0].parentPostId).toBeUndefined()
  })

  it('a question about a reply whose post is still up stays pinned (not offered)', async () => {
    vi.mocked(publishPost).mockRejectedValueOnce(httpError(504))
    const view = render(<Route dockOpen />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes'))
    await act(async () => { h.compose?.publish() })
    closeDock(view)
    act(() => h.request?.(B))
    view.rerender(<Route dockOpen />)

    expect(h.compose?.replyMismatch).toMatchObject({
      originalRemoved: false,
      canKeepCurrent: false,
    })
    act(() => h.compose?.keepCurrentReply())
    expect(h.compose?.replyMismatch).toBeDefined()
  })
})
