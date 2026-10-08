/**
 * features/social/explore/SearchResultRows.tsx
 * ---------------------------------------------------------------------------
 * The result rows `SearchBox` renders (demo-polish F6; SOC-042, SOC-052, D1-008):
 * `PersonResultRow` (People) and `PostResultRow` (Posts). Participant world — plain
 * elements and a scoped CSS Module; the avatar and seal are the shared primitives.
 *
 * THE LOOKALIKE RULE (SOC-052 / D1-008). A verified agency and its unverified
 * lookalike (`@FairhavenWater` / `@FairhavenWaterUpd`) render IDENTICALLY except for
 * the seal. `PersonResultRow` has exactly one branch on a trust signal —
 * `{persona.verified && <span><VerifiedMark/></span>}` — and nothing else reads
 * `verified`, `kind` or any archetype: same elements, classes, attribute names and
 * copy; no "official"/"unverified" label, no `data-verified`, no muted styling. The
 * seal's absence is the only signal, as on a post card. Name, handle and bio are the
 * account's own words, rendered verbatim (D1-R1). The seal is a SIBLING of the link,
 * not inside it, so it keeps its own `role="img"` name.
 *
 * ONE ACCESSIBLE DESCRIPTION. The profile link is described by the handle and, when
 * present, the seal (`aria-describedby`), so a screen-reader user hears "View Fairhaven
 * Water Utility's profile, link, @FairhavenWater, Verified account" while the
 * lookalike simply lacks the last part — the same signal a sighted reader gets. The
 * ids are neutral (`…-handle`, `…-mark`); only their count differs between the rows.
 *
 * A RESERVED HANDLE IS NOT A LINK. A persona whose handle is a reserved first segment
 * (`home`, `staff`, ... -- COR-004) has no profile URL: `/home` is the feed, `/staff` is
 * redirected away. Such a row renders its name as plain text with no `href` and no
 * stretched target (absent, not a link that bounces), exactly as `useSocialOpeners`
 * refuses to open one. Every real handle takes the link path unchanged, so the lookalike
 * pair above is still structurally identical.
 *
 * ROW ACTIVATION. Each row has ONE link, stretched over the whole row
 * (`.rowLink::after`): one large target, one tab stop. It is a real `<a href>`
 * (`exploreNavigation.ts`); a plain click is handed to the in-app opener.
 * `data-result-link` (on every row alike) is the hook `SearchBox` uses for
 * Up/Down navigation.
 *
 * CONTENT SECURITY (NFR-004): post and persona text are React text children only.
 * SCENARIO TIME (COR-053): a post row's time arrives pre-formatted from the parent's
 * single `useScenarioTime` snapshot — a row never reads a clock, and 50 rows run one
 * timer.
 */

import { useId } from 'react'
import type { Persona } from '@/features/personas'
import { Avatar } from '../components/Avatar'
import { VerifiedMark } from '../components/VerifiedMark'
import type { PostView } from '../components/post/types'
import { isReservedSegment, socialPaths } from '../layout/socialNavigation'
import { activateLink } from './exploreNavigation'
import styles from './SearchResultRows.module.css'

const AVATAR_SIZE = 40
const SEAL_SIZE = 15

export interface PersonResultRowProps {
  readonly persona: Persona
  /** Opens the account's profile by persona id. */
  readonly onOpenProfile: (personaId: string) => void
}

/** One account in the People section. See the module header: seal is the ONLY difference. */
export function PersonResultRow({ persona, onOpenProfile }: PersonResultRowProps) {
  const base = useId()
  const handleId = `${base}-handle`
  const markId = `${base}-mark`
  // A reserved handle has no profile page to link to (see the module header).
  const linkable = !isReservedSegment(persona.handle)
  return (
    <li className={styles.row} data-testid="search-person">
      <Avatar persona={persona} size={AVATAR_SIZE} />
      <span className={styles.identity}>
        <span className={styles.nameRow}>
          {linkable
            ? (
              <a
                className={styles.rowLink}
                href={socialPaths.profile(persona.handle)}
                data-result-link="true"
                aria-label={`View ${persona.displayName}'s profile`}
                aria-describedby={persona.verified ? `${handleId} ${markId}` : handleId}
                onClick={event => activateLink(event, () => onOpenProfile(persona.id))}
              >
                {persona.displayName}
              </a>
            )
            : <span className={styles.rowName}>{persona.displayName}</span>}
          {persona.verified && (
            <span id={markId} className={styles.seal}>
              <VerifiedMark size={SEAL_SIZE} />
            </span>
          )}
        </span>
        <span id={handleId} className={styles.handle}>{`@${persona.handle}`}</span>
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
  /** Opens the post's thread (the author's handle only decorates the URL). */
  readonly onOpenPost: (postId: string, authorHandle?: string) => void
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
          href={socialPaths.thread(post.id, author.handle)}
          data-result-link="true"
          onClick={event => activateLink(event, () => onOpenPost(post.id, author.handle))}
        >
          <span className={styles.snippet}>{post.text}</span>
        </a>
      </span>
    </li>
  )
}
