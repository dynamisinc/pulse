/**
 * features/social/components/post/PostActions.tsx
 * ---------------------------------------------------------------------------
 * The action row of the decomposed `<PostCard>`: reply · repost · like (R-002),
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
 * HIDDEN, NOT DISABLED (D1-011 / F3). There is NO Quote trigger, NO quote panel
 * (`QuoteComposer` is no longer mounted) and NO Share action — they are absent
 * from the DOM, not greyed out. (`useAmplify().doQuote` and `amplify.quotePost`
 * stay for the later quote story.)
 *
 * READ-ONLY / NO-PERSONA (COR-015 / D1-011). `variant === 'readOnly'` (observer
 * sessions) renders NO buttons at all: every count is inert text with a
 * visually-hidden label. A writable session with no bound persona has no identity
 * to react as, so its like / repost are likewise inert counts (never a dead
 * button); reply stays a button. `onReply` is an optional prop: omit it and the
 * reply button is an inert-until-wired `<button>`.
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
 * `button[data-action="reply|repost|like"]` (or `span[data-action]` when inert),
 * `data-testid="post-actions-notice"` (the live region).
 *
 * Participant world — plain elements, FontAwesome icons, `PostActions.module.css`.
 * No COBRA, no MUI.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faComment,
  faRetweet,
  faHeart,
  faCircleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useReaction } from '../../hooks/useReaction'
import { useAmplify } from '../../hooks/useAmplify'
import { useTransientMessage } from '../../hooks/useTransientMessage'
import { formatMagnitude, spokenMagnitude } from '../../services/audience'
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

  const isReadOnly = variant === 'readOnly'
  const canLike = !isReadOnly && reaction.canReact
  const canRepost = !isReadOnly && amplify.canAmplify

  // Canonical reply · repost · like order (R-002). A toggle shows the hook's own
  // optimistic total only while it is a live control; inert counts follow the post.
  const actions: ActionSpec[] = [
    {
      key: 'reply',
      label: 'Reply',
      icon: faComment,
      count: post.counts.reply,
      interactive: !isReadOnly,
      // `onReply` is optional: omitted => an inert-until-wired button.
      onClick: onReply ? () => onReply(post.id) : undefined,
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
      </div>
      {/* Always mounted (when there are controls) so the region exists BEFORE its
          text changes — a live region injected with its content is announced
          unreliably. Empty when there is nothing to say. */}
      {!isReadOnly && (
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
