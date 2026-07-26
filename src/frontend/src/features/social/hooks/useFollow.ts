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
 *    count bumped) when the server never recorded the edge. While a toggle is
 *    in flight (`pending`), a second `toggleFollow()` call is a no-op — this
 *    avoids two overlapping optimistic mutations racing each other's
 *    rollback.
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

import { useCallback, useEffect, useRef, useState } from 'react'
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
  // token is bumped by the personaId reset below as well as by each toggle — without
  // that reset it could never actually differ at resolve time, since `pending` already
  // blocks a second toggle, and the guard would be decorative.
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

  // Invalidate any in-flight write when the target changes. This lives in an effect
  // rather than in the render-phase reset above because refs must not be touched during
  // render; it still runs on commit, i.e. before any pending promise can resolve, so a
  // write issued for the PREVIOUS persona can never settle onto the new one's state.
  useEffect(() => {
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
      .then(() => {
        if (requestTokenRef.current !== token) return
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
