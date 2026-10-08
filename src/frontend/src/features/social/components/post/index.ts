/**
 * features/social/components/post — barrel for the decomposed `<PostCard>`
 * (demo-polish F0). `components/PostCard.tsx` re-exports this so existing
 * `@/features/social` imports are unchanged; Wave-2 builders import the part they
 * own by its own path (`./PostMediaSlot`, …) rather than through here.
 */

export { PostCard } from './PostCard'
export { PostHeader } from './PostHeader'
export type { PostHeaderProps } from './PostHeader'
export { PostBody } from './PostBody'
export type { PostBodyProps } from './PostBody'
export { PostMediaSlot } from './PostMediaSlot'
export type { PostMediaSlotProps } from './PostMediaSlot'
export { PostLinkCard } from './PostLinkCard'
export type { PostLinkCardProps } from './PostLinkCard'
export { PostActions } from './PostActions'
export type { PostActionsProps } from './PostActions'
export { PostReplyContext } from './PostReplyContext'
export type { PostReplyContextProps } from './PostReplyContext'
export type {
  PostCardProps,
  PostCardVariant,
  PostCounts,
  PostLinkPreviewView,
  PostMediaView,
  PostView,
} from './types'
