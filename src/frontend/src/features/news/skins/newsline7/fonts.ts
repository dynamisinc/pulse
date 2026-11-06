/**
 * features/news/skins/newsline7/fonts.ts
 * ---------------------------------------------------------------------------
 * The self-hosted faces the `newsline7` stacks name (F13 font contract, F23
 * CSP `font-src 'self'`). Latin-subset variable woff2 from Fontsource, SIL
 * OFL 1.1 (licences beside the files). Registering loads nothing: the faces
 * load, with `font-display: swap`, only when a scope for this skin mounts.
 */

import type { SkinFontFace } from '@/features/channels'
import oswaldUrl from './fonts/oswald-latin-wght-normal.woff2?url'
import sourceSansUrl from './fonts/source-sans-3-latin-wght-normal.woff2?url'
import sourceSansItalicUrl from './fonts/source-sans-3-latin-wght-italic.woff2?url'

/** Fontsource's latin subset range. */
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, ' +
  'U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD'

export const fonts: readonly SkinFontFace[] = [
  { family: 'Oswald', src: oswaldUrl, weight: '200 700', unicodeRange: LATIN },
  { family: 'Source Sans 3', src: sourceSansUrl, weight: '200 900', unicodeRange: LATIN },
  {
    family: 'Source Sans 3',
    src: sourceSansItalicUrl,
    weight: '200 900',
    style: 'italic',
    unicodeRange: LATIN,
  },
]
