/**
 * features/news/body/bodyModel.ts
 * ---------------------------------------------------------------------------
 * Pure helpers for the article body (news-network 06). No UI.
 */

import type { ContentMediaDto } from '@/features/channels'

/** Whether the skin asks for a drop cap (`ext.news.dropCap === true`). */
export function skinWantsDropCap(ext: Readonly<Record<string, unknown>> | undefined): boolean {
  const news = ext?.news
  if (typeof news !== 'object' || news === null) return false
  return (news as Record<string, unknown>).dropCap === true
}

/** The inline media for a placeholder id: an image or a video in `media`, else `undefined`. */
export function findInlineMedia(
  media: readonly ContentMediaDto[],
  mediaId: string,
): ContentMediaDto | undefined {
  const found = media.find(item => item.id === mediaId)
  return found !== undefined && (found.kind === 'image' || found.kind === 'video') ? found : undefined
}
