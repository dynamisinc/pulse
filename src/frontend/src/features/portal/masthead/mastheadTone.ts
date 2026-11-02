/**
 * features/portal/masthead/mastheadTone.ts
 * ---------------------------------------------------------------------------
 * The masthead's colour pairs (exercise-portal story 06, #771; NFR-001). The
 * band is the skin's accent fill; its text is F13's derived on-accent colour
 * (black or white, always ≥ 4.5:1). The one pair F13 cannot check is the gold
 * "TODAY" on that band (`ext.portal.todayColor`), so it is guarded here: a value
 * that is not a hex colour, or that falls below 4.5:1 on the accent, gives way
 * to the on-accent colour. A brand can change the gold; it cannot make it illegible.
 *
 * World: participant. Pure functions.
 */

import { AA_BODY, contrastRatio, onColor, type OutletSkinTokens } from '@/features/channels'
import { PORTAL_TODAY_GOLD } from '../skin/portalTokens'

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

/** The colour the "Today" word renders in, on the accent band. */
export function mastheadTodayColor(tokens: OutletSkinTokens): string {
  const band = tokens.palette.accent
  const raw = tokens.ext?.portal?.todayColor
  const candidate = typeof raw === 'string' && HEX.test(raw) ? raw : PORTAL_TODAY_GOLD
  if (contrastRatio(candidate, band) >= AA_BODY) return candidate
  return onColor(band)
}

/** Splits `"Atlanta Today"` into `["Atlanta ", "Today"]`; any other name is all lead. */
export function splitMastheadName(name: string): { readonly lead: string; readonly today: string } {
  const match = /\s(today)$/i.exec(name)
  if (!match || match.index === 0 || match[1] === undefined) return { lead: name, today: '' }
  return { lead: name.slice(0, match.index + 1), today: match[1] }
}
