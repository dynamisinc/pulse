/**
 * features/social/components/FollowButton.tsx
 * ---------------------------------------------------------------------------
 * The follow/unfollow control (feature: profiles-social-graph, story 02 —
 * "Follow/unfollow"; SOC-051, COR-015/D1-011, NFR-001). Participant world
 * (Pulse Social skin): plain semantic elements + a scoped CSS Module +
 * FontAwesome only — NO COBRA, NO themed MUI, NO `@mui/icons-material`.
 *
 * PRESENTATIONAL + STANDALONE. All state/network logic lives in `useFollow()`
 * (this component's only intended consumer relationship) — this file renders
 * that hook's output and nothing else. It is built and tested in isolation
 * here; wiring it into `<Profile>`'s header is a later orchestrator pass (see
 * `docs/features/profiles-social-graph/implementation.md`).
 *
 * OBSERVER/READ-ONLY (COR-015/D1-011): when `useFollow().canFollow` is false
 * (an observer/read-only session, OR a session with no bound persona to
 * follow AS), this component renders NOTHING — `null`, not a disabled
 * button. The `useFollow()` hook itself is still called unconditionally
 * (rules of hooks); only the JSX is gated. Counts are NOT this component's
 * job — the caller (the profile page) renders `followerCount`/
 * `followingCount` as inert text regardless of variant; this control is
 * ONLY the action affordance.
 *
 * A11Y (NFR-001): the follow state is conveyed by THREE independent signals,
 * never color alone —
 *   1. the visible button TEXT ("Follow" vs "Following"),
 *   2. a DIFFERENT FontAwesome icon per state (add-person vs check), and
 *   3. `aria-pressed`, so assistive tech reports the toggle state directly.
 * The accessible name (`aria-label`) spells out the ACTION the click performs
 * ("Follow {name}" / "Unfollow {name}") rather than just the current state —
 * matching `PostCard`'s like-button convention (state-inclusive label) and
 * the common toggle-button pattern (mute/unmute) where activating the control
 * announces its own updated name/pressed-state afterward, with no separate
 * live region needed (the change is a direct result of the user's own action
 * on this same control).
 *
 * PENDING (a real network write, unlike `useReaction`'s local-only toggle):
 * while `useFollow().pending` is true the button is `disabled` +
 * `aria-busy="true"` — a plain, standard in-flight guard against a second
 * overlapping toggle. This is UNRELATED to the D1-011 absent-vs-disabled
 * rule, which governs OBSERVER sessions only (an observer's control is
 * absent, never merely disabled); a normal writable session's button may be
 * momentarily disabled while its own request is in flight.
 *
 * INTEGRATION SEAM: `onFollowerCountChange` is an optional escape hatch so a
 * host that displays the follower count ELSEWHERE on the page (e.g. the
 * profile header, owned by story 01) can stay in sync with this control's
 * own optimistic count without lifting the whole `useFollow()` state up.
 * Omit it and this component works standalone exactly as tested here.
 *
 * SG-003: the effect above depends on `onFollowerCountChange`'s IDENTITY (it
 * is in the dependency array), so a host that passes an inline arrow function
 * re-fires it on every render of the host, not just when the count actually
 * changes. Hosts should wrap the callback in `useCallback` (a stable
 * dependency, e.g. `useCallback(count => setFollowerCount(count), [])`) —
 * this component cannot itself defend against an unstable prop identity
 * without silently dropping legitimate rapid-fire count changes.
 */

import { useEffect } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUserPlus, faUserCheck } from '@fortawesome/free-solid-svg-icons'
import { useFollow } from '../hooks/useFollow'
import styles from './FollowButton.module.css'

export interface FollowButtonProps {
  /** The account this control follows/unfollows. */
  readonly personaId: string
  /** The account's display name — folded into the accessible name ("Follow {name}"). */
  readonly displayName: string
  /** The target's current follower count — seeds `useFollow`'s optimistic total. */
  readonly initialFollowerCount: number
  /** Whether the viewer already follows this account. */
  readonly initiallyFollowing?: boolean
  /**
   * Called with the running follower count whenever it changes (including
   * once on mount with the seeded value) — an optional sync hook for a host
   * that renders the count elsewhere. See the module header.
   */
  readonly onFollowerCountChange?: (count: number) => void
}

/**
 * Renders the follow/unfollow toggle for one account. See the module header
 * for the full contract.
 */
export function FollowButton({
  personaId,
  displayName,
  initialFollowerCount,
  initiallyFollowing,
  onFollowerCountChange,
}: FollowButtonProps) {
  const { isFollowing, followerCount, canFollow, pending, toggleFollow } = useFollow({
    personaId,
    initialFollowerCount,
    initiallyFollowing,
  })

  useEffect(() => {
    onFollowerCountChange?.(followerCount)
  }, [followerCount, onFollowerCountChange])

  // Observer/read-only session, or a session with no persona to follow AS
  // (D1-011): the control is genuinely ABSENT, never present-and-disabled.
  if (!canFollow) return null

  const label = isFollowing ? `Unfollow ${displayName}` : `Follow ${displayName}`
  const buttonClass = isFollowing ? `${styles.button} ${styles.following}` : styles.button

  return (
    <button
      type="button"
      className={buttonClass}
      data-testid="follow-button"
      data-following={isFollowing}
      aria-pressed={isFollowing}
      aria-label={label}
      aria-busy={pending}
      disabled={pending}
      onClick={toggleFollow}
    >
      <FontAwesomeIcon
        icon={isFollowing ? faUserCheck : faUserPlus}
        aria-hidden="true"
        className={styles.icon}
      />
      <span className={styles.text}>{isFollowing ? 'Following' : 'Follow'}</span>
    </button>
  )
}
