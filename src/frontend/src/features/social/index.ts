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
