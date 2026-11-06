/**
 * features/news/masthead/mastheadModel.ts
 * ---------------------------------------------------------------------------
 * Pure helpers for the outlet masthead and section nav (story 03): which
 * variant a skin selects, the skin's own live-chip word, and the nav hrefs.
 * No skin key appears anywhere in this folder: a fifth outlet is a token file,
 * never an edit here (NWS-002).
 *
 * World: participant. No React, no MUI.
 */

import type { OutletSkinTokens } from '@/features/channels'
import {
  DEFAULT_NEWS_MASTHEAD,
  NEWS_MASTHEAD_VARIANTS,
  type NewsMastheadVariant,
} from '../skins/newsExtension'

/** The masthead variant the finalized tokens select (`ext.news.masthead`). */
export function mastheadVariant(tokens: OutletSkinTokens): NewsMastheadVariant {
  const value = tokens.ext?.news?.masthead
  return typeof value === 'string' &&
    (NEWS_MASTHEAD_VARIANTS as readonly string[]).includes(value)
    ? (value as NewsMastheadVariant)
    : DEFAULT_NEWS_MASTHEAD
}

/**
 * The skin's own live-chip word (`ext.news.liveChip`), trimmed, or `null` when
 * the skin declares none. The platform never supplies a fallback word.
 */
export function liveChipLabel(tokens: OutletSkinTokens): string | null {
  const value = tokens.ext?.news?.liveChip
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/**
 * The skin's masthead band fill (`ext.news.mastheadFill`, already AA-checked
 * by F13 at 3:1 on bg), or `null` to draw the variant's own band.
 */
export function mastheadFill(tokens: OutletSkinTokens): string | null {
  const value = tokens.ext?.news?.mastheadFill
  return typeof value === 'string' && HEX.test(value) ? value : null
}

/**
 * Whether the nameplate sits over a double rule: always for the centred
 * nameplate, and for any variant whose skin sets `ext.news.mastheadDoubleRule`.
 */
export function mastheadDoubleRule(
  tokens: OutletSkinTokens,
  variant: NewsMastheadVariant,
): boolean {
  return variant === 'centered-nameplate' || tokens.ext?.news?.mastheadDoubleRule === true
}

/** Which nav entry is the current page; `undefined` on an article page. */
export type SectionNavCurrent =
  | { readonly kind: 'home' }
  | { readonly kind: 'section'; readonly category: string }

/** `/news/{outlet}`: the outlet home (story 15). */
export function newsHomePath(outletSlug: string): string {
  return `/news/${encodeURIComponent(outletSlug)}`
}

/**
 * `/news/{outlet}/section/{category}`: a section page (story 16). The category
 * is the outlet's own display name, URL-encoded as one segment; story 16
 * decodes the `:category` param and matches it against `outlet.categories`.
 */
export function newsSectionPath(outletSlug: string, category: string): string {
  return `${newsHomePath(outletSlug)}/section/${encodeURIComponent(category)}`
}
