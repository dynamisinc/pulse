/**
 * features/controller/hooks/useComposeAsPersona.inFlight.test.tsx
 * ---------------------------------------------------------------------------
 * ONE REQUEST IN FLIGHT PER TARGET, FOR THE WHOLE SESSION (Copilot review of PR #463, finding 1;
 * CTL-001, XC-004, #455 "post create is not idempotent"). LIVE mode, the REAL hook; the route's
 * reply target is the REAL `useReplyTarget`, as `ControllerConsoleRoute` composes them.
 *
 * THE BUG. The in-flight guard used to be a per-hook-instance `Set`. The ENGINE / USAGE takeover
 * unmounts the composer but keeps its draft, so reopening the persona before the first
 * `POST /api/posts` settled built a fresh, empty guard around the SAME draft - and Post sent it
 * again. The guard now lives in a module registry keyed by target, and a composer that mounts onto
 * a key with a request out ADOPTS that request. These tests pin:
 *
 *  - a remounted composer starts locked (`publishing`, `isPublishing`) and `publish()` /
 *    `repostAnyway()` (what Post, Ctrl+Enter and "post again" call) send nothing - the rendered
 *    Post / Ctrl+Enter path is in `../components/PersonaComposer.inFlight.test.tsx`;
 *  - when the request settles the adopter takes the outcome over: success (draft gone, "Posted",
 *    reply target cleared ONLY if still the one answered), unconfirmed (the question, with the
 *    draft and its reply) and failure (the draft back, the classified banner) - with no toast
 *    while an adopter is on screen, and the toast kept when nothing is;
 *  - the sender's own callbacks are not duplicated by the adopter (`onPublished` fires once);
 *  - a response clears only ITS OWN entry: two personas in flight do not unlock each other, and a
 *    previous session's response neither changes anything nor deletes the next session's entry;
 *  - switching target (same instance) onto an in-flight key locks and adopts too.
 */
import { useLayoutEffect, useMemo } from 'react'
import { act, render, renderHook } from '@testing-library/react'
import { AxiosError } from 'axios'
import { toast } from 'react-toastify'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession } from '@/core/auth/endSession'
import { useExerciseContext } from '@/core/exerciseContext'
import type { StaffPersona } from '@/features/personas'
import type { CreatedPostView, Post, ReplyTarget } from '@/features/social'
import {
  composeAsPersonaDraftStore,
  useComposeAsPersona,
  type UseComposeAsPersonaOptions,
  type UseComposeAsPersonaResult,
} from './useComposeAsPersona'
import { useReplyTarget } from './useReplyTarget'

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

/** A `publishPost` call (the NEXT one) that the test settles by hand. */
function pendingRequest() {
  let resolve: (view: CreatedPostView) => void = () => undefined
  let reject: (error: unknown) => void = () => undefined
  const promise = new Promise<CreatedPostView>((res, rej) => {
    resolve = res
    reject = rej
  })
  vi.mocked(publishPost).mockReturnValueOnce(promise)
  return {
    succeed: () => act(async () => { resolve(VIEW) }),
    fail: (status: number) => act(async () => { reject(httpError(status)) }),
  }
}

const sent = () => vi.mocked(publishPost).mock.calls

function options(
  activePersona: StaffPersona,
  overrides: Partial<UseComposeAsPersonaOptions> = {},
): UseComposeAsPersonaOptions {
  return { activePersona, actingHumanId: 'human-1', ...overrides }
}

/** A composer mounted for `activePersona`, with the draft typed and Post pressed (request out). */
function senderOf(
  activePersona: StaffPersona,
  text: string,
  overrides: Partial<UseComposeAsPersonaOptions> = {},
) {
  const view = renderHook(() => useComposeAsPersona(options(activePersona, overrides)))
  act(() => view.result.current.setText(text))
  act(() => view.result.current.publish())
  return view
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
})

describe('a composer that mounts onto a request already in flight', () => {
  it('starts LOCKED on the same draft: publishing, not postable', () => {
    pendingRequest()
    senderOf(X, 'Boil-water order lifted.').unmount() // the ENGINE flyout takes the dock over

    const { result } = renderHook(() => useComposeAsPersona(options(X)))

    expect(result.current.status).toBe('publishing')
    expect(result.current.isPublishing).toBe(true)
    expect(result.current.text).toBe('Boil-water order lifted.')
    expect(result.current.canPublish).toBe(false)
    expect(result.current.awaitingDecision).toBe(false)
    expect(result.current.failure).toBeUndefined()
  })

  it('publish() - what Post and Ctrl+Enter call - sends NOTHING more (the duplicate-post probe)', () => {
    pendingRequest()
    senderOf(X, 'Boil-water order lifted.').unmount()
    expect(sent()).toHaveLength(1)

    const { result } = renderHook(() => useComposeAsPersona(options(X)))
    act(() => result.current.publish())
    act(() => result.current.publish())

    expect(sent()).toHaveLength(1)
  })

  it('"post again anyway" is a no-op too: a repost in flight locks a reopened composer, not asks again', async () => {
    const firstAttempt = pendingRequest()
    const first = senderOf(X, 'Maybe out.')
    await firstAttempt.fail(504)
    expect(first.result.current.awaitingDecision).toBe(true)
    pendingRequest() // the repost
    act(() => first.result.current.repostAnyway())
    expect(sent()).toHaveLength(2)
    first.unmount()

    const { result } = renderHook(() => useComposeAsPersona(options(X)))

    // NOT the question again (that would offer a THIRD send): the repost is the thing in flight.
    expect(result.current.status).toBe('publishing')
    expect(result.current.awaitingDecision).toBe(false)
    act(() => result.current.repostAnyway())
    act(() => result.current.publish())
    expect(sent()).toHaveLength(2)
  })
})

describe('a remounted composer takes the outcome over', () => {
  it('SUCCESS: the draft is gone, "Posted" shows, nothing is toasted, onPublished is the sender\'s only', async () => {
    const request = pendingRequest()
    const senderPublished = vi.fn<(post: Post) => void>()
    const adopterPublished = vi.fn<(post: Post) => void>()
    senderOf(X, 'Zones 2-4 are clear.', { onPublished: senderPublished }).unmount()
    const adopter = renderHook(() =>
      useComposeAsPersona(options(X, { onPublished: adopterPublished })),
    )

    await request.succeed()

    expect(adopter.result.current.status).toBe('success')
    expect(adopter.result.current.isPublishing).toBe(false)
    expect(adopter.result.current.lastPublished?.id).toBe('new-1')
    expect(adopter.result.current.text).toBe('')
    expect(adopter.result.current.failure).toBeUndefined()
    expect(senderPublished).toHaveBeenCalledTimes(1)
    expect(adopterPublished).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    // ... and the persisted draft is discarded, so the NEXT mount starts empty and unlocked.
    adopter.unmount()
    const next = renderHook(() => useComposeAsPersona(options(X)))
    expect(next.result.current.text).toBe('')
    expect(next.result.current.status).toBe('idle')
    expect(next.result.current.canPublish).toBe(false) // nothing to post, but not locked
  })

  it('UNCONFIRMED: the "did it go out?" question comes back with the draft, and no toast', async () => {
    const request = pendingRequest()
    senderOf(X, 'Maybe out.').unmount()
    const adopter = renderHook(() => useComposeAsPersona(options(X)))

    await request.fail(504)

    expect(adopter.result.current.status).toBe('error')
    expect(adopter.result.current.awaitingDecision).toBe(true)
    expect(adopter.result.current.failure?.kind).toBe('unconfirmed')
    expect(adopter.result.current.text).toBe('Maybe out.')
    expect(adopter.result.current.canPublish).toBe(false)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    // Still gated: Post sends nothing; only the explicit "post again" does.
    act(() => adopter.result.current.publish())
    expect(sent()).toHaveLength(1)
    act(() => adopter.result.current.repostAnyway())
    expect(sent()).toHaveLength(2)
  })

  it('FAILURE: the draft is back with the classified failure (a plain Retry), and no toast', async () => {
    const request = pendingRequest()
    senderOf(X, 'Rate limited.').unmount()
    const adopter = renderHook(() => useComposeAsPersona(options(X)))

    await request.fail(429)

    expect(adopter.result.current.status).toBe('error')
    expect(adopter.result.current.failure?.kind).not.toBe('unconfirmed')
    expect(adopter.result.current.failure?.status).toBe(429)
    expect(adopter.result.current.awaitingDecision).toBe(false)
    expect(adopter.result.current.text).toBe('Rate limited.')
    expect(adopter.result.current.canPublish).toBe(true)
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    act(() => adopter.result.current.publish())
    expect(sent()).toHaveLength(2)
  })

  it('CONTROL: with NO composer mounted when it lands, the off-screen toast is still raised', async () => {
    const request = pendingRequest()
    senderOf(X, 'Rate limited.').unmount()

    await request.fail(429)

    expect(toast.error).toHaveBeenCalledTimes(1)
    const reopened = renderHook(() => useComposeAsPersona(options(X)))
    expect(reopened.result.current.text).toBe('Rate limited.')
    expect(reopened.result.current.status).toBe('idle')
  })

  it('an adopter that unmounted before the response leaves the toast in place (nobody is looking)', async () => {
    const request = pendingRequest()
    senderOf(X, 'Maybe out.').unmount()
    renderHook(() => useComposeAsPersona(options(X))).unmount()

    await request.fail(504)

    expect(toast.warning).toHaveBeenCalledTimes(1)
  })

  it('two composers on screen at once: the sender handles itself, the adopter follows, one callback', async () => {
    const request = pendingRequest()
    const senderPublished = vi.fn<(post: Post) => void>()
    const sender = senderOf(X, 'Zones 2-4 are clear.', { onPublished: senderPublished })
    const adopter = renderHook(() => useComposeAsPersona(options(X)))
    expect(adopter.result.current.status).toBe('publishing')

    await request.succeed()

    expect(sender.result.current.status).toBe('success')
    expect(adopter.result.current.status).toBe('success')
    expect(senderPublished).toHaveBeenCalledTimes(1)
  })
})

describe('switching target onto a key with a request in flight', () => {
  it('a mounted composer that switches to that persona locks and adopts the outcome', async () => {
    const request = pendingRequest()
    senderOf(X, 'Boil-water order lifted.').unmount()
    const { result, rerender } = renderHook(
      ({ active }: { active: StaffPersona }) => useComposeAsPersona(options(active)),
      { initialProps: { active: Y } },
    )
    expect(result.current.status).toBe('idle')

    rerender({ active: X })
    expect(result.current.status).toBe('publishing')
    expect(result.current.text).toBe('Boil-water order lifted.')
    act(() => result.current.publish())
    expect(sent()).toHaveLength(1)

    await request.succeed()
    expect(result.current.status).toBe('success')
    expect(result.current.text).toBe('')
  })

  it('the SENDER switching away and back is locked on return and settles in place (no double handling)', async () => {
    const request = pendingRequest()
    const onPublished = vi.fn<(post: Post) => void>()
    const { result, rerender } = renderHook(
      ({ active }: { active: StaffPersona }) =>
        useComposeAsPersona(options(active, { onPublished })),
      { initialProps: { active: X } },
    )
    act(() => result.current.setText('Boil-water order lifted.'))
    act(() => result.current.publish())

    rerender({ active: Y })
    expect(result.current.status).toBe('idle')
    rerender({ active: X })
    expect(result.current.status).toBe('publishing')
    act(() => result.current.publish())
    expect(sent()).toHaveLength(1)

    await request.succeed()

    expect(result.current.status).toBe('success')
    expect(onPublished).toHaveBeenCalledTimes(1)
  })
})

describe('the reply target, across the remount', () => {
  /** What the harness exposes to the test (re-assigned on every commit). */
  const h: {
    reply?: ReplyTarget | null
    request?: (target: ReplyTarget) => void
    clear?: () => void
    compose?: UseComposeAsPersonaResult
    onClearReply?: ReturnType<typeof vi.fn>
  } = {}

  function Composer(props: {
    active: StaffPersona
    replyTo: ReplyTarget | undefined
    onClearReply: () => void
    onRestoreReply: ((target: ReplyTarget) => void) | undefined
  }) {
    const compose = useComposeAsPersona({
      activePersona: props.active,
      actingHumanId: 'human-1',
      ...(props.replyTo !== undefined ? { replyTo: props.replyTo } : {}),
      onClearReply: props.onClearReply,
      ...(props.onRestoreReply !== undefined ? { onRestoreReply: props.onRestoreReply } : {}),
    })
    useLayoutEffect(() => {
      h.compose = compose
    })
    return null
  }

  /** The route: holds the reply target; the composer is mounted only while the dock is open. */
  function Route({ dockOpen, withRestore = true }: { dockOpen: boolean; withRestore?: boolean }) {
    const { replyTo, requestReply, clearReply } = useReplyTarget({
      exerciseId: 'ex-1',
      activePersonaId: X.id,
      paletteOpen: false,
    })
    const onClearReply = useMemo(() => vi.fn(clearReply), [clearReply])
    useLayoutEffect(() => {
      h.reply = replyTo
      h.request = requestReply
      h.clear = clearReply
      h.onClearReply = onClearReply
    })
    return dockOpen
      ? (
        <Composer
          active={X}
          replyTo={replyTo ?? undefined}
          onClearReply={onClearReply}
          onRestoreReply={withRestore ? requestReply : undefined}
        />
      )
      : null
  }

  /** Closes the dock the way `ControllerConsole` does: unmount the composer, then `onDockClose`. */
  function closeDock(view: ReturnType<typeof render>, withRestore = true) {
    view.rerender(<Route dockOpen={false} withRestore={withRestore} />)
    act(() => h.clear?.())
  }

  /** A reply to A, typed and sent as X; then the ENGINE flyout takes the dock over. */
  function replyToAInFlightThenTakeover(withRestore = true) {
    const view = render(<Route dockOpen withRestore={withRestore} />)
    act(() => h.request?.(A))
    act(() => h.compose?.setText('@a yes, it is safe'))
    act(() => h.compose?.publish())
    expect(h.compose?.isPublishing).toBe(true)
    closeDock(view, withRestore)
    expect(h.reply).toBeNull()
    return view
  }

  it('SUCCESS clears the reply target when it is still the one the post answered', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover()
    view.rerender(<Route dockOpen />)
    // The reply came back with the draft (restored), and the composer is locked.
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.isPublishing).toBe(true)
    h.onClearReply?.mockClear()

    await request.succeed()

    expect(h.onClearReply).toHaveBeenCalledTimes(1)
    expect(h.reply).toBeNull()
    expect(h.compose?.status).toBe('success')
    expect(h.compose?.text).toBe('')
  })

  it('SUCCESS leaves a DIFFERENT reply target alone (a late 201 never wipes a newer target)', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover()
    act(() => h.request?.(B)) // "Reply as" on post B before the dock reopens
    view.rerender(<Route dockOpen />)
    expect(h.reply?.postId).toBe('post-B')
    h.onClearReply?.mockClear()

    await request.succeed()

    expect(h.onClearReply).not.toHaveBeenCalled()
    expect(h.reply?.postId).toBe('post-B')
    expect(h.compose?.status).toBe('success')
  })

  it('SUCCESS after the controller cleared the target does not "clear" it again', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover()
    view.rerender(<Route dockOpen />)
    act(() => h.clear?.())
    h.onClearReply?.mockClear()

    await request.succeed()

    expect(h.onClearReply).not.toHaveBeenCalled()
  })

  it('UNCONFIRMED brings the question back WITH its reply: "post again" is still a reply to A', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover()
    view.rerender(<Route dockOpen />)

    await request.fail(504)

    expect(h.compose?.awaitingDecision).toBe(true)
    expect(h.compose?.text).toBe('@a yes, it is safe')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.replyMismatch).toBeUndefined()
    act(() => h.compose?.repostAnyway())
    expect(sent()).toHaveLength(2)
    expect(sent()[1]?.[0].parentPostId).toBe('post-A')
  })

  it('FAILURE brings the draft back as a reply to A (Retry is a reply, never top-level)', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover()
    view.rerender(<Route dockOpen />)

    await request.fail(429)

    expect(h.compose?.status).toBe('error')
    expect(h.compose?.text).toBe('@a yes, it is safe')
    expect(h.reply?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(true)
    act(() => h.compose?.publish())
    expect(sent()[1]?.[0].parentPostId).toBe('post-A')
  })

  it('with NO way to restore the reply, the adopted failure stays blocked (never a top-level post)', async () => {
    const request = pendingRequest()
    const view = replyToAInFlightThenTakeover(false)
    view.rerender(<Route dockOpen withRestore={false} />)

    await request.fail(429)

    expect(h.reply).toBeNull()
    expect(h.compose?.replyMismatch?.original?.postId).toBe('post-A')
    expect(h.compose?.canPublish).toBe(false)
    act(() => h.compose?.publish())
    expect(sent()).toHaveLength(1)
  })
})

describe('sign-out while a request is in flight', () => {
  it('the old response changes nothing, and the next session is NOT locked by it', async () => {
    const old = pendingRequest()
    senderOf(X, 'previous user text').unmount()
    await endSession()

    // The next staff user opens the same persona in the same exercise.
    const next = renderHook(() => useComposeAsPersona(options(X)))
    expect(next.result.current.status).toBe('idle')
    expect(next.result.current.text).toBe('')

    await old.succeed()

    expect(next.result.current.status).toBe('idle')
    expect(next.result.current.lastPublished).toBeNull()
    expect(toast.error).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    // ... and it can post: the old session's entry was forgotten by the sign-out.
    act(() => next.result.current.setText('second user'))
    expect(next.result.current.canPublish).toBe(true)
    act(() => next.result.current.publish())
    expect(sent()).toHaveLength(2)
  })

  it('the old response does NOT delete the NEW session\'s entry for the same key', async () => {
    const old = pendingRequest()
    senderOf(X, 'previous user text').unmount()
    await endSession()
    const second = pendingRequest()
    const next = renderHook(() => useComposeAsPersona(options(X)))
    act(() => next.result.current.setText('second user'))
    act(() => next.result.current.publish())
    expect(next.result.current.isPublishing).toBe(true)
    expect(sent()).toHaveLength(2)

    await old.succeed() // the previous user's 201 lands while the new user's request is out

    expect(next.result.current.isPublishing).toBe(true)
    act(() => next.result.current.publish())
    expect(sent()).toHaveLength(2)
    // A composer reopened now is still locked on the NEW request.
    const reopened = renderHook(() => useComposeAsPersona(options(X)))
    expect(reopened.result.current.isPublishing).toBe(true)

    await second.succeed()
    expect(next.result.current.status).toBe('success')
    expect(reopened.result.current.status).toBe('success')
  })

  it('an old FAILURE neither toasts nor restores the previous user\'s draft', async () => {
    const old = pendingRequest()
    senderOf(X, 'previous user text').unmount()
    await endSession()

    await old.fail(504)

    const next = renderHook(() => useComposeAsPersona(options(X)))
    expect(next.result.current.text).toBe('')
    expect(next.result.current.awaitingDecision).toBe(false)
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('a composer that adopted the old request is not changed by its response either', async () => {
    const old = pendingRequest()
    senderOf(X, 'previous user text').unmount()
    const onClearReply = vi.fn()
    const adopter = renderHook(() =>
      useComposeAsPersona(options(X, { replyTo: A, onClearReply })),
    )
    await endSession()

    await old.succeed()

    expect(adopter.result.current.lastPublished).toBeNull()
    expect(adopter.result.current.status).not.toBe('success')
    expect(onClearReply).not.toHaveBeenCalled()
  })
})

describe('two personas in flight at once', () => {
  it('one persona\'s response does not unlock the other', async () => {
    const forX = pendingRequest()
    senderOf(X, 'From X.').unmount()
    const forY = pendingRequest()
    senderOf(Y, 'From Y.').unmount()
    expect(sent()).toHaveLength(2)
    const adoptX = renderHook(() => useComposeAsPersona(options(X)))
    const adoptY = renderHook(() => useComposeAsPersona(options(Y)))
    expect(adoptX.result.current.isPublishing).toBe(true)
    expect(adoptY.result.current.isPublishing).toBe(true)

    await forX.succeed()

    expect(adoptX.result.current.status).toBe('success')
    // Y is untouched: still locked, still its own draft, and Post is still a no-op.
    expect(adoptY.result.current.status).toBe('publishing')
    expect(adoptY.result.current.text).toBe('From Y.')
    act(() => adoptY.result.current.publish())
    const reopenedY = renderHook(() => useComposeAsPersona(options(Y)))
    expect(reopenedY.result.current.isPublishing).toBe(true)
    act(() => reopenedY.result.current.publish())
    expect(sent()).toHaveLength(2)

    await forY.fail(429)
    expect(adoptY.result.current.status).toBe('error')
    expect(adoptX.result.current.status).toBe('success')
  })

  it('X\'s failure leaves Y\'s lock in place', async () => {
    const forX = pendingRequest()
    senderOf(X, 'From X.').unmount()
    pendingRequest()
    senderOf(Y, 'From Y.').unmount()
    const adoptY = renderHook(() => useComposeAsPersona(options(Y)))

    await forX.fail(504)

    expect(adoptY.result.current.isPublishing).toBe(true)
    expect(toast.warning).toHaveBeenCalledTimes(1) // X had nobody on screen
    act(() => adoptY.result.current.publish())
    expect(sent()).toHaveLength(2)
  })
})
