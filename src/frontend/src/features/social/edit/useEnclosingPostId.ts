/**
 * features/social/edit/useEnclosingPostId.ts
 * ---------------------------------------------------------------------------
 * Resolves WHICH post a card part belongs to (demo-feedback story 20). `PostHeader` and
 * `PostBody` are rendered by `PostCard` with no post id (`PostCard.tsx` belongs to story 21 and
 * is not touched here), so they find it the way the card already publishes it: the nearest
 * ancestor `<article data-post-id>`. An explicit `postId` prop (used by tests and by a future
 * `PostCard` wiring) wins. Returns a CALLBACK ref to attach to any element the part renders:
 * the id is read once when that element mounts (a callback ref, so no effect and no extra
 * render pass beyond the one state set). `null` until resolved / when there is no card.
 */

import { useCallback, useState } from 'react'

export interface EnclosingPostId {
  /** The resolved post id, or `null` (no card around the part). */
  readonly postId: string | null
  /** Attach to an element rendered by the part. */
  readonly anchorRef: (node: HTMLElement | null) => void
}

export function useEnclosingPostId(explicit?: string): EnclosingPostId {
  const [found, setFound] = useState<string | null>(null)
  const anchorRef = useCallback((node: HTMLElement | null) => {
    if (node === null) return
    const id = node.closest<HTMLElement>('[data-post-id]')?.dataset.postId ?? null
    setFound(id)
  }, [])
  return { postId: explicit ?? found, anchorRef }
}
