/**
 * features/social/pinned/PinnedFeed.tsx
 * ---------------------------------------------------------------------------
 * The Home page's **Pinned** tab (demo-feedback story 07; DF-5, DF-6, DF-7). Participants
 * come back here to rewatch a newscast or re-read an advisory: the posts a controller
 * pinned for everyone first, then the viewer's own pins and likes.
 *
 * DATA. `usePinnedFeed` reads `GET /api/feed/pinned` (DF-5 order, kept as the server sent
 * it) and re-reads when the viewer's own pin / like settles anywhere or a `PostPinChanged`
 * push lands. Taken-down posts leave the tab the moment the session's `removedPosts` store
 * records them (`PostRemoved`), with no re-read.
 *
 * RENDERING. Each item is a `<PostCard>` - the same card, actions and media as the feed,
 * so a video plays here exactly as it does on All Posts. A post pinned for everyone
 * (`pinnedForAll`) shows the card's own shared "Pinned" marker (`PinnedMarker`, story 21)
 * above the author line, exactly as on every other surface: fiction-safe words, the word
 * carries the meaning and the thumbtack is decoration (NFR-001), and the card's `<article>`
 * is described by it. `usePinnedFeed` patches `pinnedForAll` on a `PostPinChanged` push, so
 * the marker moves at once. A post whose author is not in the cast is skipped, as on the
 * feed.
 *
 * TIME (COR-053). Every timestamp here is the card's own scenario-time header; this
 * component renders no time of its own.
 *
 * STATES. Loading: the feed skeleton. A first read that fails: an in-fiction "not
 * available" line, never an empty tab. Empty: "Posts you pin or like show up here."
 *
 * FOCUS (NFR-001). Unpinning (or unliking) the focused post can take its card off the tab;
 * focus then moves to the tab's own region instead of dropping to the page.
 *
 * World: participant (Pulse skin). Plain elements + CSS Module + FontAwesome; no COBRA,
 * no MUI.
 */

import {
  memo,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type FocusEvent,
} from 'react'
import { usePersonas, type Persona } from '@/features/personas'
import {
  useShellContext,
  affordancesAvailable,
} from '@/features/participant-shell/mountContract'
import { PostCard } from '../components/PostCard'
import type { PostView } from '../components/PostCard'
import { FeedSkeleton } from '../components/FeedSkeleton'
import { toPostView } from '../services/feedService'
import { removedPosts } from '../services/removedPosts'
import { requestReplyFocus } from '../services/replyIntent'
import type { PinChangeSource } from '../services/realtimeFeed'
import { usePinnedFeed } from './usePinnedFeed'
import styles from './PinnedFeed.module.css'

/** The empty state's copy (AC). */
export const PINNED_EMPTY_COPY = 'Posts you pin or like show up here.'

export interface PinnedFeedProps {
  /** Opens a post's thread (the shell supplies it). */
  readonly onOpenThread?: (id: string) => void
  /** Opens a hashtag feed. */
  readonly onHashtagOpen?: (tag: string) => void
  /** Opens an author's profile. */
  readonly onOpenProfile?: (personaId: string) => void
  /** Test seam: the `PostPinChanged` source (defaults to the app-wide `realtimeFeed`). */
  readonly pinChangeSource?: PinChangeSource
}

interface PinnedRowProps {
  readonly post: PostView
  readonly variant: 'full' | 'readOnly'
  readonly onOpenThread?: (id: string) => void
  readonly onReply?: (id: string) => void
  readonly onHashtagOpen?: (tag: string) => void
  readonly onOpenProfile?: (personaId: string) => void
}

/**
 * One item: the card, which draws its own "Pinned" marker (story 21). Memoized like the
 * feed's rows.
 */
const PinnedRow = memo(function PinnedRow({
  post,
  variant,
  onOpenThread,
  onReply,
  onHashtagOpen,
  onOpenProfile,
}: PinnedRowProps) {
  return (
    <li className={styles.row} data-pinned-post-id={post.id}>
      <PostCard
        post={post}
        variant={variant}
        onOpen={onOpenThread}
        onReply={onReply}
        onHashtagOpen={onHashtagOpen}
        onOpenProfile={onOpenProfile}
      />
    </li>
  )
})

interface PinnedRowModel {
  readonly view: PostView
}

export function PinnedFeed({
  onOpenThread,
  onHashtagOpen,
  onOpenProfile,
  pinChangeSource,
}: PinnedFeedProps) {
  const { items, status } = usePinnedFeed(pinChangeSource)
  const { personas } = usePersonas()
  const { variant } = useShellContext()
  const cardVariant = affordancesAvailable(variant) ? 'full' : 'readOnly'
  const removed = useSyncExternalStore(removedPosts.subscribe, removedPosts.getAll)
  const headingId = useId()
  const sectionRef = useRef<HTMLElement>(null)

  const personaById = useMemo(
    () => new Map<string, Persona>(personas.map(persona => [persona.id, persona] as const)),
    [personas],
  )

  // Server order kept; taken-down posts and unknown authors skipped.
  const rows = useMemo(() => {
    const out: PinnedRowModel[] = []
    for (const item of items) {
      if (removed.has(item.post.id)) continue
      const author = personaById.get(item.post.authorPersonaId)
      if (author === undefined) continue
      // `toPostView` carries `pinnedForAll`, so the card shows its own marker.
      out.push({ view: toPostView(item.post, author) })
    }
    return out
  }, [items, removed, personaById])

  const handleReply = useCallback((postId: string) => {
    if (onOpenThread === undefined) return
    requestReplyFocus(postId)
    onOpenThread(postId)
  }, [onOpenThread])

  // Focus continuity: remember which post holds focus; if its card leaves the tab while
  // focus fell to the page, give focus to the region (see the module header).
  const focusedPostIdRef = useRef<string | null>(null)
  // Focus moved OUT of the tab to a real element: nothing to restore later. (A blur with no
  // related target - the focused card being removed - keeps the memory.)
  const handleBlur = (event: FocusEvent<HTMLElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) {
      focusedPostIdRef.current = null
    }
  }
  const handleFocus = (event: FocusEvent<HTMLElement>) => {
    const target = event.target
    focusedPostIdRef.current =
      target instanceof HTMLElement
        ? target.closest<HTMLElement>('[data-pinned-post-id]')?.dataset.pinnedPostId ?? null
        : null
  }
  useLayoutEffect(() => {
    const focusedId = focusedPostIdRef.current
    if (focusedId === null || rows.some(row => row.view.id === focusedId)) return
    focusedPostIdRef.current = null
    const active = document.activeElement
    if (active === null || active === document.body) {
      sectionRef.current?.focus({ preventScroll: true })
    }
  }, [rows])

  return (
    <section
      ref={sectionRef}
      className={styles.feed}
      aria-labelledby={headingId}
      tabIndex={-1}
      onFocus={handleFocus}
      onBlur={handleBlur}
      data-testid="pinned-feed"
    >
      <h1 id={headingId} className={styles.srOnly}>Pinned</h1>

      <ul className={styles.list}>
        {rows.map(row => (
          <PinnedRow
            key={row.view.id}
            post={row.view}
            variant={cardVariant}
            onOpenThread={onOpenThread}
            onReply={onOpenThread !== undefined ? handleReply : undefined}
            onHashtagOpen={onHashtagOpen}
            onOpenProfile={onOpenProfile}
          />
        ))}
      </ul>

      {status === 'loading' && <FeedSkeleton />}
      {status === 'error' && (
        <p className={styles.state} role="status">Pinned posts aren’t available right now.</p>
      )}
      {status === 'ready' && rows.length === 0 && (
        <p className={styles.state}>{PINNED_EMPTY_COPY}</p>
      )}
    </section>
  )
}
