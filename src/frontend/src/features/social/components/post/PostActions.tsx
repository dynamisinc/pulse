/**
 * features/social/components/post/PostActions.tsx
 * ---------------------------------------------------------------------------
 * The action row of the decomposed `<PostCard>`: reply · repost · like (R-002) · pin,
 * with PERSISTED like / repost toggles (demo-polish F3 "Engagement"; SOC-030,
 * SOC-020/021, NFR-001, COR-015, D1-011). `PostCard` ALREADY MOUNTS it (F0,
 * DP-14), so every card on every surface — feed, thread, profile, hashtag, the
 * quoted-post card — has live like/repost with NO per-page wiring; this file + its
 * CSS module + the hooks it calls are F3's, and it never touches the frozen
 * `PostCard`.
 *
 * WIRING. The component calls `useReaction()` / `useAmplify()` itself. Both seed
 * ONCE from the post (`counts.like` / `counts.repost`, `viewer.liked` /
 * `viewer.reposted`, so after a refresh the heart / repost are still on) and own
 * the state after: optimistic flip + ±1, `PUT`/`DELETE` through `reactionService`,
 * reconcile to the response, exact rollback on failure (a feed re-render never
 * clobbers an in-flight toggle). The row is keyed by the post id so a card that is
 * re-pointed at a DIFFERENT post (thread navigation reuses the mounted card) never
 * shows the previous post's state or lets an in-flight response land on it.
 *
 * COMPACT COUNTS. Counts render with the shared magnitude formatter —
 * `formatMagnitude` (exact below 1 000, then `1.4K`, `12.3K`, `1.2M`, truncated,
 * `.0` dropped) from `services/audience.ts`; there is no second formatter. A
 * screen reader does not read "1.4K" reliably, so the accessible name carries
 * `spokenMagnitude` ("1.4 thousand") PLUS the exact number ("1.4 thousand (1,450)")
 * from 1 000 up; below 1 000 the name is simply the number ("Like, 42").
 *
 * NEVER COLOUR-ONLY (NFR-001). A toggle's ON state combines: a FILLED icon (the
 * resting icon is an outline — CSS only, the glyph is the same FontAwesome solid
 * path), a bolder count, `aria-pressed="true"`, and an "…, liked" / "…, reposted"
 * accessible-name suffix. A failed write shows a brief inline message with an icon
 * and text, announced through an always-mounted POLITE live region
 * (`role="status"`) so assistive technology hears it without losing focus.
 *
 * PIN (demo-feedback story 07, DF-6). After Like sits the viewer's PERSONAL pin
 * (FontAwesome thumbtack): `usePin` owns an optimistic toggle with exact rollback on
 * failure (the `useReaction` pattern) over `PUT`/`DELETE /api/posts/{id}/reactions/pin`.
 * It shows NO count (a pin is private and never counted). Its accessible name is a STABLE
 * "Pin" and `aria-pressed` carries `viewer.pinned` (the ARIA toggle-button pattern: the name
 * never flips to "Unpin", the pressed state says it); ON is a filled icon (outline at rest)
 * plus the pressed state, never colour alone (NFR-001). It is gated exactly like
 * Like (writable session + bound persona + a non-read-only card) and is ABSENT otherwise -
 * with no count there is nothing to render inert. A failed pin shares the card's one
 * live region. When a pin or a like SETTLES the row tells a mounted Pinned tab
 * (`pinned/pinEvents.viewerEngagement`) so it re-reads without a reload. The row hands
 * `usePin` its `post.viewer` object as the server snapshot, so a FRESHER read (a new
 * object) overrides an older confirmed pin (see `usePin`).
 *
 * EDIT (demo-feedback story 20, DF-29). On the viewer's OWN post, while
 * `post.viewer.editableForSeconds` is above 0, the row shows an Edit button (FontAwesome `faPen`,
 * accessible name and tooltip "Edit post"; a native `title` tooltip - the shared participant
 * tooltip component of story 13 is not on this branch yet). `useEditWindow` counts the duration
 * down from when the post was read and hides the button at 0 without a reload; no clock is ever
 * rendered (COR-053). It opens `EditPostDialog`
 * (text-only); a save reports the fresh window back here, and a refused one (window closed / edit
 * limit) closes it. The row also SEEDS `editedPostsStore` with the card's own `post.edited`, so the
 * header's "Edited" button works for any card without `PostCard` wiring. Like Pin it needs a
 * writable session, so a read-only card never offers it.
 *
 * HIDDEN, NOT DISABLED (D1-011 / F3). There is NO Quote trigger, NO quote panel
 * (`QuoteComposer` is no longer mounted) and NO Share action — they are absent
 * from the DOM, not greyed out. (`useAmplify().doQuote` and `amplify.quotePost`
 * stay for the later quote story.)
 *
 * READ-ONLY / NO-PERSONA / UNWIRED (COR-015 / D1-011, WR-002). An action is a
 * `<button>` only when pressing it does something; otherwise it is the SAME inert
 * markup for all three (an `actionInert` span: icon, count, visually-hidden label,
 * `data-action` kept) — never a focusable no-op:
 *  - `variant === 'readOnly'` (observer cards) OR a session that is itself read-only
 *    (`session.isReadOnly`, even on a `variant="full"` card): ALL THREE are inert.
 *  - a writable session with no bound persona has no identity to react as, so like
 *    and repost are inert.
 *  - Reply is a button only when `onReply` is supplied; omit the prop and it is an
 *    inert count (the page that mounts the card has not wired navigation yet).
 *
 * TELEMETRY (XC-004). LIVE: none from the client — the server emits `reaction` /
 * `repost` (implementation.md §1.8). MOCK: one event per confirmed toggle (see
 * `useReaction` / `useAmplify`).
 *
 * REQUIRES context: `ExerciseContextProvider` + `SessionProvider` (the hooks read
 * `useExerciseContext()` / `useSession()`, which throw outside their providers —
 * fail-closed, there is no default session).
 *
 * DOM hooks (tests depend on them): `data-testid="post-actions"`,
 * `button[data-action="reply|repost|like|pin"]` (or `span[data-action]` when inert; pin
 * is never inert, it is absent),
 * `data-testid="post-actions-notice"` (the live region; present only while a like
 * or repost control is).
 *
 * Participant world — plain elements, FontAwesome icons, `PostActions.module.css`.
 * No COBRA, no MUI.
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faComment,
  faRetweet,
  faHeart,
  faThumbtack,
  faPen,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useReaction } from '../../hooks/useReaction'
import { useAmplify } from '../../hooks/useAmplify'
import { useTransientMessage } from '../../hooks/useTransientMessage'
import { usePin } from '../../pinned/usePin'
import { viewerEngagement } from '../../pinned/pinEvents'
import { formatMagnitude, spokenMagnitude } from '../../services/audience'
import { EditPostDialog } from '../../edit/EditPostDialog'
import { editedPostsStore, useEditedPost } from '../../edit/editedPostsStore'
import { useEditWindow } from '../../edit/useEditWindow'
import type { PostCardVariant, PostView } from './types'
import styles from './PostActions.module.css'

type ActionKey = 'reply' | 'repost' | 'like'

interface ActionSpec {
  key: ActionKey
  label: string
  icon: IconDefinition
  count: number
  /** Accessible-name suffix while ON ("liked" / "reposted"); toggles only. */
  activeSuffix?: string
  /** True when this action renders as a control (else inert count text). */
  interactive: boolean
  /** Toggle actions only: whether the viewer's reaction is currently ON. */
  pressed?: boolean
  onClick?: () => void
}

/**
 * The accessible form of a count: the plain number below 1 000, otherwise the
 * spoken magnitude plus the exact figure ("1.4 thousand (1,450)") so neither the
 * compact visual form nor a truncated spoken form hides the real number.
 */
function spokenCount(count: number): string {
  const spoken = spokenMagnitude(count)
  if (!Number.isFinite(count) || count < 1000) return spoken
  return `${spoken} (${Math.floor(count).toLocaleString('en-US')})`
}

export interface PostActionsProps {
  /** The post the row acts on (id, counts, viewer state). */
  readonly post: PostView
  readonly variant: PostCardVariant
  /** Fires with the post id when the reply action is activated. */
  readonly onReply?: (id: string) => void
}

/**
 * Public entry. Keys the stateful row by post id (see the module header) so the
 * hooks' seed-once state can never outlive the post it belongs to.
 */
export function PostActions(props: PostActionsProps) {
  return <PostActionsRow key={props.post.id} {...props} />
}

function PostActionsRow({ post, variant, onReply }: PostActionsProps) {
  // ONE failure-message channel for both toggles: a single live region per card,
  // and the most recent failure always replaces an older one.
  const notice = useTransientMessage()
  const reaction = useReaction({
    postId: post.id,
    initialLikeCount: post.counts.like,
    initiallyLiked: post.viewer?.liked ?? false,
    notice,
  })
  const amplify = useAmplify({
    postId: post.id,
    initialRepostCount: post.counts.repost,
    initiallyReposted: post.viewer?.reposted ?? false,
    notice,
  })

  const pin = usePin({
    postId: post.id,
    initiallyPinned: post.viewer?.pinned === true,
    serverSnapshot: post.viewer,
    notice,
  })

  // Edit (story 20). The card's own `edited` summary seeds the shared overlay store (a layout
  // effect, so the header shows "Edited" in the same paint); a live push or save overrides it.
  useLayoutEffect(() => {
    editedPostsStore.noteBase(post.id, post.edited)
  }, [post.id, post.edited])
  const [windowSeconds, setWindowSeconds] = useState<number | undefined>(undefined)
  // The Edit button that opened the dialog (focus returns to it); `null` = dialog closed.
  const [editOpener, setEditOpener] = useState<HTMLElement | null>(null)
  const editedView = useEditedPost(post.id)
  const editOffered = useEditWindow(windowSeconds ?? post.viewer?.editableForSeconds)

  // A like SETTLED (pending true -> false): tell a mounted Pinned tab, which lists liked
  // posts too. The like hook is shared with every surface, so the row observes it rather
  // than threading a callback through it. A rolled-back like re-reads harmlessly.
  const likePendingRef = useRef(reaction.pending)
  useEffect(() => {
    const wasPending = likePendingRef.current
    likePendingRef.current = reaction.pending
    if (wasPending && !reaction.pending) {
      viewerEngagement.notify({ postId: post.id, kind: 'like', active: reaction.likedByViewer })
    }
  }, [reaction.pending, reaction.likedByViewer, post.id])

  // A card is read-only when its VARIANT says so (observer shells) or when the SESSION
  // itself is read-only — the two can disagree (`variant="full"` + a read-only
  // session), and then all three actions must still go inert together (COR-015).
  const isReadOnly = variant === 'readOnly' || reaction.isReadOnly
  const canLike = !isReadOnly && reaction.canReact
  const canRepost = !isReadOnly && amplify.canAmplify
  const canReply = !isReadOnly && onReply !== undefined
  // Gated exactly like Like (story 07). No count, so when it cannot act it is absent.
  const canPin = !isReadOnly && pin.canPin
  const canEdit = !isReadOnly && !reaction.isReadOnly && editOffered

  // Canonical reply · repost · like order (R-002). A toggle shows the hook's own
  // optimistic total only while it is a live control; inert counts follow the post.
  const actions: ActionSpec[] = [
    {
      key: 'reply',
      label: 'Reply',
      icon: faComment,
      count: post.counts.reply,
      // `onReply` is optional: omitted => inert text, never a focusable no-op button.
      interactive: canReply,
      onClick: canReply ? () => onReply(post.id) : undefined,
    },
    {
      key: 'repost',
      label: 'Repost',
      icon: faRetweet,
      count: canRepost ? amplify.repostCount : post.counts.repost,
      activeSuffix: 'reposted',
      interactive: canRepost,
      pressed: canRepost ? amplify.repostedByViewer : undefined,
      onClick: canRepost ? amplify.toggleRepost : undefined,
    },
    {
      key: 'like',
      label: 'Like',
      icon: faHeart,
      count: canLike ? reaction.likeCount : post.counts.like,
      activeSuffix: 'liked',
      interactive: canLike,
      pressed: canLike ? reaction.likedByViewer : undefined,
      onClick: canLike ? reaction.toggleLike : undefined,
    },
  ]

  return (
    <>
      <div className={styles.actions} data-testid="post-actions">
        {actions.map(action => {
          const compact = formatMagnitude(action.count)
          const spoken = spokenCount(action.count)

          if (!action.interactive) {
            return (
              <span key={action.key} className={styles.actionInert} data-action={action.key}>
                <FontAwesomeIcon
                  icon={action.icon}
                  aria-hidden="true"
                  className={styles.actionIcon}
                />
                {/* "1.4K" is read unreliably by screen readers, so when the compact
                    form differs from the spoken one the visual copy is hidden from
                    AT and the spoken copy stands in for it. */}
                <span className={styles.actionCount} aria-hidden={spoken !== compact || undefined}>
                  {compact}
                </span>
                {spoken !== compact && <span className={styles.srOnly}>{spoken}</span>}
                <span className={styles.srOnly}>{action.label}</span>
              </span>
            )
          }

          const isOn = action.pressed === true
          const label =
            isOn && action.activeSuffix
              ? `${action.label}, ${spoken}, ${action.activeSuffix}`
              : `${action.label}, ${spoken}`

          return (
            <button
              key={action.key}
              type="button"
              className={
                isOn ? `${styles.actionButton} ${styles.actionButtonActive}` : styles.actionButton
              }
              data-action={action.key}
              aria-label={label}
              aria-pressed={action.pressed}
              onClick={action.onClick}
            >
              <FontAwesomeIcon icon={action.icon} aria-hidden="true" className={styles.actionIcon} />
              <span className={styles.actionCount}>{compact}</span>
            </button>
          )
        })}
        {canPin && (
          <button
            type="button"
            className={
              pin.pinned
                ? `${styles.actionButton} ${styles.actionButtonActive}`
                : styles.actionButton
            }
            data-action="pin"
            aria-label="Pin"
            aria-pressed={pin.pinned}
            onClick={pin.toggle}
          >
            <FontAwesomeIcon icon={faThumbtack} aria-hidden="true" className={styles.actionIcon} />
          </button>
        )}
        {canEdit && (
          <button
            type="button"
            className={styles.actionButton}
            data-action="edit"
            aria-label="Edit post"
            aria-haspopup="dialog"
            title="Edit post"
            onClick={event => setEditOpener(event.currentTarget)}
          >
            <FontAwesomeIcon icon={faPen} aria-hidden="true" className={styles.actionIcon} />
          </button>
        )}
      </div>
      {editOpener !== null && (
        <EditPostDialog
          postId={post.id}
          initialText={editedView.text ?? post.text}
          media={post.media}
          returnFocusTo={editOpener}
          onClose={() => setEditOpener(null)}
          onSaved={result => setWindowSeconds(result.editableForSeconds)}
          onRejected={() => setWindowSeconds(0)}
        />
      )}
      {/* Always mounted while a like / repost / pin control exists (only those can fail), so
          the region exists BEFORE its text changes — a live region injected with its
          content is announced unreliably. Empty when there is nothing to say. */}
      {(canLike || canRepost || canPin) && (
        <div
          className={styles.notice}
          role="status"
          aria-live="polite"
          aria-atomic="true"
          data-testid="post-actions-notice"
        >
          {notice.message !== null && (
            <>
              <FontAwesomeIcon
                icon={faCircleExclamation}
                aria-hidden="true"
                className={styles.noticeIcon}
              />
              <span>{notice.message}</span>
            </>
          )}
        </div>
      )}
    </>
  )
}
