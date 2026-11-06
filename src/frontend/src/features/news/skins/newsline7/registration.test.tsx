/**
 * news story 10: the `newsline7` registration. The token file and fonts reach
 * F13's registry, the faces are same-origin woff2, and they load only when a
 * scope for this skin mounts (never at import, never for another skin).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import {
  SkinScope,
  getSkinTokens,
  registerSkinExtension,
  registerSkinTokens,
} from '@/features/channels'
import { getSkinFonts, resetSkinRegistryForTests } from '@/features/channels/skin/registry'
import { fontFaceProblem, resetSkinFontsForTests } from '@/features/channels/skin/fonts'
import { resetSkinReportsForTests } from '@/features/channels/skin/report'
import { NEWS_SKIN_EXTENSION } from '../newsExtension'
import '..'
import { NEWSLINE7_SKIN_KEY, fonts, tokens } from '.'

describe('newsline7 registration', () => {
  beforeEach(() => {
    resetSkinReportsForTests()
    resetSkinFontsForTests()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('registers the token file and its fonts under its key when the news skins import', () => {
    expect(getSkinTokens('newsline7')).toEqual(tokens)
    expect(getSkinFonts('newsline7')).toEqual(fonts)
  })

  it('declares Oswald and Source Sans 3 as same-origin woff2 files', () => {
    expect(new Set(fonts.map(f => f.family))).toEqual(new Set(['Oswald', 'Source Sans 3']))
    for (const face of fonts) {
      expect(fontFaceProblem(face)).toBeNull()
      expect(face.src).toMatch(/\.woff2$/)
      expect(face.src).not.toMatch(/^(data|blob|https?):/)
    }
  })

  it('loads its faces only when a newsline7 scope mounts', () => {
    // Start from a clean registry (dropping the import-time registration) and re-register,
    // so this test does not depend on the order or side effects of the ones above.
    resetSkinRegistryForTests()
    registerSkinExtension('news', NEWS_SKIN_EXTENSION)
    registerSkinTokens(NEWSLINE7_SKIN_KEY, tokens, { fonts })

    const added: string[] = []
    class FakeFontFace {
      readonly family: string
      constructor(family: string) { this.family = family }
      load(): Promise<this> { return Promise.resolve(this) }
    }
    vi.stubGlobal('FontFace', FakeFontFace)
    const original = Object.getOwnPropertyDescriptor(document, 'fonts')
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { add: (f: FakeFontFace) => added.push(f.family), delete: vi.fn() },
    })
    try {
      render(<SkinScope scopeId="other" tokens={tokens} skinKey="wire-room"><p>other</p></SkinScope>)
      expect(added).toEqual([])

      render(
        <SkinScope scopeId="nl7" tokens={tokens} skinKey={NEWSLINE7_SKIN_KEY}><p>nl7</p></SkinScope>,
      )
      expect([...added].sort()).toEqual(['Oswald', 'Source Sans 3', 'Source Sans 3'])
    } finally {
      if (original) Object.defineProperty(document, 'fonts', original)
      else Reflect.deleteProperty(document, 'fonts')
    }
  })
})
