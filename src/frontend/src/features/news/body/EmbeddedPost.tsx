/**
 * features/news/body/EmbeddedPost.tsx
 * ---------------------------------------------------------------------------
 * An embedded Pulse post in an article body (news-network 06; NWS-015, SOC-002/004,
 * XC-001/002/010, E4-Q10).
 *
 * THE CARD IS SOCIAL'S, VERBATIM. The post is resolved with Social's `usePostById` (the
 * exercise-scoped thread read: no exercise id in the URL, and an unknown, foreign,
 * deleted or hidden id is the SAME "unavailable" answer, so an embed leaks nothing about
 * existence) and rendered with Social's read-only `<PostCard>`, mapped by Social's own
 * `toPostView`. Nothing here restyles the card.
 *
 * THE OUTLET SKIN NEVER REACHES IT. The card sits inside F13's `SkinResetBoundary` (every
 * `--pulse-skin-*` unset, type and colour back to the participant base, the outer MUI
 * theme restored, the exercise brand re-published), and then inside Social's own
 * `SocialBrandScope`, which sets `--pulse-ac` (F13 notes: the card needs Social's accent
 * scope, not the outlet's). The verified seal stays Social's fixed `#2D9CDB`. So the same
 * post looks identical in the feed, a link card and every outlet's article.
 *
 * OPENING IT. The card's own stretched open target (a real `<button>`, keyboard-operable,
 * the feed's pattern) routes to the post's thread in the Social channel, and reports the
 * open through `onOpen` (story 19's `content_embed_open` telemetry hook, wired by 04).
 *
 * STATES. Loading: a skeleton (announced as busy, no motion under reduced-motion).
 * Unavailable, or an author not in the exercise cast: the in-fiction line "This post is
 * unavailable." (`role="note"`, icon plus words, never colour alone; Social's wording).
 *
 * World: participant. No COBRA, no MUI visuals.
 */

import { useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBan } from '@fortawesome/free-solid-svg-icons'
import { SkinResetBoundary } from '@/features/channels'
import { usePersonas } from '@/features/personas'
import {
  PostCard,
  SocialBrandScope,
  socialPostPath,
  toPostView,
  usePostById,
} from '@/features/social'
import styles from './EmbeddedPost.module.css'

/** The in-fiction tombstone line (Social's thread wording, XC-010). */
export const POST_UNAVAILABLE_TEXT = 'This post is unavailable.'

export interface EmbeddedPostProps {
  /** The `<pulse-post data-id>` value. */
  readonly postId: string
  /** Called when the reader opens the embed (before routing to the thread). */
  readonly onOpen?: (postId: string) => void
}

/** One embedded post: Social's card inside the brand reset. See the module header. */
export function EmbeddedPost({ postId, onOpen }: EmbeddedPostProps) {
  return (
    <SkinResetBoundary>
      <SocialBrandScope>
        <div className={styles.embed} data-testid="news-embedded-post" data-post-embed={postId}>
          <EmbeddedPostContent postId={postId} onOpen={onOpen} />
        </div>
      </SocialBrandScope>
    </SkinResetBoundary>
  )
}

function EmbeddedPostContent({ postId, onOpen }: EmbeddedPostProps) {
  const answer = usePostById(postId)
  const { personas, loading: personasLoading } = usePersonas()
  const navigate = useNavigate()

  const view = useMemo(() => {
    if (answer.status !== 'ready') return undefined
    const author = personas.find(persona => persona.id === answer.post.authorPersonaId)
    return author === undefined ? undefined : toPostView(answer.post, author)
  }, [answer, personas])

  const handle = view?.author.handle
  const handleOpen = useCallback((id: string) => {
    onOpen?.(id)
    void navigate(socialPostPath(id, handle))
  }, [handle, navigate, onOpen])

  const awaitingAuthor = answer.status === 'ready' && view === undefined && personasLoading
  if (answer.status === 'loading' || awaitingAuthor) return <EmbeddedPostSkeleton />
  if (view === undefined) {
    return (
      <p className={styles.tombstone} role="note" data-testid="news-embedded-post-unavailable">
        <FontAwesomeIcon icon={faBan} aria-hidden="true" className={styles.tombstoneIcon} />
        {POST_UNAVAILABLE_TEXT}
      </p>
    )
  }
  return <PostCard post={view} readOnly onOpen={handleOpen} />
}

function EmbeddedPostSkeleton() {
  return (
    <div
      className={styles.skeleton}
      role="status"
      aria-busy="true"
      aria-label="Loading post"
      data-testid="news-embedded-post-loading"
    >
      <span className={styles.skeletonAvatar} />
      <span className={styles.skeletonLines}>
        <span className={styles.skeletonLine} />
        <span className={styles.skeletonLine} />
        <span className={`${styles.skeletonLine} ${styles.skeletonShort}`} />
      </span>
    </div>
  )
}
