/**
 * features/social/hooks/useFollow.ts
 * ---------------------------------------------------------------------------
 * The follow/unfollow state machine behind `<FollowButton>` (feature:
 * profiles-social-graph, story 02 — "Follow/unfollow"; SOC-051, COR-001,
 * COR-015/D1-011). Participant world (Pulse Social skin) — pure hook, no UI,
 * no COBRA. Mirrors `useReaction.ts`'s shape (`canReact`/`isReadOnly`/
 * optimistic count), with one structural difference: unlike a like/repost,
 * follow now has a REAL backend (profiles-social-graph backend story 07,
 * #370), so the toggle is a genuine network write that can fail — this hook
 * owns the optimistic-update-with-rollback machinery that implies.
 *
 * WHAT THIS OWNS
 *  - `isFollowing` / `followerCount`: the viewer's own follow state for one
 *    target persona, and that target's running follower total — seeded once
 *    from the caller's props and then owned locally (a profile re-render
 *    never clobbers an in-flight toggle), exactly like `useReaction`'s
 *    `likedByViewer`/`likeCount`.
 *  - `toggleFollow()`: flips `isFollowing`, adjusts `followerCount` by ±1
 *    OPTIMISTICALLY, then calls `followService.followPersona`/
 *    `unfollowPersona` for the target. On a REJECTED request it rolls back
 *    both `isFollowing` and `followerCount` to their pre-toggle values — a
 *    failed write must never leave the button showing "Following" (or the
 *    count bumped) when the server never recorded the edge. On a RESOLVED
 *    request (SG-001), this hook does NOT simply trust its own optimistic
 *    guess — it settles `isFollowing`/`followerCount` on the server's
 *    AUTHORITATIVE `FollowWriteResult` (`FollowStateResponseDto`'s `following`
 *    AND `changed`, returned by both `followPersona`/`unfollowPersona`), so a
 *    client/server divergence (e.g. a stale double-tap racing another
 *    tab/session) never leaves the button showing a state the server disagrees
 *    with — it self-corrects instead of asserting the optimistic guess was
 *    right. The COUNT specifically moves only when the server reports
 *    `changed: true`: an idempotent repeat (a follow the server already had an
 *    edge for) settles the count back to where it started rather than
 *    inventing a follower nobody gained. While
 *    a toggle is in flight (`pending`), a second `toggleFollow()` call is a
 *    no-op — this avoids two overlapping optimistic mutations racing each
 *    other's rollback.
 *  - `canFollow` / `isReadOnly`: the render gate `<FollowButton>` consumes so
 *    the control is genuinely ABSENT (not disabled) in an observer/read-only
 *    session (COR-015/D1-011) or when the session has no bound persona to
 *    follow AS (mirrors `useReaction`'s `canReact`). Counts stay visible
 *    regardless — this hook's `followerCount` output is unconditional.
 *
 * NO CLIENT TELEMETRY (XC-004): the backend emits the follow/unfollow event
 * itself on a state change (story 07's contract) — this hook must not also
 * emit one, or every toggle would double-count. `useReaction`/`useAmplify`
 * both emit client-side because they have no backend yet; follow is the first
 * of this family with a live write path, and telemetry moves server-side with
 * it.
 *
 * TWO-WORLDS / ISOLATION (COR-001/COR-018): the target `personaId` is
 * supplied by the caller (the profile page); no client `exerciseId` rides the
 * request (the server derives scope from the session, mirroring
 * `livePostActions.publishPost`). The acting persona is never supplied by
 * this hook either — the server derives it from the session, exactly like
 * the live post-publish path.
 */

import { useCallback, useLayoutEffect, useRef, useState } from 'react'
import { useSession } from '@/core/auth'
import { followPersona, unfollowPersona } from '../services/followService'

/** Options for {@link useFollow}. */
export interface UseFollowOptions {
  /** The account this control follows/unfollows — never the viewer's own persona. */
  readonly personaId: string
  /** The target's current follower count — seeds `followerCount` (owned locally after). */
  readonly initialFollowerCount: number
  /** Whether the viewer already follows this account — seeds `isFollowing`. */
  readonly initiallyFollowing?: boolean
}

/** The follow surface `<FollowButton>` binds to. */
export interface UseFollowResult {
  /** Whether the viewer follows this account (their own state). */
  readonly isFollowing: boolean
  /** The target's running follower total, updated optimistically on each toggle. */
  readonly followerCount: number
  /**
   * Whether the viewer can follow at all — false in an observer/read-only
   * session or when the session has no persona to follow as. `<FollowButton>`
   * renders the control only when this is true (D1-011); the count is
   * rendered by the caller regardless.
   */
  readonly canFollow: boolean
  /** Observer/read-only session (COR-015) — the follow control must be ABSENT. */
  readonly isReadOnly: boolean
  /** True while a toggle's request is in flight — a second toggle is a no-op until it settles. */
  readonly pending: boolean
  /**
   * Toggles follow/unfollow: flips state + count optimistically, then rolls
   * BOTH back if the write fails. A no-op unless `canFollow`, and a no-op
   * while `pending`.
   */
  readonly toggleFollow: () => void
}

/**
 * The follow control's state + action machine for one target persona. See the
 * module header for the full contract; `<FollowButton>` is its only intended
 * consumer.
 */
export function useFollow(options: UseFollowOptions): UseFollowResult {
  const { personaId, initialFollowerCount, initiallyFollowing = false } = options
  const session = useSession()

  const [isFollowing, setIsFollowing] = useState(initiallyFollowing)
  const [followerCount, setFollowerCount] = useState(initialFollowerCount)
  const [pending, setPending] = useState(false)

  const isReadOnly = session.isReadOnly
  // A viewer can never follow THEMSELVES: the server rejects a self-follow with 400
  // (story 07 AC8 — a self-edge would inflate a persona's own displayed follower count
  // with itself). Without this clause the control renders on the viewer's own profile
  // and every tap is optimistic-on -> 400 -> rollback flicker.
  const canFollow = !isReadOnly
    && session.personaId !== undefined
    && session.personaId !== personaId

  // Guards a stray resolve/rejection from an ABANDONED request (one whose target
  // changed mid-flight) from mutating state that no longer corresponds to it. The
  // token is bumped by each toggle and by a genuine personaId CHANGE below — without
  // the latter it could never actually differ at settle time, since `pending` already
  // blocks a second toggle, and the guard would be decorative. It must NOT bump on
  // mount, and it must bump BEFORE the retargeted button can be clicked. The layout
  // effect below documents the rollback defect that violating either rule caused.
  const requestTokenRef = useRef(0)

  // Re-point the hook when the TARGET changes. `useState` seeds once, so a mounted
  // instance whose `personaId` prop changes would otherwise keep the PREVIOUS persona's
  // follow state and count, and an in-flight write would settle onto them. This is
  // reachable the moment the control is wired into <Profile>, where profile-to-profile
  // navigation reuses the mounted page rather than remounting it. Adjusting state during
  // render (rather than in an effect) is React's documented pattern for a prop-derived
  // reset — it re-renders before committing, so no stale frame is ever painted.
  const [trackedPersonaId, setTrackedPersonaId] = useState(personaId)
  if (trackedPersonaId !== personaId) {
    setTrackedPersonaId(personaId)
    setIsFollowing(initiallyFollowing)
    setFollowerCount(initialFollowerCount)
    setPending(false)
  }

  // Invalidate any in-flight write when the target CHANGES. This lives in an effect
  // rather than in the render-phase reset above because refs must not be touched during
  // render.
  //
  // TWO separate ordering hazards made the naive `useEffect` version actively harmful,
  // and both have the same shape: a PASSIVE effect flushes after commit, so the button is
  // painted and clickable while the bump is still pending — and React runs a click
  // dispatched in that window BEFORE flushing it. The toggle took token N, this effect
  // then moved the ref to N+1, and every settle handler saw
  // `requestTokenRef.current !== token` and returned. The rejected write never rolled
  // back and the button stayed on "Following" forever — precisely the AC this hook exists
  // to uphold, inverted.
  //
  //  1. ON MOUNT — a mount is not an abandonment, so it must not bump at all. Fixed by
  //     skipping the first run. Reproduced 60/60 once the click was dispatched ahead of
  //     the flush, and intermittently reddened `FollowButton.test.tsx`'s rollback spec in
  //     CI (a 5s gate expiring with the DOM still on "Following"), which had been written
  //     off as parallel-run contention (#391).
  //  2. AFTER A REAL TARGET CHANGE — skipping the mount does NOT save this one: the first
  //     click on the NEW target can still beat the pending bump and be suppressed
  //     identically. `useLayoutEffect` is what closes it: a layout effect is flushed
  //     synchronously during commit, before paint and before the browser can deliver any
  //     input, so the bump is always already applied by the time the retargeted button is
  //     clickable. (Caught in review by Copilot on #409 — the passive-effect version of
  //     this fix was incomplete.)
  //
  // Together these make the guard's verdict INDEPENDENT of whether a click or the flush
  // wins the race, which is the actual defect. A genuine `personaId` change still bumps,
  // so the abandon semantics the guard exists for are unchanged.
  const targetSettledRef = useRef(false)
  useLayoutEffect(() => {
    if (!targetSettledRef.current) {
      targetSettledRef.current = true
      return
    }
    requestTokenRef.current += 1
  }, [personaId])

  const toggleFollow = useCallback(() => {
    if (session.isReadOnly || session.personaId === undefined) return
    if (session.personaId === personaId) return // self-follow: server 400s (story 07 AC8)
    if (pending) return

    const wasFollowing = isFollowing
    const previousCount = followerCount
    const nextFollowing = !wasFollowing
    // Clamp at 0 defensively so a desynced initial count can never render negative.
    const nextCount = nextFollowing ? previousCount + 1 : Math.max(0, previousCount - 1)

    const token = requestTokenRef.current + 1
    requestTokenRef.current = token

    setIsFollowing(nextFollowing)
    setFollowerCount(nextCount)
    setPending(true)

    const write = nextFollowing ? followPersona(personaId) : unfollowPersona(personaId)

    write
      .then(({ following: serverFollowing, changed }) => {
        if (requestTokenRef.current !== token) return
        // SG-001: settle on the server's AUTHORITATIVE values rather than
        // trusting the optimistic guess was right. In the ordinary case
        // `serverFollowing === nextFollowing` and `changed` is true, so this
        // is a same-value re-set (no visible change); on a genuine divergence
        // it corrects both the toggle state and the count derived from it,
        // still computed off the PRE-toggle count since the server returns no
        // count of its own.
        setIsFollowing(serverFollowing)
        // `changed === false` is an IDEMPOTENT REPEAT — the server recorded
        // nothing, so the target's follower total did not move and the count
        // must return to exactly what it was. Without this branch the settle
        // step re-applies `previousCount ± 1` off the optimistic ASSUMPTION
        // that a change occurred, phantom-ing a follower onto (or off) a
        // profile that never gained (or lost) one. Keying the ±1 on the
        // server's own flag makes that structurally impossible rather than
        // merely unreachable-if-the-seed-is-right.
        setFollowerCount(
          !changed
            ? previousCount
            : serverFollowing
              ? previousCount + 1
              : Math.max(0, previousCount - 1),
        )
        setPending(false)
      })
      .catch(() => {
        if (requestTokenRef.current !== token) return
        // Roll back BOTH the toggle and the count — a failed write must never
        // leave the button showing "Following" (or the count bumped) when the
        // server never recorded the edge.
        setIsFollowing(wasFollowing)
        setFollowerCount(previousCount)
        setPending(false)
      })
  }, [session.isReadOnly, session.personaId, pending, isFollowing, followerCount, personaId])

  return {
    isFollowing,
    followerCount,
    canFollow,
    isReadOnly,
    pending,
    toggleFollow,
  }
}
