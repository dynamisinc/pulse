/**
 * features/social/components/post/PostReplyContext.tsx
 * ---------------------------------------------------------------------------
 * The "Replying to @handle" context line of the decomposed `<PostCard>`
 * (demo-polish F0). `PostCard` ALREADY MOUNTS it between the header and the text;
 * it renders NOTHING unless the post is a reply (`inReplyTo` present), so every
 * existing card is unchanged. F4 (threads & composer) owns this file + its CSS
 * module from here on.
 *
 * `inReplyTo.authorHandle` carries NO leading '@' (contract v2, §1.5.3); the
 * component adds it. The line is one text node so it reads as a single phrase to
 * assistive tech and is trivially queryable. Not interactive in F0 (F4 may make
 * the handle a profile link).
 *
 * NOTE: `ThreadView` shows its own "Replying to @handle" label above each direct
 * reply (it resolves the replied-to persona), so it deliberately does not pass
 * `inReplyTo` down to those cards — avoiding a duplicate line until F4 unifies
 * the two.
 *
 * Participant world — plain element + `PostReplyContext.module.css`.
 */

import type { PostInReplyTo } from '../../types/post'
import styles from './PostReplyContext.module.css'

export interface PostReplyContextProps {
  readonly inReplyTo?: PostInReplyTo
}

export function PostReplyContext({ inReplyTo }: PostReplyContextProps) {
  if (inReplyTo === undefined) return null

  return (
    <p className={styles.replyContext} data-testid="post-reply-context">
      {`Replying to @${inReplyTo.authorHandle}`}
    </p>
  )
}
