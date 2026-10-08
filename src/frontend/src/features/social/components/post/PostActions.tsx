/**
 * features/social/components/post/PostActions.tsx
 * ---------------------------------------------------------------------------
 * The action row of the decomposed `<PostCard>`: reply · repost · like (· share)
 * (R-002), the separate Quote trigger and the inline quote panel (demo-polish
 * F0, DP-14). `PostCard` ALREADY MOUNTS it, so F3 (engagement) owns this file +
 * its CSS module + the hooks it calls — it never needs to touch the frozen
 * `PostCard`.
 *
 * SELF-WIRING (DP-14 — the relocation F0 performed). Before F0 the like/repost/
 * quote wiring lived at TWO call sites (`Feed.tsx`'s `FeedRow`, `ThreadView.tsx`'s
 * `ThreadCard`) and Profile / HashtagFeed / QuotePostCard cards had DEAD buttons.
 * Now this component calls the existing LOCAL-OPTIMISTIC `useReaction()` /
 * `useAmplify()` hooks itself, so every card everywhere has live like/repost with
 * NO per-page wiring, and F3 can make them persist by editing only this part and
 * those hooks. Behaviour is otherwise unchanged:
 *  - `useReaction` seeds from `post.counts.like` and the post's `viewer.liked`
 *    (the seed is read once; the hook owns the state after — a feed re-render
 *    never clobbers an in-flight toggle). The displayed like count is the hook's
 *    optimistic total, so a toggle renders immediately (SOC-030).
 *  - The like control carries `aria-pressed` plus an "…, liked" accessible-name
 *    suffix, and the active state pairs a colour change with a count weight
 *    change — never colour-only (NFR-001).
 *  - Repost is wired when the session can amplify (`useAmplify().canAmplify`); the
 *    SEPARATE Quote trigger next to it opens an inline `QuoteComposer` panel. Quote
 *    deliberately carries NO `data-action`, so the reply/repost/like(/share)
 *    canonical set (R-002) and every `button[data-action]` assertion are unaffected.
 *  - `onReply` is an optional prop: omit it and the reply button is an
 *    inert-until-wired `<button>`. Never wired in `readOnly`.
 *  - `variant === 'readOnly'` (COR-015/D1-011, observer sessions): the interactive
 *    controls are ABSENT — not disabled — and the counts render as inert text with
 *    a visually-hidden label.
 *
 * REQUIRES context: `ExerciseContextProvider` + `SessionProvider` (the hooks read
 * `useExerciseContext()` / `useSession()`, which throw outside their providers —
 * fail-closed, there is no default session).
 *
 * DOM hooks (tests depend on them): `data-testid="post-actions"`,
 * `button[data-action="reply|repost|like|share"]`, `data-testid="post-quote-trigger"`,
 * `data-testid="quote-composer"` (the panel).
 *
 * Participant world — plain elements, FontAwesome icons, `PostActions.module.css`.
 * No COBRA, no MUI.
 */

import { Fragment, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faComment,
  faRetweet,
  faHeart,
  faArrowUpFromBracket,
  faQuoteRight,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { useReaction } from '../../hooks/useReaction'
import { useAmplify } from '../../hooks/useAmplify'
import { QuoteComposer } from '../QuoteComposer'
import type { PostCardVariant, PostCounts, PostView } from './types'
import styles from './PostActions.module.css'

interface ActionSpec {
  key: 'reply' | 'repost' | 'like' | 'share'
  label: string
  icon: IconDefinition
  count: number
}

/** Canonical reply · repost · like (· share) order (R-002). */
function buildActions(counts: PostCounts): ActionSpec[] {
  const actions: ActionSpec[] = [
    { key: 'reply', label: 'Reply', icon: faComment, count: counts.reply },
    { key: 'repost', label: 'Repost', icon: faRetweet, count: counts.repost },
    { key: 'like', label: 'Like', icon: faHeart, count: counts.like },
  ]
  if (counts.share !== undefined) {
    actions.push({ key: 'share', label: 'Share', icon: faArrowUpFromBracket, count: counts.share })
  }
  return actions
}

export interface PostActionsProps {
  /** The post the row acts on (id, counts, viewer state, author name for the quote form). */
  readonly post: PostView
  readonly variant: PostCardVariant
  /** Fires with the post id when the reply action is activated. */
  readonly onReply?: (id: string) => void
}

export function PostActions({ post, variant, onReply }: PostActionsProps) {
  const reaction = useReaction({
    postId: post.id,
    initialLikeCount: post.counts.like,
    initiallyLiked: post.viewer?.liked ?? false,
  })
  const amplify = useAmplify({ postId: post.id })
  const [quoting, setQuoting] = useState(false)

  const isReadOnly = variant === 'readOnly'
  // The like count shown is the hook's own optimistic total (SOC-030).
  const actions = buildActions({ ...post.counts, like: reaction.likeCount })

  const canLike = reaction.canReact
  const canAmplify = amplify.canAmplify

  /**
   * The reply/like/repost action-row `onClick`s: the optional-prop, inert-until-
   * wired contract. `share` has no handler — always `undefined`.
   */
  const actionClickHandler = (key: ActionSpec['key']): (() => void) | undefined => {
    if (key === 'reply') return onReply ? () => onReply(post.id) : undefined
    if (key === 'like') return canLike ? reaction.toggleLike : undefined
    if (key === 'repost') return canAmplify ? () => { amplify.doRepost() } : undefined
    return undefined
  }

  const handleQuoteSubmit = (commentary: string) => {
    amplify.doQuote(commentary)
    setQuoting(false)
  }

  return (
    <>
      <div className={styles.actions} data-testid="post-actions">
        {actions.map(action => {
          const isLiked = action.key === 'like' && canLike && reaction.likedByViewer
          const activeClass = `${styles.actionButton} ${styles.actionButtonActive}`
          const buttonClass = isLiked ? activeClass : styles.actionButton
          const pressed = action.key === 'like' && canLike ? reaction.likedByViewer : undefined
          const label = isLiked
            ? `${action.label}, ${action.count}, liked`
            : `${action.label}, ${action.count}`

          return (
            <Fragment key={action.key}>
              {isReadOnly ? (
                <span className={styles.actionInert} data-action={action.key}>
                  <FontAwesomeIcon
                    icon={action.icon}
                    aria-hidden="true"
                    className={styles.actionIcon}
                  />
                  <span className={styles.actionCount}>{action.count}</span>
                  <span className={styles.srOnly}>{action.label}</span>
                </span>
              ) : (
                <button
                  type="button"
                  className={buttonClass}
                  data-action={action.key}
                  aria-label={label}
                  aria-pressed={pressed}
                  onClick={actionClickHandler(action.key)}
                >
                  <FontAwesomeIcon
                    icon={action.icon}
                    aria-hidden="true"
                    className={styles.actionIcon}
                  />
                  <span className={styles.actionCount}>{action.count}</span>
                </button>
              )}
              {/* Quote — a SEPARATE control next to Repost (SOC-020), never a
                  `data-action`/canonical-set member (see module header). */}
              {action.key === 'repost' && !isReadOnly && canAmplify && (
                <button
                  type="button"
                  className={styles.quoteTrigger}
                  data-testid="post-quote-trigger"
                  aria-label="Quote"
                  onClick={() => setQuoting(true)}
                >
                  <FontAwesomeIcon
                    icon={faQuoteRight}
                    aria-hidden="true"
                    className={styles.actionIcon}
                  />
                </button>
              )}
            </Fragment>
          )
        })}
      </div>
      {quoting && (
        <div className={styles.quotePanel}>
          <QuoteComposer
            authorName={post.author.displayName}
            onSubmit={handleQuoteSubmit}
            onCancel={() => setQuoting(false)}
          />
        </div>
      )}
    </>
  )
}
