/**
 * features/social/edit/usePostEditHistory.ts
 * ---------------------------------------------------------------------------
 * The React Query read behind both edit-history dialogs (participant and staff): one query per
 * post id (`['post-edits', postId]`), refetched on every open (`staleTime: 0`, a short `gcTime`)
 * because the history grows with each edit. The query client is cleared on sign-out
 * (`endSession`), so no history survives an identity switch. Exercise scoping is the server's:
 * the route answers only for a post in the session's exercise (COR-001).
 */

import { useQuery } from '@tanstack/react-query'
import type { PostEditHistory } from '../types/post'
import { getPostEditHistory } from './editPostService'

export interface UsePostEditHistoryResult {
  readonly history: PostEditHistory | undefined
  readonly isLoading: boolean
  readonly isError: boolean
  readonly refetch: () => void
}

export function usePostEditHistory(postId: string): UsePostEditHistoryResult {
  const query = useQuery({
    queryKey: ['post-edits', postId],
    queryFn: () => getPostEditHistory(postId),
    staleTime: 0,
    gcTime: 30_000,
    retry: false,
  })
  return {
    history: query.data,
    isLoading: query.isPending,
    isError: query.isError,
    refetch: () => {
      void query.refetch()
    },
  }
}

/** How the history labels a version: the top row is Current, edit 0 is Original. */
export function versionLabel(
  editNumber: number,
  newestEditNumber: number,
): 'Current' | 'Original' | null {
  if (editNumber === newestEditNumber) return 'Current'
  if (editNumber === 0) return 'Original'
  return null
}
