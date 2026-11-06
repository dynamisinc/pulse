/**
 * features/news/skins/courier-ledger — the Courier-Ledger skin (news story 11, #728).
 *
 * Importing this module registers the token file and its self-hosted faces with
 * F13 (`registerSkinTokens`). Nothing loads here: the faces are fetched only when
 * a scope for `courier-ledger` mounts (F13 `SkinScope`), with `font-display: swap`.
 *
 * Fonts: Newsreader (roman + italic, variable wght) and Source Sans 3 (roman,
 * variable wght), latin subset, from @fontsource-variable 5.3.x, SIL OFL 1.1 (the
 * licence files sit beside them in `fonts/`). Same-origin `.woff2` files, so the
 * CSP `font-src 'self'` (F23) allows them; no CDN.
 */

import { registerSkinTokens, type SkinFontFace } from '@/features/channels'
import newsreaderUrl from './fonts/newsreader-latin-wght-normal.woff2?url'
import newsreaderItalicUrl from './fonts/newsreader-latin-wght-italic.woff2?url'
import sourceSans3Url from './fonts/source-sans-3-latin-wght-normal.woff2?url'
import { COURIER_LEDGER_SKIN_KEY, tokens } from './tokens'

/** The latin subset the files carry (fontsource's `latin` range). */
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

export const fonts: readonly SkinFontFace[] = [
  { family: 'Newsreader', src: newsreaderUrl, weight: '200 800', style: 'normal', unicodeRange: LATIN },
  {
    family: 'Newsreader',
    src: newsreaderItalicUrl,
    weight: '200 800',
    style: 'italic',
    unicodeRange: LATIN,
  },
  { family: 'Source Sans 3', src: sourceSans3Url, weight: '200 900', style: 'normal', unicodeRange: LATIN },
]

registerSkinTokens(COURIER_LEDGER_SKIN_KEY, tokens, { fonts })

export { COURIER_LEDGER_SKIN_KEY, tokens }
export {
  COURIER_LEDGER_META,
  COURIER_LEDGER_SANS,
  COURIER_LEDGER_SERIF,
} from './tokens'
