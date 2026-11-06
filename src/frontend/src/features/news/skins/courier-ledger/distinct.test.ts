/**
 * News story 11 AC "Distinct from the portal and from Newsline 7" (NWS-002 credibility
 * diversity). The comparison is over the MASTHEAD SIGNATURE: what decides how the
 * masthead reads before a word of it is read. That is its typeface family, its
 * structure (nameplate / bar / strip / flag / band) and whether it sits on a fill.
 * A palette swap alone would leave the signature equal and fail here.
 *
 * Two sources are compared:
 *  - every OTHER token file found on disk: sibling news skins
 *    (`features/news/skins/<key>/tokens.ts`) and the portal
 *    (`features/portal/skin/portalTokens.ts`),
 *    collected with `import.meta.glob`, so each one is checked as soon as it lands;
 *  - the D3-P3 reference signatures of the other registers, so the assertion is never
 *    vacuous while a sibling story is still unmerged.
 */

import { describe, expect, it } from 'vitest'
import type { OutletSkinTokens } from '@/features/channels'
import { tokens } from './tokens'

interface MastheadSignature {
  readonly family: string
  readonly structure: string
  readonly filled: boolean
}

/** The first family in a stack, unquoted and lower-cased. */
function leadFamily(stack: string): string {
  return (stack.split(',')[0] ?? '').trim().replace(/^['"]|['"]$/g, '').toLowerCase()
}

/** A token file's masthead signature. No `ext.news.masthead` means the portal's band. */
function signature(t: OutletSkinTokens): MastheadSignature {
  const news = t.ext?.news
  const structure = typeof news?.masthead === 'string' ? news.masthead : 'band'
  const filled = structure === 'band' || structure === 'tv-bar' || typeof news?.mastheadFill === 'string'
  return { family: leadFamily(t.type.mastheadFamily), structure, filled }
}

/** D3-P3 / D2-002 reference signatures of the other registers. */
const REFERENCE: Readonly<Record<string, MastheadSignature>> = {
  // Metro Desk 9 (skinKey newsline7, story 10): Oswald on a navy TV bar with a LIVE chip.
  newsline7: { family: 'oswald', structure: 'tv-bar', filled: true },
  // The portal (exercise-portal 06): Libre Franklin on a station-blue band.
  portal: { family: 'libre franklin variable', structure: 'band', filled: true },
}

function tokenExports(modules: Record<string, unknown>): Record<string, OutletSkinTokens> {
  const out: Record<string, OutletSkinTokens> = {}
  for (const [path, mod] of Object.entries(modules)) {
    const m = mod as Record<string, unknown>
    const found = (m.tokens ?? m.portalTokens) as OutletSkinTokens | undefined
    if (found) out[path] = found
  }
  return out
}

const siblings = tokenExports({
  ...import.meta.glob('../*/tokens.ts', { eager: true }),
  ...import.meta.glob('../../../portal/skin/portalTokens.ts', { eager: true }),
})
delete siblings['./tokens.ts']
delete siblings['../courier-ledger/tokens.ts']

const own = signature(tokens)

describe('the Courier-Ledger masthead is structurally its own', () => {
  it('is a serif centred nameplate over a double rule, on no fill', () => {
    expect(own).toEqual({ family: 'newsreader', structure: 'centered-nameplate', filled: false })
    expect(tokens.ext?.news?.mastheadDoubleRule).toBe(true)
  })

  it.each(Object.entries(REFERENCE))('differs from the %s reference in family AND structure', (_k, ref) => {
    expect(own.family).not.toBe(ref.family)
    expect(own.structure).not.toBe(ref.structure)
    expect(own.filled).not.toBe(ref.filled)
  })

  it('differs in family and structure from every other token file on disk', () => {
    for (const [path, other] of Object.entries(siblings)) {
      const theirs = signature(other)
      expect(theirs.family, path).not.toBe(own.family)
      expect(theirs.structure, path).not.toBe(own.structure)
    }
  })

  it('ignores the palette, so a palette swap can never pass for a distinct masthead', () => {
    const repainted: OutletSkinTokens = { ...tokens, palette: { ...tokens.palette, accent: '#0b3d91' } }
    expect(signature(repainted)).toEqual(own)
  })
})
