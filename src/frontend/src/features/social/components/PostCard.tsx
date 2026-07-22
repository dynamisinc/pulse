/**
 * features/social/components/PostCard.tsx
 * ---------------------------------------------------------------------------
 * The keystone Social (E2) component (feature: posts, story 02 — "Post
 * rendering & author identity"; SOC-002, D1-003, R-001, R-002, R-004). This
 * is the MOST-REUSED component in the Social surface: feeds, threads,
 * profiles, search results, and amplification views all render posts through
 * this one card (see `docs/features/posts/implementation.md`'s reuse map).
 *
 * Pure presentational: `<PostCard>` takes a `PostView` as a prop and renders
 * it. It does NOT fetch data, does NOT compose provenance/telemetry (story
 * 03's job), and does NOT know where its data came from. `PostView` is a
 * PARTICIPANT-SAFE view type — it carries no origin/provenance field, so
 * nothing here can leak one (XC-002); a feed/thread assembles this shape from
 * the richer internal post model and hands it down.
 *
 * Anatomy (D1 brief + AC): avatar | name + (VerifiedMark if verified) +
 * handle + "·" + relative scenario time, then post text, then optional
 * media/link preview, then the action row. NO platform-added editorial
 * badges ("OFFICIAL"/"BREAKING") are ever rendered here (SOC-002) — the
 * platform's only credibility signal is the verified mark's presence or
 * absence (SOC-052/D1-008); a lookalike unverified persona renders a
 * complete, plausible card with simply no mark and no substitute label.
 *
 * Action-row order is the canonical **reply · repost · like (· share)**
 * (R-002) — the staff console mirrors this same order. In `variant
 * === 'readOnly'` (COR-015/D1-011, observer sessions) the interactive
 * controls are ABSENT — not disabled — and the counts render as inert text.
 *
 * Scenario time (COR-053): the relative "2h ago" string and the absolute
 * tooltip both render via `useScenarioTime()` from `@/core/clock`, bound to
 * `useExerciseContext().timeZone`. Never wall-clock.
 *
 * Content security (NFR-004): `post.text` renders as a plain React text
 * child — never `dangerouslySetInnerHTML` — so a stored script-like string
 * renders inert/escaped by construction.
 *
 * Keyboard/a11y (NFR-001): the header/text/media region (NOT the avatar, NOT
 * the action row) is the `onOpen` activation target — `role="button"` +
 * `tabIndex={0}` + Enter/Space, so opening a post never nests one
 * interactive element inside another (the action row's real `<button>`s are
 * SIBLINGS of this region, not descendants of it).
 *
 * Reply-to-thread (SOC-011/threads-replies story 02): the reply action in
 * the action row accepts an OPTIONAL `onReply` prop; when a caller supplies
 * it, clicking (or keyboard-activating) the reply button also opens the
 * thread focused on this post — same affordance as tapping the card body,
 * just reachable from the reply count too. With no `onReply` supplied the
 * reply button renders exactly as before (an inert-until-wired `<button>`),
 * so no existing consumer's behavior changes. `readOnly` counts stay fully
 * inert — `onReply` is never wired to them.
 *
 * WAVE-S3.1 INTEGRATION (orchestrator-owned — see reactions/01 +
 * amplification/01 implementation.md "integration seam"): like and
 * repost/quote follow the EXACT same optional-prop, inert-until-wired
 * contract `onReply` established above, so every existing consumer (that
 * doesn't pass the new props) renders byte-identical to before:
 *  - `onLike`/`likedByViewer` (SOC-030) wire the `like` action-row entry. The
 *    viewer's own state pairs a color change with a font-weight change on the
 *    count AND an "…, liked" accessible-name suffix — never color-only
 *    (NFR-001). The caller (a `useReaction()` consumer) owns the state; this
 *    component only renders it.
 *  - `onRepost`/`onQuote` (SOC-020) wire the `repost` action-row entry
 *    (direct repost) plus a SEPARATE, small "Quote" trigger rendered next to
 *    it. Quote is deliberately NOT folded into the `repost` action's own
 *    `data-action`/count — it carries no `data-action` at all, so the
 *    reply/repost/like(/share) canonical set (R-002) and every existing
 *    `button[data-action]` assertion are unaffected whether or not `onQuote`
 *    is supplied. The caller owns what "quote" DOES (e.g. opening a
 *    commentary composer) — this component only surfaces the tap.
 *  - `onHashtagOpen` (hashtags-trending/01, SOC-040) fires with the
 *    normalized tag when a linkified hashtag anchor is activated. Omitted ⇒
 *    hashtags stay inert links (stop propagation to the card's `onOpen`, do
 *    nothing else) — the exact pre-Wave-2 behavior.
 *
 * World: participant (Pulse skin). No COBRA, no themed MUI — plain semantic
 * elements + the scoped `social.module.css` CSS Module (tokens read from CSS
 * custom properties; see that file's header for the theming model).
 */

import { Fragment, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faComment,
  faRetweet,
  faHeart,
  faArrowUpFromBracket,
  faQuoteRight,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { Persona } from '@/features/personas'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { Avatar } from './Avatar'
import { VerifiedMark } from './VerifiedMark'
import { parseHashtags } from '../utils/hashtags'
import styles from '../theme/social.module.css'

/** A single media attachment. No URL yet (that lands with real media
 * storage) — `alt` alone is enough to render an accessible placeholder. */
export interface PostMediaView {
  kind: 'image'
  alt: string
}

/** An in-sim link preview card (full URL resolution is story 04's job). */
export interface PostLinkPreviewView {
  title: string
  domain: string
  imageLabel?: string
}

/** Engagement counts, canonical order reply · repost · like (· share). */
export interface PostCounts {
  reply: number
  repost: number
  like: number
  share?: number
}

/**
 * The participant-safe post view `<PostCard>` renders. Deliberately narrow:
 * it carries no provenance/origin field (that is staff-only, story 03/R-003)
 * and no editorial-badge field (SOC-002) — there is nothing here for either
 * to leak from.
 */
export interface PostView {
  id: string
  author: Persona
  text: string
  media?: PostMediaView[]
  linkPreview?: PostLinkPreviewView
  counts: PostCounts
  /** Scenario-time ISO instant this post was published (COR-053). */
  scenarioTime: string
}

export interface PostCardProps {
  post: PostView
  /** `'readOnly'` = observer session (COR-015): controls absent, counts inert. */
  variant?: 'full' | 'readOnly'
  /** Fires when the card body (header/text/media — not the action row) is activated. */
  onOpen?: (id: string) => void
  /**
   * Fires with the post id when the reply action is activated (click or
   * keyboard). Optional — omit it and the reply button behaves exactly as
   * before (no-op). Never wired when `variant === 'readOnly'` (counts stay
   * inert there).
   */
  onReply?: (id: string) => void
  /**
   * Whether the VIEWER has liked this post (SOC-030) — the caller's
   * `useReaction()` state, not fetched/derived here. Ignored when `onLike`
   * is omitted (no active-state rendering without a wired control).
   */
  likedByViewer?: boolean
  /**
   * Fires with the post id when the like action is activated (click or
   * keyboard). Optional — omit it and the like button behaves like an
   * unwired `onReply` (no-op, no active-state styling). Never wired when
   * `variant === 'readOnly'`.
   */
  onLike?: (id: string) => void
  /**
   * Fires with the post id when the repost action is activated (SOC-020).
   * Optional — omit it (with `onQuote` also omitted) and the repost button
   * behaves exactly as before (no-op).
   */
  onRepost?: (id: string) => void
  /**
   * Fires with the post id when the SEPARATE "Quote" trigger next to Repost
   * is activated (SOC-020) — the caller owns what happens next (e.g.
   * opening a commentary composer); this component only renders the
   * trigger, and only when a handler is supplied.
   */
  onQuote?: (id: string) => void
  /**
   * Fires with the normalized tag (no leading `#`) when a linkified hashtag
   * in the post text is activated (SOC-040). Optional — omit it and
   * hashtags stay inert links (stop propagation to `onOpen`, no navigation).
   */
  onHashtagOpen?: (tag: string) => void
}

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

const OPEN_KEYS = new Set(['Enter', ' ', 'Spacebar'])

/**
 * Hashtag link color — the per-exercise accent (COR-030) read from the same
 * `--pc-accent` custom property the card root declares (see
 * `social.module.css`), with the shared Cadence-navy default. Set inline (not a
 * new CSS-module class) so the linkify stays a self-contained edit to the text
 * block. Accent color + the leading `#` glyph + `role="link"` together mark a
 * hashtag as a link WITHOUT relying on color alone (NFR-001).
 */
const HASHTAG_STYLE = { color: 'var(--pc-accent)' } as const

/**
 * A hashtag tap/keyboard-activation must NOT also open the post's thread (the
 * card body's `onOpen`), so it ALWAYS stops propagation to the enclosing
 * openable region — regardless of whether `onHashtagOpen` is wired, so an
 * unwired hashtag stays inert exactly as before Wave S3.1.
 */
function handleHashtagClick(
  tag: string,
  onHashtagOpen: ((tag: string) => void) | undefined,
) {
  return (event: MouseEvent<HTMLAnchorElement>) => {
    event.stopPropagation()
    onHashtagOpen?.(tag)
  }
}

/**
 * Same stop-propagation guarantee as {@link handleHashtagClick}, on Enter/
 * Space. `preventDefault` is only called when a handler actually fires (never
 * when `onHashtagOpen` is omitted), so an unwired hashtag's keyboard behavior
 * is unchanged from before Wave S3.1.
 */
function handleHashtagKeyDown(
  tag: string,
  onHashtagOpen: ((tag: string) => void) | undefined,
) {
  return (event: KeyboardEvent<HTMLAnchorElement>) => {
    if (!OPEN_KEYS.has(event.key)) return
    event.stopPropagation()
    if (!onHashtagOpen) return
    event.preventDefault()
    onHashtagOpen(tag)
  }
}

/**
 * Renders post text with hashtags linkified (SOC-040). Plain text segments
 * render as React text children (never `dangerouslySetInnerHTML`, so a
 * script-like string stays inert — NFR-004); hashtags render as accent-styled,
 * keyboard-focusable `role="link"` anchors carrying the normalized tag in
 * `data-hashtag`, and — when `onHashtagOpen` is supplied (the Wave-2 channel
 * wiring) — fire it with that tag on activation.
 */
function renderPostText(
  text: string,
  onHashtagOpen: ((tag: string) => void) | undefined,
): ReactNode {
  return parseHashtags(text).map((token, index) => {
    if (token.type === 'text') return token.value
    return (
      <a
        key={`hashtag-${index}`}
        role="link"
        tabIndex={0}
        data-hashtag={token.tag}
        style={HASHTAG_STYLE}
        onClick={handleHashtagClick(token.tag, onHashtagOpen)}
        onKeyDown={handleHashtagKeyDown(token.tag, onHashtagOpen)}
      >
        {token.raw}
      </a>
    )
  })
}

export function PostCard({
  post,
  variant = 'full',
  onOpen,
  onReply,
  likedByViewer,
  onLike,
  onRepost,
  onQuote,
  onHashtagOpen,
}: PostCardProps) {
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)

  const relativeTime = format(post.scenarioTime, { format: 'relative' })
  const absoluteTime = format(post.scenarioTime, { format: 'absolute' })

  const isReadOnly = variant === 'readOnly'
  const actions = buildActions(post.counts)

  const handleOpen = () => {
    onOpen?.(post.id)
  }

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (!onOpen) return
    event.preventDefault()
    handleOpen()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!onOpen) return
    if (OPEN_KEYS.has(event.key)) {
      event.preventDefault()
      handleOpen()
    }
  }

  /**
   * The reply/like/repost action-row `onClick`s, generalized from the
   * original reply-only ternary to the same optional-prop, inert-until-wired
   * contract for all three (see the Wave-S3.1 module-header note). `share`
   * has no wired handler yet — always `undefined`, unchanged from before.
   */
  const actionClickHandler = (key: ActionSpec['key']): (() => void) | undefined => {
    if (key === 'reply') return onReply ? () => onReply(post.id) : undefined
    if (key === 'like') return onLike ? () => onLike(post.id) : undefined
    if (key === 'repost') return onRepost ? () => onRepost(post.id) : undefined
    return undefined
  }

  const handleQuoteTrigger = () => {
    onQuote?.(post.id)
  }

  return (
    <article className={styles.postCard} data-testid="post-card" data-post-id={post.id}>
      <div className={styles.avatarWrap}>
        <Avatar persona={post.author} />
      </div>
      <div className={styles.content}>
        <div
          className={styles.openable}
          data-testid="post-open-target"
          role={onOpen ? 'button' : undefined}
          tabIndex={onOpen ? 0 : undefined}
          aria-label={onOpen ? `Open post by ${post.author.displayName}` : undefined}
          onClick={onOpen ? handleClick : undefined}
          onKeyDown={onOpen ? handleKeyDown : undefined}
        >
          <header className={styles.header}>
            <span className={styles.name}>{post.author.displayName}</span>
            {post.author.verified && (
              <span className={styles.verifiedMark}>
                <VerifiedMark />
              </span>
            )}
            <span className={styles.handle}>{`@${post.author.handle}`}</span>
            <span className={styles.dot} aria-hidden="true">·</span>
            <time className={styles.time} dateTime={post.scenarioTime} title={absoluteTime}>
              {relativeTime}
            </time>
          </header>

          <p className={styles.text}>{renderPostText(post.text, onHashtagOpen)}</p>

          {post.media && post.media.length > 0 && (
            <div className={styles.media} data-testid="post-media">
              {post.media.map((item, index) => (
                <div
                  key={`${post.id}-media-${index}`}
                  className={styles.mediaPlaceholder}
                  role="img"
                  aria-label={item.alt}
                >
                  {item.alt}
                </div>
              ))}
            </div>
          )}

          {post.linkPreview && (
            <div className={styles.linkCard} data-testid="post-link-preview">
              <div className={styles.linkCardImage} aria-hidden="true">
                {post.linkPreview.imageLabel}
              </div>
              <div className={styles.linkCardBody}>
                <p className={styles.linkTitle}>{post.linkPreview.title}</p>
                <p className={styles.linkDomain}>{post.linkPreview.domain}</p>
              </div>
            </div>
          )}
        </div>

        <div className={styles.actions} data-testid="post-actions">
          {actions.map(action => {
            const isLiked =
              action.key === 'like' && onLike !== undefined && likedByViewer === true
            const activeClass = `${styles.actionButton} ${styles.actionButtonActive}`
            const buttonClass = isLiked ? activeClass : styles.actionButton
            const pressed = action.key === 'like' && onLike ? likedByViewer === true : undefined
            const label = isLiked
              ? `${action.label}, ${action.count}, liked`
              : `${action.label}, ${action.count}`

            return (
              <Fragment key={action.key}>
                {isReadOnly ? (
                  <span
                    className={styles.actionInert}
                    data-action={action.key}
                  >
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
                {action.key === 'repost' && !isReadOnly && onQuote && (
                  <button
                    type="button"
                    className={styles.quoteTrigger}
                    data-testid="post-quote-trigger"
                    aria-label="Quote"
                    onClick={handleQuoteTrigger}
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
      </div>
    </article>
  )
}
