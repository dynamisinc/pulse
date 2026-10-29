/**
 * features/channels/primitives/media/contentMediaModel.ts
 * ---------------------------------------------------------------------------
 * Pure helpers behind `ContentMedia` (channels-foundation 14): the alt-text rule, the
 * wire-to-player mapping and the document link's file name. No React, no DOM.
 */

import type { PlayerMedia } from '@/core/media/player'
import type { ContentMediaDto } from '../../contract'

/** Non-empty placeholders for a missing `alt` (NFR-001: never an empty `alt`). */
export const MISSING_ALT_TEXT: Readonly<Record<ContentMediaDto['kind'], string>> = {
  image: 'Image',
  video: 'Video',
  document: 'Document',
}

/**
 * The media's accessible text. The contract makes `alt` required, but a malformed item
 * must still never yield an empty `alt`: it falls back to a neutral placeholder and
 * warns in dev, so an author sees the gap before a screen-reader user does.
 */
export function contentMediaAlt(media: Pick<ContentMediaDto, 'id' | 'kind' | 'alt'>): string {
  if (typeof media.alt === 'string' && media.alt.trim() !== '') return media.alt
  if (import.meta.env.DEV && !warnedMissingAlt.has(media.id)) {
    warnedMissingAlt.add(media.id)
    console.warn(`ContentMedia: media ${media.id} (${media.kind}) has no alt text`)
  }
  return MISSING_ALT_TEXT[media.kind] ?? MISSING_ALT_TEXT.image
}

/** Media ids already warned about, so a re-render does not repeat the warning. */
const warnedMissingAlt = new Set<string>()

/** Maps an image / video DTO to the shared player's shape (nulls become absent). */
export function toPlayerMedia(media: ContentMediaDto, alt: string): PlayerMedia {
  return {
    kind: media.kind === 'video' ? 'video' : 'image',
    url: media.url,
    alt,
    posterUrl: media.posterUrl ?? undefined,
    width: media.width ?? undefined,
    height: media.height ?? undefined,
    durationSec: media.durationSec ?? undefined,
  }
}

/**
 * The file name a `document` link shows and downloads as. The contract carries no file
 * name field, so it is the URL's last path segment when that looks like a file
 * (`advisory-3.pdf`), else the alt text with an extension from the content type.
 */
export function documentFileName(media: Pick<ContentMediaDto, 'url' | 'alt' | 'contentType'>): string {
  const segment = lastPathSegment(media.url)
  if (segment !== undefined && /\.[a-z0-9]{2,5}$/i.test(segment)) return segment
  const base = media.alt.trim() !== '' ? media.alt.trim() : 'document'
  const extension = media.contentType === 'application/pdf' ? '.pdf' : ''
  return base.toLowerCase().endsWith(extension) ? base : `${base}${extension}`
}

/** A short type label for the link ("PDF"), or '' when unknown. */
export function documentTypeLabel(contentType: string): string {
  if (contentType === 'application/pdf') return 'PDF'
  return ''
}

function lastPathSegment(url: string): string | undefined {
  const path = url.split(/[?#]/, 1)[0] ?? ''
  const segment = path.split('/').pop()
  if (segment === undefined || segment === '') return undefined
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}
