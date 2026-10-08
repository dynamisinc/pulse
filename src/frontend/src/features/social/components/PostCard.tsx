/**
 * features/social/components/PostCard.tsx
 * ---------------------------------------------------------------------------
 * Re-export shim (demo-polish F0). The keystone `<PostCard>` was decomposed into
 * `components/post/{PostCard,PostHeader,PostBody,PostMediaSlot,PostLinkCard,
 * PostActions,PostReplyContext}.tsx` (+ `types.ts`, per-part CSS Modules); this
 * file keeps every `./PostCard` and `@/features/social` import working unchanged.
 * See `components/post/PostCard.tsx` for the anatomy and the full contract.
 */

export { PostCard } from './post'
export type {
  PostCardProps,
  PostCounts,
  PostLinkPreviewView,
  PostMediaView,
  PostView,
} from './post'
