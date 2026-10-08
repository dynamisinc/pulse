/**
 * features/social/explore/SearchResultRows.tsx
 * ---------------------------------------------------------------------------
 * The two result rows `SearchBox` renders (demo-polish F6, story 15-explore;
 * SOC-042, SOC-052, D1-008): `PersonResultRow` (People section) and
 * `PostResultRow` (Posts section). Participant world — plain elements, a scoped
 * CSS Module, FontAwesome-free (the avatar and the seal are the shared
 * primitives). NO COBRA, NO themed MUI.
 *
 * ── THE LOOKALIKE RULE (SOC-052 / D1-008) ───────────────────────────────────
 * A verified agency and its unverified lookalike (e.g. `@FairhavenWater` and
 * `@FairhavenWaterUpd`) must render IDENTICALLY except for the seal:
 *   - `PersonResultRow` has exactly one branch on a trust signal —
 *     `{persona.verified && <span><VerifiedMark/></span>}` — and nothing else
 *     reads `verified`, `kind` or any archetype. Same elements, same classes, same
 *     attributes, same order, same copy. No "official" / "unverified" label, no
 *     muted styling, no warning icon, no `data-verified` or any other
 *     machine-readable tell. The ABSENCE of the seal is the only signal a
 *     participant gets, exactly as on a post card (`PostHeader`).
 *   - The seal is a SIBLING of the link, never inside it, so it keeps its own
 *     `role="img"` name and is not swallowed into the link's accessible name (the
 *     same reason `PostHeader` keeps it outside its author overlay).
 *   - The persona's name, handle and bio are the ACCOUNT's own words, rendered
 *     verbatim (D1-R1): the platform neither edits nor flags them.
 *   `search.test.ts` / `SearchBox.test.tsx` pin this structurally.
 *
 * ROW ACTIVATION. Each row has ONE link, stretched over the whole row
 * (`.rowLink::after` — the same "stretched link" pattern the post card uses), so
 * the row is one large target and one tab stop. It is a real `<a href>`
 * (`exploreNavigation.ts`): with an `onOpen*` callback it is intercepted for
 * in-app navigation, without one the browser follows the link — never a focusable
 * no-op (WR-002). `data-result-link` is the hook `SearchBox` uses for
 * Up/Down-arrow navigation; it is on EVERY row alike.
 *
 * CONTENT SECURITY (NFR-004). Post text and persona text are rendered as React
 * text children only (never as HTML), after the upstream sanitization the feed and
 * persona reads already apply.
 *
 * SCENARIO TIME (COR-053). A post row's time arrives pre-formatted from the
 * parent's single `useScenarioTime` snapshot (relative text + an absolute `title`
 * + the scenario instant as `dateTime`); a row never reads a clock itself, and a
 * list of 50 rows runs one timer, not 50.
 */

import type { Persona } from '@/features/personas'
import { Avatar } from '../components/Avatar'
import { VerifiedMark } from '../components/VerifiedMark'
import type { PostView } from '../components/post/types'
import { activateLink, postHref, profileHref } from './exploreNavigation'
import styles from './SearchResultRows.module.css'

const AVATAR_SIZE = 40
const SEAL_SIZE = 15

export interface PersonResultRowProps {
  readonly persona: Persona
  /** Opens the account's profile by persona id; omit to follow the link. */
  readonly onOpenProfile?: (personaId: string) => void
}

/** One account in the People section. See the module header: seal is the ONLY difference. */
export function PersonResultRow({ persona, onOpenProfile }: PersonResultRowProps) {
  return (
    <li className={styles.row} data-testid="search-person">
      <Avatar persona={persona} size={AVATAR_SIZE} />
      <span className={styles.identity}>
        <span className={styles.nameRow}>
          <a
            className={styles.rowLink}
            href={profileHref(persona.handle)}
            data-result-link="true"
            aria-label={`View ${persona.displayName}'s profile`}
            onClick={event =>
              activateLink(
                event,
                onOpenProfile === undefined ? undefined : () => onOpenProfile(persona.id),
              )
            }
          >
            {persona.displayName}
          </a>
          {persona.verified && (
            <span className={styles.seal}>
              <VerifiedMark size={SEAL_SIZE} />
            </span>
          )}
        </span>
        <span className={styles.handle}>{`@${persona.handle}`}</span>
        {persona.bio !== undefined && persona.bio !== '' && (
          <span className={styles.bio}>{persona.bio}</span>
        )}
      </span>
    </li>
  )
}

export interface PostResultRowProps {
  readonly post: PostView
  /** Relative scenario-time text, e.g. "2h ago" (from the parent's snapshot). */
  readonly relativeTime: string
  /** Absolute scenario-time text for the tooltip. */
  readonly absoluteTime: string
  /** Opens the post's thread; omit to follow the link. */
  readonly onOpenPost?: (postId: string) => void
}

/** One post in the Posts section: author line, then the text as the row's link. */
export function PostResultRow({
  post,
  relativeTime,
  absoluteTime,
  onOpenPost,
}: PostResultRowProps) {
  const { author } = post
  return (
    <li className={styles.row} data-testid="search-post" data-post-id={post.id}>
      <Avatar persona={author} size={AVATAR_SIZE} />
      <span className={styles.identity}>
        <span className={styles.nameRow}>
          <span className={styles.name}>{author.displayName}</span>
          {author.verified && (
            <span className={styles.seal}>
              <VerifiedMark size={SEAL_SIZE} />
            </span>
          )}
          <span className={styles.handle}>{`@${author.handle}`}</span>
          <span className={styles.dot} aria-hidden="true">·</span>
          <time className={styles.time} dateTime={post.scenarioTime} title={absoluteTime}>
            {relativeTime}
          </time>
        </span>
        <a
          className={styles.rowLink}
          href={postHref(author.handle, post.id)}
          data-result-link="true"
          onClick={event =>
            activateLink(
              event,
              onOpenPost === undefined ? undefined : () => onOpenPost(post.id),
            )
          }
        >
          <span className={styles.snippet}>{post.text}</span>
        </a>
      </span>
    </li>
  )
}
