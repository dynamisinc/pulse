/**
 * features/social — public barrel.
 *
 * The Pulse "Social" (D1) participant surface. Story 02 ("Post rendering &
 * author identity") lands the keystone `<PostCard>` plus its two cross-surface
 * primitives, `<VerifiedMark>` (the fixed seal-blue verified seal, R-001) and
 * `<Avatar>` (the R-004 interim duotone-silhouette/monogram treatment).
 * Consumers (feeds, threads, profiles, search, amplification views, and later
 * stories in this feature) import from `@/features/social`.
 *
 * World: participant (Pulse skin) — never COBRA, never themed MUI.
 */

export { PostCard } from './components/PostCard'
export type { PostCardProps, PostView, PostMediaView, PostLinkPreviewView, PostCounts } from './components/PostCard'

export { VerifiedMark } from './components/VerifiedMark'
export type { VerifiedMarkProps } from './components/VerifiedMark'

export { Avatar } from './components/Avatar'
export type { AvatarProps, AvatarPersona } from './components/Avatar'
