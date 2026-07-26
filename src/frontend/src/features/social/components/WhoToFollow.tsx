/**
 * features/social/components/WhoToFollow.tsx
 * ---------------------------------------------------------------------------
 * The "Who to follow" suggestion module (feature: profiles-social-graph,
 * story 04 — "Who to follow"; SOC-053, D1-R1, D1-011). Participant world
 * (Pulse Social skin): plain semantic elements + a scoped CSS Module +
 * FontAwesome only — NO COBRA, NO themed MUI, NO `@mui/icons-material`.
 *
 * ── THE HARD RULE (D1-R1) ────────────────────────────────────────────────────
 * The module is titled EXACTLY "Who to follow" and carries NO authority or
 * "official" chrome anywhere — no "official", "trusted", "recommended by",
 * ranking badge, or any other text/icon that implies the platform is vouching
 * for an account. Each row renders IDENTITY ONLY: avatar, name, the verified
 * mark where applicable (`<VerifiedMark>`, its own presence/absence is the
 * ONLY credibility signal — SOC-002/052), handle, optional bio, and the follow
 * action. Nothing else. Any change that adds a caption, subtitle, or badge
 * beyond that is a regression against this story's whole point.
 *
 * ── THE IMPERSONATOR CAN LEGITIMATELY APPEAR (D1-R1/D1-008) ─────────────────
 * This component renders EVERY row `useWhoToFollow()` hands it, in the EXACT
 * order supplied — an unverified lookalike (e.g. the seeded SOC-052
 * `@FairhavenWaterUpd`) is rendered identically to every other row: same
 * layout, same follow action, no muted styling, no "unverified" counter-badge,
 * no re-sort to the bottom. This is a deliberate controller attention-steering
 * lever (world-steering/01, CTL-021) — the platform never flags it, and this
 * component must never invent a way to flag it either. The absence of
 * `<VerifiedMark>` is the ONLY thing that differs, exactly as it would for any
 * other unverified account.
 *
 * ── SCOPE BOUNDARY (read before extending this file) ────────────────────────
 * Suggestions are PLANNER-SEEDED and exercise-scoped (COR-001, via
 * `useWhoToFollow`/`whoToFollowService`). The E7 controller lever that adjusts
 * suggestions LIVE (CTL-021, `docs/features/world-steering/01-attention-levers.md`,
 * issue #24) is **Not Started** and explicitly OUT OF SCOPE here — this
 * component and its data seam are what that lever will eventually write
 * through, not the lever's control surface itself. Do not read AC2 of story
 * 04 ("adjustable live by controllers") as delivered by this file: only the
 * planner-seeded read half is built.
 *
 * ── OBSERVER MODE (D1-011) ───────────────────────────────────────────────────
 * No follow-action gating lives in this file. Each row's `<FollowButton>`
 * already renders NOTHING in an observer/read-only session or a session with
 * no bound persona (`useFollow`'s `canFollow` gate, story 02) — this component
 * reuses that control unmodified rather than re-implementing the guard, so an
 * observer sees the same identity rows with the action control genuinely
 * ABSENT, never present-and-disabled.
 *
 * STANDALONE + SELF-FETCHING (mirrors `<FollowButton>`'s relationship to
 * `useFollow`): this component owns its own data fetch via `useWhoToFollow()`
 * rather than taking suggestions as a prop, so a host mounts `<WhoToFollow />`
 * with no data wiring of its own — swapping the mock suggestion seam for a
 * live `/api/personas/suggestions` endpoint needs no consumer change. Built
 * and tested here in isolation; mounting it into `<SocialChannel>` is a later
 * orchestrator pass (see `docs/features/profiles-social-graph/implementation.md`).
 *
 * A11Y (NFR-001): the module is a labelled `<section>` containing a visible
 * `<h2>Who to follow</h2>` heading (referenced via `aria-labelledby`, so both
 * a sighted reader and AT get the same title) and a real `<ul>`/`<li>` list —
 * one row per suggestion, no synthetic rows. Loading/error/empty states are
 * announced via `role="status"`, mirroring `<Feed>`'s convention.
 */

import { useMemo } from 'react'
import { Avatar } from './Avatar'
import { VerifiedMark } from './VerifiedMark'
import { FollowButton } from './FollowButton'
import { useWhoToFollow } from '../hooks/useWhoToFollow'
import styles from './WhoToFollow.module.css'

/** The avatar scale for a suggestion row (matches `FollowerList`'s row scale). */
const SUGGESTION_AVATAR_SIZE = 40
/** The verified-mark scale on a suggestion row (matches the post-card seal). */
const SUGGESTION_MARK_SIZE = 15

const HEADING_ID = 'who-to-follow-heading'

export interface WhoToFollowProps {
  /**
   * Caps the number of rendered rows to the first N of the resolved,
   * already-ordered suggestion set. Omit to render every resolved suggestion.
   * This is a display cap only — it never changes WHICH accounts are eligible
   * or their relative order (no ranking is computed here or anywhere in this
   * module's data seam).
   */
  readonly limit?: number
}

/**
 * Renders the "Who to follow" module. See the module header for the full
 * contract — most importantly, the no-authority-chrome rule and the
 * impersonator's legitimate, unflagged presence.
 */
export function WhoToFollow({ limit }: WhoToFollowProps) {
  const { suggestions, loading, error } = useWhoToFollow()

  const rows = useMemo(
    () => (limit !== undefined ? suggestions.slice(0, limit) : suggestions),
    [suggestions, limit],
  )

  return (
    <section
      className={styles.whoToFollow}
      aria-labelledby={HEADING_ID}
      data-testid="who-to-follow"
    >
      <h2 id={HEADING_ID} className={styles.heading}>Who to follow</h2>

      {rows.length > 0 && (
        <ul className={styles.list} data-testid="who-to-follow-rows">
          {rows.map(persona => (
            <li key={persona.id} className={styles.row} data-testid="who-to-follow-row">
              <Avatar persona={persona} size={SUGGESTION_AVATAR_SIZE} />
              <span className={styles.identity}>
                <span className={styles.nameRow}>
                  {/* PERSONA-AUTHORED (D1-R1): display name, handle and bio are the
                      ACCOUNT's own words, rendered verbatim. The platform never edits
                      or filters them — an agency legitimately describes itself as
                      "Official ...", and SOC-052 requires an impersonator be able to
                      claim exactly the same thing. `data-persona-authored` marks these
                      so the D1-R1 test can assert that no *platform* chrome vouches
                      for anyone, without banning the words from an account's own bio. */}
                  <span className={styles.displayName} data-persona-authored="true">
                    {persona.displayName}
                  </span>
                  {persona.verified && (
                    <span className={styles.verifiedMark}>
                      <VerifiedMark size={SUGGESTION_MARK_SIZE} />
                    </span>
                  )}
                </span>
                <span className={styles.handle} data-persona-authored="true">
                  {`@${persona.handle}`}
                </span>
                {persona.bio && (
                  <span className={styles.bio} data-persona-authored="true">{persona.bio}</span>
                )}
              </span>
              <span className={styles.action}>
                <FollowButton
                  personaId={persona.id}
                  displayName={persona.displayName}
                  initialFollowerCount={persona.followerCount}
                />
              </span>
            </li>
          ))}
        </ul>
      )}

      {loading && rows.length === 0 && (
        <p className={styles.state} role="status" data-testid="who-to-follow-loading">
          Loading suggestions…
        </p>
      )}
      {!loading && error !== undefined && rows.length === 0 && (
        <p className={styles.state} role="status" data-testid="who-to-follow-error">
          Suggestions aren’t available right now.
        </p>
      )}
      {!loading && error === undefined && rows.length === 0 && (
        <p className={styles.state} data-testid="who-to-follow-empty">
          No suggestions right now.
        </p>
      )}
    </section>
  )
}
