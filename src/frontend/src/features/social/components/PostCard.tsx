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
 * World: participant (Pulse skin). No COBRA, no themed MUI — plain semantic
 * elements + the scoped `social.module.css` CSS Module (tokens read from CSS
 * custom properties; see that file's header for the theming model).
 */

import type { KeyboardEvent, MouseEvent } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faComment,
  faRetweet,
  faHeart,
  faArrowUpFromBracket,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { Persona } from '@/features/personas'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { Avatar } from './Avatar'
import { VerifiedMark } from './VerifiedMark'
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

export function PostCard({ post, variant = 'full', onOpen }: PostCardProps) {
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

          <p className={styles.text}>{post.text}</p>

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
          {actions.map(action => (
            isReadOnly ? (
              <span
                key={action.key}
                className={styles.actionInert}
                data-action={action.key}
              >
                <FontAwesomeIcon icon={action.icon} aria-hidden="true" className={styles.actionIcon} />
                <span className={styles.actionCount}>{action.count}</span>
                <span className={styles.srOnly}>{action.label}</span>
              </span>
            ) : (
              <button
                key={action.key}
                type="button"
                className={styles.actionButton}
                data-action={action.key}
                aria-label={`${action.label}, ${action.count}`}
              >
                <FontAwesomeIcon icon={action.icon} aria-hidden="true" className={styles.actionIcon} />
                <span className={styles.actionCount}>{action.count}</span>
              </button>
            )
          ))}
        </div>
      </div>
    </article>
  )
}
