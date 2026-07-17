/**
 * features/social — public barrel (Pulse "Social" participant surface).
 *
 * Grows incrementally as each Posts-feature story lands (composition,
 * rendering, provenance, link previews, soft-delete, post-as-org, ...). This
 * story (03, provenance & telemetry) adds ONLY the `Post` model + its service
 * seam — deliberately minimal so sibling stories building components/hooks
 * in this same feature folder can extend this barrel without merge conflicts
 * on unrelated exports.
 *
 * Two-worlds note: participant world (Pulse Social skin). This barrel itself
 * has no UI/theming concerns — it re-exports pure model/service code.
 */

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
