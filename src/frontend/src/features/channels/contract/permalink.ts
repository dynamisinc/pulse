/**
 * features/channels/contract/permalink.ts
 * ---------------------------------------------------------------------------
 * `contentPermalink()` (FC-8 `contract/`), the client twin of the server's
 * `IContentPermalinks.For`. A permalink is ALWAYS the host-relative path
 * `/{channelId}/{outletSlug}/{contentSlug}` and never carries a scheme or a
 * host (FC-9.3, COR-008, PDF-11), so it resolves against whichever exercise
 * host serves the page. Every segment is validated against FC-1 first, which
 * makes a host, scheme, query or traversal segment impossible in the output.
 *
 * World: both. No React, no MUI.
 */

import { isContentChannelId, isSlug, type ContentChannelId } from './vocabulary'

/**
 * Builds a content permalink. Throws on a non-content channel id or a
 * malformed slug rather than emitting a path that would 404 or escape.
 */
export function contentPermalink(
  channelId: ContentChannelId,
  outletSlug: string,
  contentSlug: string,
): string {
  if (!isContentChannelId(channelId)) {
    throw new Error(`contentPermalink: '${String(channelId)}' is not a content channel id`)
  }
  if (!isSlug(outletSlug)) {
    throw new Error(`contentPermalink: '${outletSlug}' is not a valid outlet slug`)
  }
  if (!isSlug(contentSlug)) {
    throw new Error(`contentPermalink: '${contentSlug}' is not a valid content slug`)
  }
  return `/${channelId}/${outletSlug}/${contentSlug}`
}
