/**
 * Story 13 AC "External registration (FC-8a)", "Clutter guard" and "Fonts":
 * registration, stub replacement, dev-time errors, the font contract.
 */

import { afterEach, describe, expect, it } from 'vitest'
import {
  getSkinExtension,
  getSkinFonts,
  getSkinTokens,
  isStubSkin,
  registerSkinExtension,
  registerSkinFonts,
  registerSkinTokens,
  resetSkinRegistryForTests,
} from './registry'
import { fontFaceProblem } from './fonts'
import type { OutletSkinTokens, SkinExtNamespace } from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'

const ORIGIN = window.location.origin

function tokensWith(accent: string): OutletSkinTokens {
  return { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, accent } }
}

afterEach(() => {
  resetSkinRegistryForTests()
})

describe('registerSkinTokens', () => {
  it('ships neutral and the two replaceable stubs, nothing else', () => {
    expect(getSkinTokens('neutral')).toBe(NEUTRAL_SKIN_TOKENS)
    expect(getSkinTokens('wire-room')).toBe(WIRE_ROOM_STUB_TOKENS)
    expect(isStubSkin('wire-room')).toBe(true)
    expect(isStubSkin('weather-desk')).toBe(true)
    for (const key of ['newsline7', 'courier-ledger', 'national-wire', 'the-scoop', 'portal']) {
      expect(getSkinTokens(key)).toBeUndefined()
    }
  })

  it('registers a new key', () => {
    const tokens = tokensWith('#0f2749')
    registerSkinTokens('newsline7', tokens)
    expect(getSkinTokens('newsline7')).toBe(tokens)
  })

  it('lets a channel replace a stub once, then treats a different second registration as an error', () => {
    const final = tokensWith('#123456')
    registerSkinTokens('wire-room', final)
    expect(getSkinTokens('wire-room')).toBe(final)
    expect(isStubSkin('wire-room')).toBe(false)
    expect(() => registerSkinTokens('wire-room', tokensWith('#654321'))).toThrow(/already registered/)
  })

  it('makes a second, different registration of any other key a dev-time error', () => {
    registerSkinTokens('newsline7', tokensWith('#0f2749'))
    expect(() => registerSkinTokens('newsline7', tokensWith('#c8102e'))).toThrow(/already registered/)
  })

  it('treats an identical re-registration (a module evaluated twice) as a no-op', () => {
    registerSkinTokens('newsline7', tokensWith('#0f2749'))
    expect(() => registerSkinTokens('newsline7', tokensWith('#0f2749'))).not.toThrow()
  })

  it('never lets the neutral fallback be replaced', () => {
    expect(() => registerSkinTokens('neutral', tokensWith('#000000'))).toThrow(/neutral/)
    expect(getSkinTokens('neutral')).toBe(NEUTRAL_SKIN_TOKENS)
  })

  it('rejects a token file that does not match the schema', () => {
    const bad = { ...NEUTRAL_SKIN_TOKENS, watermark: false } as unknown as OutletSkinTokens
    expect(() => registerSkinTokens('bad-skin', bad)).toThrow(/does not match/)
    expect(getSkinTokens('bad-skin')).toBeUndefined()
  })

  it('rejects an invalid key', () => {
    expect(() => registerSkinTokens('Newsline 7', NEUTRAL_SKIN_TOKENS)).toThrow(/not a valid skin key/)
  })

  it('accepts clutter only under the tabloid key (the same file under any other key is rejected)', () => {
    const tabloid: OutletSkinTokens = {
      ...NEUTRAL_SKIN_TOKENS,
      layout: { rail: true, homeLead: 'clutter' },
      clutter: ['chip-row', 'rotated-flag', 'highlight-mark'],
    }
    expect(() => registerSkinTokens('newsline7', tabloid)).toThrow(/clutter/)
    expect(() => registerSkinTokens('courier-ledger', { ...NEUTRAL_SKIN_TOKENS, clutter: [] })).toThrow(/clutter/)
    expect(() => registerSkinTokens('the-scoop', tabloid)).not.toThrow()
    expect(getSkinTokens('the-scoop')).toBe(tabloid)
  })

  it('rejects the whole registration when its fonts are bad, leaving no half-registered skin', () => {
    const bad = [{ family: 'Oswald', src: 'https://fonts.gstatic.com/o.woff2' }]
    expect(() => registerSkinTokens('newsline7', tokensWith('#0f2749'), { fonts: bad })).toThrow(/fonts/)
    expect(getSkinTokens('newsline7')).toBeUndefined()
  })

  it('does not silently ignore different fonts on an identical re-registration', () => {
    const tokens = tokensWith('#0f2749')
    registerSkinTokens('newsline7', tokens, { fonts: [{ family: 'Oswald', src: '/a.woff2' }] })
    expect(() => registerSkinTokens('newsline7', tokens, { fonts: [{ family: 'Anton', src: '/b.woff2' }] }))
      .toThrow(/already registered/)
  })

  it('registers fonts passed as an option', () => {
    const faces = [{ family: 'Oswald', src: '/assets/oswald-abc.woff2', weight: '200 700' }]
    registerSkinTokens('newsline7', tokensWith('#0f2749'), { fonts: faces })
    expect(getSkinFonts('newsline7')).toEqual(faces)
  })
})

describe('registerSkinFonts (the font contract)', () => {
  it('accepts a same-origin woff2 file, absolute or host-relative', () => {
    expect(fontFaceProblem({ family: 'Oswald', src: '/assets/oswald-abc.woff2' }, ORIGIN)).toBeNull()
    expect(fontFaceProblem({ family: 'Oswald', src: '/src/features/news/fonts/oswald.woff2' }, ORIGIN))
      .toBeNull()
    expect(fontFaceProblem({ family: 'Oswald', src: `${ORIGIN}/assets/o.woff2` }, ORIGIN)).toBeNull()
    const ranged = { family: 'Oswald', src: '/a.woff2', weight: 400, unicodeRange: 'U+0000-00FF, U+0131' }
    expect(fontFaceProblem(ranged, ORIGIN)).toBeNull()
  })

  it.each([
    ['a data: URI', 'data:font/woff2;base64,d09GMgABAAAAA', /data: URI/],
    ['a blob: URI', 'blob:http://localhost/1234', /blob: URI/],
    ['a third-party CDN', 'https://fonts.gstatic.com/s/oswald/v1/oswald.woff2', /this origin/],
    ['a protocol-relative CDN', '//cdn.example.com/oswald.woff2', /this origin/],
    ['a non-woff2 file', '/assets/oswald.ttf', /woff2/],
    ['a src with a quote', '/a".woff2', /quotes/],
    ['a src with whitespace', ' /assets/oswald.woff2', /whitespace/],
  ])('rejects %s', (_name, src, message) => {
    expect(fontFaceProblem({ family: 'Oswald', src }, ORIGIN)).toMatch(message)
    expect(() => registerSkinFonts('newsline7', [{ family: 'Oswald', src }])).toThrow(/fonts rejected/)
    expect(getSkinFonts('newsline7')).toEqual([])
  })

  it('rejects a family name or descriptor that could inject CSS', () => {
    expect(fontFaceProblem({ family: "Oswald'; x", src: '/a.woff2' }, ORIGIN)).toMatch(/family/)
    expect(fontFaceProblem({ family: 'Oswald', src: '/a.woff2', weight: 'bold;' }, ORIGIN)).toMatch(/weight/)
    expect(fontFaceProblem({ family: 'Oswald', src: '/a.woff2', unicodeRange: 'x' }, ORIGIN))
      .toMatch(/unicode-range/)
  })

  it('makes a second, different font registration a dev-time error', () => {
    registerSkinFonts('newsline7', [{ family: 'Oswald', src: '/a.woff2' }])
    expect(() => registerSkinFonts('newsline7', [{ family: 'Anton', src: '/b.woff2' }])).toThrow(/already/)
  })
})

describe('registerSkinExtension', () => {
  it('registers a known namespace once', () => {
    const schema = { keys: { masthead: { type: 'enum', values: ['tv-bar'] } } } as const
    registerSkinExtension('news', schema)
    expect(getSkinExtension('news')).toBe(schema)
    expect(() => registerSkinExtension('news', { keys: {} })).toThrow(/already registered/)
  })

  it('rejects a namespace outside news / press / weather / portal', () => {
    expect(() => registerSkinExtension('social' as SkinExtNamespace, { keys: {} })).toThrow(/namespace/)
  })
})
