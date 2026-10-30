/**
 * features/social/hooks/usePostById.ts
 * ---------------------------------------------------------------------------
 * One post by id, for a channel that embeds a Social post in its own page
 * (channels-foundation 21, news FU-6a / NWS-015: an article's embedded post).
 * Participant world; a pure data hook, no UI.
 *
 * THE ANSWER IS ONE OF THREE, never a throw (so an embed never reaches an error boundary):
 *   - `{ status: 'loading' }`               the read is in flight;
 *   - `{ status: 'ready', post }`           the participant-safe post (`ParticipantPostView`,
 *                                           XC-002: no provenance on the type at all);
 *   - `{ status: 'unavailable' }`           anything else. The embedding article shows its
 *                                           in-fiction "post unavailable" (XC-010, E4-Q10).
 *
 * "Unavailable" is deliberately ONE answer for: an unknown id, a post of ANOTHER exercise,
 * a soft-deleted / taken-down / hidden post, a reply tombstone, and a failed read. The
 * caller cannot tell them apart, so an embed leaks nothing, not even whether a foreign id
 * exists (XC-001). The same object is returned for all of them.
 *
 * THE READ. It reuses the existing exercise-scoped thread read (`resolveThread`,
 * `GET /api/threads/{id}`): the server answers an unknown, cross-exercise or soft-deleted
 * focus with `focused: null`, so scope comes ONLY from the session (no exercise id is
 * accepted or sent). As defense in depth, a post that carries an `exerciseId` (the mock
 * store's posts do) other than the session's is treated as unknown too.
 *
 * TAKEDOWN. A post a controller takes down while it is embedded (the session's
 * `removedPosts` store) turns `unavailable` at once, without a reload. Otherwise the answer
 * is the read's snapshot: a later edit or count change shows on the next mount, not live.
 */

import { useEffect, useState, useSyncExternalStore } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { toParticipantView } from '../services/postService'
import { removedPosts } from '../services/removedPosts'
import { isVisiblePost } from '../explore/visibility'
import { resolveThread } from './useThread'
import type { ParticipantPostView, Post } from '../types/post'

export type UsePostByIdResult =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly post: ParticipantPostView }
  | { readonly status: 'unavailable' }

const LOADING: UsePostByIdResult = Object.freeze({ status: 'loading' })
/** The single "unavailable" answer (see the module header). */
export const POST_UNAVAILABLE: UsePostByIdResult = Object.freeze({ status: 'unavailable' })

/** Whether a resolved post may be embedded in this session. */
function isEmbeddable(post: Post, exerciseId: string): boolean {
  // Live: the server already scoped it and the participant wire carries no exercise id.
  const scope: unknown = 'exerciseId' in post ? post.exerciseId : undefined
  if (typeof scope === 'string' && scope !== exerciseId) return false
  if (!isVisiblePost(post)) return false
  const status: unknown = 'status' in post ? post.status : undefined
  return status !== 'hidden'
}

interface Resolved {
  /** The id + exercise this answer is for (a stale answer is ignored). */
  readonly key: string
  readonly result: UsePostByIdResult
}

/** The participant-safe post `postId` of the session's exercise. See the module header. */
export function usePostById(postId: string): UsePostByIdResult {
  const { exerciseId } = useExerciseContext()
  const key = `${exerciseId}|${postId}`
  const [resolved, setResolved] = useState<Resolved | undefined>(undefined)

  useEffect(() => {
    if (postId === '') return
    let cancelled = false
    resolveThread(postId)
      .then(thread => {
        if (cancelled) return
        const focused = thread.focused
        const result: UsePostByIdResult =
          focused !== null && focused.id === postId && isEmbeddable(focused, exerciseId)
            ? { status: 'ready', post: toParticipantView(focused) }
            : POST_UNAVAILABLE
        setResolved({ key, result })
      })
      .catch(() => {
        if (!cancelled) setResolved({ key, result: POST_UNAVAILABLE })
      })
    return () => {
      cancelled = true
    }
  }, [key, postId, exerciseId])

  const takenDown = useSyncExternalStore(
    removedPosts.subscribe,
    () => removedPosts.has(postId),
    () => removedPosts.has(postId),
  )

  if (postId === '' || takenDown) return POST_UNAVAILABLE
  if (resolved === undefined || resolved.key !== key) return LOADING
  return resolved.result
}
