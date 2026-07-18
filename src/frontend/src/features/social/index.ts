/**
 * features/social — public barrel (Pulse "Social" participant surface, D1).
 *
 * Grows incrementally as each Posts-feature story lands. Wave S1:
 * - story 02 (rendering & identity): the keystone `<PostCard>` plus the two
 *   cross-surface primitives `<VerifiedMark>` (fixed seal-blue seal, R-001) and
 *   `<Avatar>` (R-004 interim duotone-silhouette/monogram treatment).
 * - story 03 (provenance & telemetry): the `Post` model + `postService` seam.
 *
 * Consumers (feeds, threads, profiles, search, amplification, later stories)
 * import from `@/features/social`.
 *
 * World: participant (Pulse skin) — never COBRA, never themed MUI.
 *
 * Type-note: `PostCounts` (reply/repost/like/share) is the single shared shape
 * for the engagement row; it is exported here from the post model
 * (`types/post`, story 03, the model owner). `<PostCard>`'s participant-safe
 * `PostView` uses a structurally-identical local shape today; the feed story
 * (Wave S2) converges the two when it wires `postService` output into the card.
 */

// --- story 02: rendering & author identity (presentational) ---
export { PostCard } from './components/PostCard'
export type { PostCardProps, PostView, PostMediaView, PostLinkPreviewView } from './components/PostCard'

export { VerifiedMark } from './components/VerifiedMark'
export type { VerifiedMarkProps } from './components/VerifiedMark'

export { Avatar } from './components/Avatar'
export type { AvatarProps, AvatarPersona } from './components/Avatar'

// --- story 03: post model + provenance + telemetry (model/service) ---
export type {
  Post,
  PostOrigin,
  PostMedia,
  PostLinkPreview,
  PostCounts,
  ParticipantPostView,
} from './types/post'

export {
  createPost,
  toParticipantView,
  originConsoleLabel,
  listPosts,
} from './services/postService'
export type { CreatePostInput } from './services/postService'

// --- Wave S2: the first participant surface (feed + composer + threads) ---
// feeds-discovery/01 — the All Posts feed (the default landing surface).
export { Feed } from './pages/Feed'
export type { FeedProps } from './pages/Feed'
export { useFeed } from './hooks/useFeed'
export type { UseFeedResult } from './hooks/useFeed'

// posts/01 — the inline composer.
export { Composer } from './components/Composer'
export type { ComposerProps } from './components/Composer'
export { useComposePost } from './hooks/useComposePost'

// threads-replies/01 — the flattened thread view.
export { ThreadView } from './components/ThreadView'
export type { ThreadViewProps } from './components/ThreadView'
export { useThread } from './hooks/useThread'

// The channel composition mounted as the shell's default participant channel.
export { SocialChannel } from './SocialChannel'
