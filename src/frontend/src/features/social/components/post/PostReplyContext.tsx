/**
 * features/social/components/post/PostReplyContext.tsx
 * ---------------------------------------------------------------------------
 * The "Replying to @handle" context line of the decomposed `<PostCard>`
 * (demo-polish F0 stub, F4 finish). `PostCard` mounts it between the header and the
 * text; it renders NOTHING unless the post is a reply (`inReplyTo` present), so every
 * non-reply card is unchanged.
 *
 * `inReplyTo.authorHandle` carries NO leading '@' (contract v2, §1.5.3); the
 * component adds it. The line is ONE text node so it reads as a single phrase to
 * assistive tech and is trivially queryable; the handle is rendered as plain React
 * text (a handle from the wire is never parsed as markup - NFR-004). Not
 * interactive: it names the author, it does not link to them (linking needs the
 * shell's navigation, which this part deliberately does not know about).
 *
 * ONE LINE PER REPLY (demo-polish F4). This is the ONLY "Replying to @handle" line
 * on a reply card, wherever the card appears - the feed (when replies are included),
 * a profile's "Posts & replies", and a thread, where it shows on an ancestor that is
 * itself a reply, on the focused post, and on every direct reply. `ThreadView` used
 * to print its own label above each reply and blank the card's `inReplyTo` to avoid
 * a duplicate; that is gone. A taken-down reply is a tombstone with no card, so it
 * shows no line.
 *
 * Participant world - plain element + `PostReplyContext.module.css`.
 */

import type { PostInReplyTo } from '../../types/post'
import styles from './PostReplyContext.module.css'

export interface PostReplyContextProps {
  readonly inReplyTo?: PostInReplyTo
}

export function PostReplyContext({ inReplyTo }: PostReplyContextProps) {
  if (inReplyTo == null) return null

  return (
    <p className={styles.replyContext} data-testid="post-reply-context">
      {`Replying to @${inReplyTo.authorHandle}`}
    </p>
  )
}
