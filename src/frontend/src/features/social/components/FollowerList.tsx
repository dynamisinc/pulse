/**
 * features/social/components/FollowerList.tsx
 * ---------------------------------------------------------------------------
 * The follower list (feature: profiles-social-graph, story 05; SOC-054,
 * D1-012). Participant world (Pulse Social skin): plain semantic elements + a
 * scoped CSS Module + FontAwesome only — NO COBRA, NO themed MUI, NO
 * `@mui/icons-material`.
 *
 * ── THE HARD RULE (SOC-054 / D1-012) ────────────────────────────────────────
 * This component renders EXACTLY the real follow edges it is handed, then a
 * single italic "…and ~48.2K others" line for the audience magnitude. It NEVER
 * fabricates a scrollable list of invented followers — not one synthetic row,
 * not a placeholder, not a "loading" skeleton standing in for people who do not
 * exist. Audience magnitude is a NUMBER, never rows.
 *
 * Why this matters beyond taste: fabricated follower rows would be enumerable
 * fiction a participant could tap, screenshot, or cite in the hotwash as if
 * those accounts existed. The honest affordance ("~N others") conveys scale
 * without ever claiming an identity that has no post history, no profile, and
 * no behaviour behind it. Any future change that maps over the magnitude to
 * produce rows is a defect, and `FollowerList.test.tsx` asserts against it
 * directly (row count === edges.length, at any magnitude).
 *
 * PRESENTATIONAL + PURE. It fetches nothing: the caller (the profile page's
 * Followers view) supplies the already exercise-scoped edge list (COR-001) and
 * the magnitude. It renders no timestamps, so it has no scenario-time surface
 * of its own (COR-053 is satisfied vacuously — do not add a wall-clock one).
 *
 * A11Y (NFR-001).
 *  - The whole thing is a labelled `<section>` ("Followers") containing a real
 *    `<ul>`/`<li>` list, so AT reports an accurate "list, N items" — N being the
 *    number of REAL people, which is the point.
 *  - The "…and ~48.2K others" line is a REAL, announced `<p>` in the reading
 *    order — not a `::after` decoration, not `aria-hidden`, not a background
 *    image. A screen-reader user learns the audience scale exactly as a sighted
 *    one does. It sits OUTSIDE the `<ul>` deliberately: inside, AT would count
 *    it as a follower row and the list length would lie.
 *  - That line also carries an `aria-label` spelling the figure out in words
 *    ("and approximately 48.2 thousand others"), because AT handles the visible
 *    "~" inconsistently — dropping it or reading "tilde" — which can lose the
 *    APPROXIMATION and leave a reader hearing an exact count. Two deliberate
 *    details: `role="note"` is set because the default `paragraph` role
 *    PROHIBITS an accessible name (the label would be invalid and could be
 *    dropped), and the visible text is never hidden, so an AT that ignores the
 *    label still announces the line — the change can only add, never silence.
 *  - The verified seal is `<VerifiedMark>` (its own `role="img"` + label); its
 *    ABSENCE is the untrusted signal (SOC-052/D1-008 — the platform never
 *    labels an account fake, and this list never adds a badge of its own).
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUserGroup } from '@fortawesome/free-solid-svg-icons'
import type { Persona } from '@/features/personas'
import { Avatar } from './Avatar'
import { VerifiedMark } from './VerifiedMark'
import { formatMagnitude, safeCount, spokenMagnitude } from '../services/audience'
import styles from './FollowerList.module.css'

/** The avatar scale for a follower row (between the 42px card and 80px profile). */
const FOLLOWER_AVATAR_SIZE = 40
/** The verified-mark scale on a follower row (matches the post-card seal). */
const FOLLOWER_MARK_SIZE = 15

/**
 * One REAL follow edge — the participant-safe subset of a `Persona` a row
 * needs. Structurally a `Persona` satisfies it, so callers can pass resolved
 * personas straight through without mapping.
 *
 * `exerciseId` is carried deliberately (COR-001/AC4): callers already have it
 * on the persona, and without it neither the integration pass nor a test can
 * even EXPRESS the assertion that every rendered edge belongs to the active
 * exercise. This component does not filter on it — isolation is enforced at the
 * query layer, server-side — but the field's presence keeps that guarantee
 * checkable at the render boundary instead of invisible.
 */
export type FollowerEdge = Pick<
  Persona,
  | 'id'
  | 'exerciseId'
  | 'displayName'
  | 'handle'
  | 'verified'
  | 'kind'
  | 'avatarColor'
  | 'initials'
  | 'bio'
>

export interface FollowerListProps {
  /**
   * The REAL follow edges to render, already exercise-scoped by the caller
   * (COR-001). One row is rendered per entry — no more, ever.
   */
  readonly edges: readonly FollowerEdge[]
  /**
   * The account's audience magnitude (SOC-054) — the simulated crowd behind the
   * "…and ~N others" line. Disjoint from `edges`; it is NOT `edges.length`
   * subtracted from a total. Zero or below hides the line entirely.
   */
  readonly magnitude: number
}

/**
 * Renders the real follow edges followed by the audience-magnitude affordance.
 * See the module header for the never-fabricate rule this component exists to
 * enforce.
 */
export function FollowerList({ edges, magnitude }: FollowerListProps) {
  // One definition of "a broken count is 0", shared with the model (S-7).
  const others = Math.floor(safeCount(magnitude))
  const hasEdges = edges.length > 0

  return (
    <section className={styles.followers} aria-label="Followers" data-testid="follower-list">
      {hasEdges && (
        <ul className={styles.list} data-testid="follower-edges">
          {edges.map(edge => (
            <li key={edge.id} className={styles.row} data-testid="follower-row">
              <Avatar persona={edge} size={FOLLOWER_AVATAR_SIZE} />
              <span className={styles.identity}>
                <span className={styles.nameRow}>
                  <span className={styles.displayName}>{edge.displayName}</span>
                  {edge.verified && (
                    <span className={styles.verifiedMark}>
                      <VerifiedMark size={FOLLOWER_MARK_SIZE} />
                    </span>
                  )}
                </span>
                <span className={styles.handle}>{`@${edge.handle}`}</span>
                {edge.bio && <span className={styles.bio}>{edge.bio}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}

      {others > 0 && (
        <p
          className={styles.others}
          data-testid="follower-others"
          // `note` = content parenthetic/ancillary to the list above it, which
          // is exactly what this line is — and, unlike the default `paragraph`
          // role, `note` PERMITS an accessible name, so the label below is
          // valid ARIA rather than name-prohibited and silently dropped.
          role="note"
          // The visible "~" is unreliable in AT (dropped, or read "tilde"), so
          // the approximation can be lost and the figure heard as exact. The
          // label spells it out. The visible text is deliberately NOT hidden:
          // if an AT ignores the label, the reader still hears the line rather
          // than nothing (fail-safe, never silent).
          aria-label={`and approximately ${spokenMagnitude(others)} others`}
        >
          <FontAwesomeIcon icon={faUserGroup} aria-hidden="true" className={styles.othersIcon} />
          {`…and ~${formatMagnitude(others)} others`}
        </p>
      )}

      {!hasEdges && others === 0 && (
        <p className={styles.empty} data-testid="follower-empty">No followers yet.</p>
      )}
    </section>
  )
}
