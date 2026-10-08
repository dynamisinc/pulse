/**
 * features/social/components/post/PostCard.tsx
 * ---------------------------------------------------------------------------
 * The keystone Social (E2) component (feature: posts, story 02 — "Post
 * rendering & author identity"; SOC-002, D1-003, R-001, R-002, R-004), now a thin
 * COMPOSITION of the decomposed parts (demo-polish F0, implementation.md §4.3).
 * FROZEN after F0: Wave-2/3 stories edit the PART they own, never this file —
 * every slot is already mounted here.
 *
 * This is the MOST-REUSED component in the Social surface: feeds, threads,
 * profiles, search results and amplification views all render posts through this
 * one card. `components/PostCard.tsx` re-exports it so every `@/features/social`
 * import is unchanged.
 *
 *   <article .postCard>                                     (PostCard.module.css)
 *     <Avatar/>                                             (../Avatar, self-contained)
 *     <div .content>
 *       <div .openable>                          the stretched-link open region
 *         [<button .openTarget/>]                (only with `onOpen`; WR-001)
 *         <PostHeader/>     name · mark · @handle · "·" · relative scenario time
 *         <PostReplyContext/>   "Replying to @handle" (nothing unless a reply)  [F4]
 *         <PostBody/>       text, hashtags linkified
 *         <PostMediaSlot/>  image grid / video                                  [F2]
 *         <PostLinkCard/>   in-sim link preview                                 [F2]
 *       </div>
 *       <PostActions/>      reply · repost · like (· share) + Quote               [F3]
 *     </div>
 *   </article>
 *
 * Presentational: `<PostCard>` takes a `PostView` as a prop and renders it. It
 * does NOT fetch data, does NOT compose provenance/telemetry (story 03's job), and
 * does NOT know where its data came from. `PostView` is a PARTICIPANT-SAFE view
 * type — it carries no origin/provenance field, so nothing here can leak one
 * (XC-002). The one thing it does require is CONTEXT: `PostActions` self-wires the
 * like/repost/quote hooks (DP-14), so a card must render under an
 * `ExerciseContextProvider` and a `SessionProvider`.
 *
 * Action-row order is the canonical **reply · repost · like (· share)** (R-002).
 * In `variant === 'readOnly'` (COR-015/D1-011, observer sessions) the interactive
 * controls are ABSENT — not disabled — and the counts render as inert text.
 *
 * Scenario time (COR-053): the relative "2h ago" string and the absolute tooltip
 * render in `PostHeader` via `useScenarioTime()`, bound to
 * `useExerciseContext().timeZone`. Never wall-clock.
 *
 * Content security (NFR-004): `post.text` renders as a plain React text child
 * (`PostBody`) — never `dangerouslySetInnerHTML`.
 *
 * Keyboard/a11y (NFR-001): the header/text/media region (NOT the avatar, NOT the
 * action row) is the `onOpen` activation target — but the region itself
 * (`.openable`) is NON-interactive (no role/tabIndex/handlers). Instead, when
 * `onOpen` is supplied, a real `<button data-testid="post-open-target">` renders
 * as a transparent, absolutely-positioned OVERLAY filling that region (the
 * "stretched-link" pattern) — Enter/Space/click are all native button behavior,
 * nothing custom. The linkified hashtag anchors (PostBody) and the author overlay
 * (PostHeader) sit ABOVE it in stacking order so they stay independently
 * clickable/focusable as SIBLINGS of the overlay button, never DESCENDANTS of it —
 * an interactive element nested inside a `role="button"`/`<button>` is invalid
 * ARIA and was a Gate-2 finding (WR-001) this structure fixes. The action row's
 * real `<button>`s remain siblings of this region too.
 *
 * Reply-to-thread (SOC-011): `onReply` is OPTIONAL — a caller that supplies it gets
 * the thread opened from the reply count too; with none the reply button renders as
 * an inert-until-wired `<button>`. `onHashtagOpen` / `onOpenProfile` follow the
 * same optional, inert-until-wired contract (WR-002: never a focusable no-op).
 *
 * World: participant (Pulse skin). No COBRA, no themed MUI — plain semantic
 * elements + the per-part CSS Modules (tokens read from CSS custom properties; see
 * `theme/social.module.css`'s header for the theming model).
 */

import { Avatar } from '../Avatar'
import { PostActions } from './PostActions'
import { PostBody } from './PostBody'
import { PostHeader } from './PostHeader'
import { PostLinkCard } from './PostLinkCard'
import { PostMediaSlot } from './PostMediaSlot'
import { PostReplyContext } from './PostReplyContext'
import type { PostCardProps } from './types'
import styles from './PostCard.module.css'

export function PostCard({
  post,
  variant = 'full',
  onOpen,
  onReply,
  onHashtagOpen,
  onOpenProfile,
}: PostCardProps) {
  // The open-region overlay button (rendered below, WR-001) is only ever mounted
  // when `onOpen` is supplied, so this is called exclusively from that button's
  // native `onClick` — no custom key handling needed, Enter/Space on a real
  // `<button>` are native browser behavior.
  const handleOpen = () => {
    onOpen?.(post.id)
  }

  return (
    <article className={styles.postCard} data-testid="post-card" data-post-id={post.id}>
      <div className={styles.avatarWrap}>
        <Avatar persona={post.author} />
      </div>
      <div className={styles.content}>
        {/*
          The open-region (WR-001, NFR-001): NON-interactive — no role, tabIndex, or
          handlers here, so it can never nest an interactive descendant improperly.
          When `onOpen` is supplied, a real `<button>` overlay (below, absolutely
          positioned, transparent) is the actual open affordance — a sibling of the
          hashtag anchors inside the text, never their ancestor.
        */}
        <div className={styles.openable}>
          {onOpen && (
            <button
              type="button"
              className={styles.openTarget}
              data-testid="post-open-target"
              aria-label={`Open post by ${post.author.displayName}`}
              onClick={handleOpen}
            />
          )}
          <PostHeader
            author={post.author}
            scenarioTime={post.scenarioTime}
            onOpenProfile={onOpenProfile}
          />
          <PostReplyContext inReplyTo={post.inReplyTo} />
          <PostBody text={post.text} onHashtagOpen={onHashtagOpen} />
          <PostMediaSlot postId={post.id} media={post.media} />
          <PostLinkCard linkPreview={post.linkPreview} />
        </div>

        <PostActions post={post} variant={variant} onReply={onReply} />
      </div>
    </article>
  )
}
