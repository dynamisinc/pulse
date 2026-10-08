/**
 * features/social/services/ownPostStore.ts
 * ---------------------------------------------------------------------------
 * The viewer's OWN just-published posts (demo-polish F4, story 13 "Own post
 * appears instantly"; SOC-001, D1-005, XC-002). Participant world — a pure
 * module-singleton data store, no UI, no COBRA.
 *
 * WHY IT EXISTS. D1-005 says real-time arrivals never insert into the reading
 * stream: they buffer behind the "▲ N new posts" pill. That is right for OTHER
 * people's posts, wrong for your own — after you press Post the post must be at
 * the top of your feed at once, exactly once, with no pill tap. The pill's data
 * path (SignalR `PostReceived` live, the in-tab `postStore` in mock mode) would
 * otherwise deliver the author's own post back to them as an "echo":
 *
 *   - `useComposePost` registers the created post here the moment a publish
 *     succeeds (`add`);
 *   - `<Feed>` merges these views at the top of the list (`useOwnPosts`) and
 *     passes `has` as the stream's `admit` predicate, so an echo that arrives
 *     AFTER registration never reaches the pill, and `discard`s an echo that
 *     arrived BEFORE it (the broadcast can beat the 201 response);
 *   - `<ThreadView>` does not read this store: a reply is appended to the open
 *     thread through `useThread().appendReply`, which de-duplicates by id.
 *
 * WHAT IT HOLDS: `ParticipantPostView`s only (XC-002). The 201 body of
 * `POST /api/posts` is `ParticipantPostDto` for a participant but the
 * `CreatedPostView` union also admits the staff provenance shape, so
 * {@link narrowCreatedPost} REBUILDS the view field by field from the documented
 * participant-safe keys — it never spreads the response — and nothing staff-only
 * (`exerciseId`, `actingHumanId`, `origin`, `injectId`, `createdWallClock`) can
 * reach participant state. The mock path narrows a `Post` through the sole
 * `toParticipantView`.
 *
 * ISOLATION (COR-001): no `exerciseId` anywhere; the entries are the author's own
 * session's posts, in memory, in this tab. They also die with the SESSION:
 * `core/auth/endSession` calls {@link ownPostStore.reset}, so the next sign-in on the
 * same tab never inherits them, and `<Feed>` additionally merges only posts authored
 * by the session's own persona (defence in depth). This module therefore stays a
 * LEAF (type imports + `./narrowMedia` only): `core/auth` imports it.
 *
 * SHAPE. `getAll()` returns a REFERENTIALLY-STABLE snapshot (the array identity
 * only changes on `add`/`resetForTests`), newest-registered first, so a
 * `useSyncExternalStore` read never loops and `<Feed>` can memoize on it. It is
 * bounded ({@link OWN_POST_CAP}); an evicted post simply stops being merged.
 */

import type {
  CreatedPostView,
  ParticipantPostView,
  PostInReplyTo,
  PostLinkPreview,
  PostViewerState,
} from '../types/post'
import { narrowMedia } from './narrowMedia'

/** How many own posts one session keeps (a session posts a handful, never hundreds). */
export const OWN_POST_CAP = 50

function narrowInReplyTo(value: PostInReplyTo): PostInReplyTo {
  return { postId: value.postId, authorHandle: value.authorHandle }
}

function narrowViewer(value: PostViewerState): PostViewerState {
  return { liked: value.liked, reposted: value.reposted }
}

function narrowLinkPreview(value: PostLinkPreview): PostLinkPreview {
  return {
    title: value.title,
    domain: value.domain,
    ...(value.imageLabel != null ? { imageLabel: value.imageLabel } : {}),
    ...(value.imageUrl != null ? { imageUrl: value.imageUrl } : {}),
  }
}

/**
 * Narrows the 201 body of `POST /api/posts` (`CreatedPostView`: the participant
 * shape OR the staff provenance shape) to the ONLY shape participant state may
 * hold. Field by field from the documented participant-safe keys — never a
 * spread — so a staff body's `exerciseId`/`actingHumanId`/`origin`/`injectId`/
 * `createdWallClock` are genuinely ABSENT from the result (XC-002), and a `null`
 * optional member is dropped rather than carried.
 */
export function narrowCreatedPost(created: CreatedPostView): ParticipantPostView {
  return {
    id: created.id,
    authorPersonaId: created.authorPersonaId,
    text: created.text,
    scenarioTime: created.scenarioTime,
    counts: {
      reply: created.counts.reply,
      repost: created.counts.repost,
      like: created.counts.like,
      ...(created.counts.share != null ? { share: created.counts.share } : {}),
    },
    ...(created.media != null ? { media: created.media.map(narrowMedia) } : {}),
    ...(created.inReplyTo != null ? { inReplyTo: narrowInReplyTo(created.inReplyTo) } : {}),
    ...(created.linkPreview != null ? { linkPreview: narrowLinkPreview(created.linkPreview) } : {}),
    ...(created.viewer != null ? { viewer: narrowViewer(created.viewer) } : {}),
  }
}

/** Newest-registered first. Swapped (never mutated) on `add`, so it is a stable snapshot. */
let ownPosts: readonly ParticipantPostView[] = []

const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of [...listeners]) listener()
}

/** The viewer's own posts, newest-registered first. Stable between changes. */
function getAll(): readonly ParticipantPostView[] {
  return ownPosts
}

/** True when `postId` is a post this session published (the stream's `admit` check). */
function has(postId: string): boolean {
  return ownPosts.some(post => post.id === postId)
}

/**
 * Registers a just-published post. Idempotent by id: a second `add` of the same id
 * is a no-op (the 201 and a retried publish can both name it), so subscribers are
 * not woken for nothing and the list never holds a duplicate.
 */
function add(view: ParticipantPostView): void {
  if (has(view.id)) return
  ownPosts = [view, ...ownPosts].slice(0, OWN_POST_CAP)
  notify()
}

/** Registers a change listener (fires after each `add`); returns an unsubscribe. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Forgets every own post and tells subscribers (a mounted feed drops the rows). The
 * sign-out path (`core/auth/endSession`) calls this so a post made in one session is
 * never merged into the next session's feed on the same tab. Listeners stay: they are
 * the mounted components', which unmount themselves.
 */
function reset(): void {
  if (ownPosts.length === 0) return
  ownPosts = []
  notify()
}

/** Test-only: forgets every own post and drops all listeners. */
function resetForTests(): void {
  ownPosts = []
  listeners.clear()
}

/** The module-singleton own-post store. See the module header for the contract. */
export const ownPostStore = {
  getAll,
  has,
  add,
  subscribe,
  reset,
  resetForTests,
}
