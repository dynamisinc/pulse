/**
 * News story 11 (#728): the Courier-Ledger token file. Covers the ACs that live in
 * this folder: the schema, the D3-P3 values, the AA floor (including muted meta
 * text on the off-white page), the fonts (self-hosted, lazy, inside the scope only)
 * and "data only". The rendered four-skin slot-order (04), text-lead home (15) and
 * masthead (03) snapshots belong to those stories and to story 20's skin matrix,
 * which mount every registered skin, this one included.
 */

import { render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AA_BODY,
  AA_LARGE,
  CONTRAST_PAIRS,
  OutletSkinScope,
  contrastRatio,
  finalizeSkinTokens,
  getSkinTokens,
  outletSkinTokensSchema,
} from '@/features/channels'
import { applyContrastFloor } from '@/features/channels/skin/contrast'
import { fontFaceProblem, resetSkinFontsForTests } from '@/features/channels/skin/fonts'
import { getSkinFonts } from '@/features/channels/skin/registry'
import { isFontStack } from '@/features/channels/skin/schema'
import { NEUTRAL_SKIN_TOKENS } from '@/features/channels/skin/tokens/neutral'
// The shared ext.news schema (one registration for every news skin), as the channel imports it.
import '../newsExtension'
import {
  COURIER_LEDGER_META,
  COURIER_LEDGER_SKIN_KEY,
  fonts,
  tokens,
} from './index'

const palette = tokens.palette

/** RGB chroma (max channel minus min channel) in 0..1: 0 is gray, 1 is a pure hue. */
function chroma(hex: string): number {
  const ch = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
  return (Math.max(...ch) - Math.min(...ch)) / 255
}

afterEach(() => {
  vi.unstubAllGlobals()
  resetSkinFontsForTests()
  delete (document as { fonts?: unknown }).fonts
})

describe('token file validates', () => {
  it('is registered under courier-ledger, the key foundation 03 seeds', () => {
    expect(COURIER_LEDGER_SKIN_KEY).toBe('courier-ledger')
    expect(getSkinTokens('courier-ledger')).toBe(tokens)
  })

  it('passes the strict OutletSkinTokens schema at schemaVersion 1 with no clutter', () => {
    expect(outletSkinTokensSchema.safeParse(tokens).success).toBe(true)
    expect(tokens.schemaVersion).toBe(1)
    expect(tokens).not.toHaveProperty('clutter')
    expect(tokens.layout.homeLead).not.toBe('clutter')
  })

  it('names a built-in dateline format (no registration needed, id matches F14)', () => {
    expect(tokens.dateline.format).toMatch(/^[a-z][a-z0-9-]{0,31}$/)
    expect(tokens.dateline.format).toBe('standard')
  })
})

describe('D3-P3 values (the city-paper register)', () => {
  it('sets masthead, hed and body in Newsreader with serif fallbacks', () => {
    for (const stack of [tokens.type.mastheadFamily, tokens.type.hedFamily,
      tokens.type.dekFamily, tokens.type.bodyFamily]) {
      expect(stack.startsWith("'Newsreader',")).toBe(true)
      expect(stack.endsWith(', serif')).toBe(true)
      expect(isFontStack(stack)).toBe(true)
    }
  })

  it('sets kicker and meta in Source Sans 3, with small-caps kickers', () => {
    expect(tokens.type.kickerFamily.startsWith("'Source Sans 3',")).toBe(true)
    expect(tokens.type.kickerFamily.endsWith(', sans-serif')).toBe(true)
    expect(tokens.ext?.news?.kickerCase).toBe('small-caps')
    expect(tokens.type.hedCase).toBe('none')
  })

  it('uses a restrained palette: near-black ink, warm off-white page, hairline rule, muted accent', () => {
    // Near-black: very dark, not pure black.
    expect(contrastRatio(palette.text, '#000000')).toBeLessThan(1.3)
    expect(palette.text).not.toBe('#000000')
    // Warm off-white: light, and red channel above blue (warm), not pure white.
    expect(contrastRatio(palette.bg, '#ffffff')).toBeLessThan(1.1)
    expect(palette.bg).not.toBe('#ffffff')
    const channel = (hex: string, i: number) => parseInt(hex.slice(i, i + 2), 16)
    expect(channel(palette.bg, 1)).toBeGreaterThan(channel(palette.bg, 5))
    // Hairline rule: a light separator and a 1px weight.
    expect(contrastRatio(palette.rule, palette.bg)).toBeLessThan(1.6)
    expect(tokens.density.ruleWeight).toBe(1)
    // Muted accent: dark and low-chroma enough to read as ink, not a brand shout.
    expect(contrastRatio(palette.accent, palette.bg)).toBeGreaterThan(AA_BODY)
    expect(chroma(palette.accent)).toBeLessThan(0.4)
    expect(chroma('#ff0000')).toBeGreaterThan(0.4) // the bound does reject a shout
  })

  it('leads the home with text and keeps the rail', () => {
    expect(tokens.layout).toEqual({ homeLead: 'text-lead', rail: true })
  })

  it('crops lightly and sets captions in italic serif', () => {
    expect(tokens.media.cropAggression).toBe('low')
    expect(tokens.media.captionStyle).toBe('italic-serif')
  })

  it('bylines staff writers and says "News Alert" with an understated rule', () => {
    expect(tokens.byline.format).toBe('By {name}, Staff Writer')
    expect(tokens.breaking).toEqual({ style: 'rule', vocabulary: 'News Alert' })
  })

  it('declares the centred nameplate masthead with a double rule', () => {
    expect(tokens.ext?.news?.masthead).toBe('centered-nameplate')
    expect(tokens.ext?.news?.mastheadDoubleRule).toBe(true)
  })
})

describe('a11y floor', () => {
  it.each(CONTRAST_PAIRS.map(p => [`${p.fg} on ${p.bg}`, p] as const))(
    '%s meets its AA threshold',
    (_label, pair) => {
      expect(contrastRatio(palette[pair.fg], palette[pair.bg])).toBeGreaterThanOrEqual(pair.min)
    },
  )

  it('is not clamped by the floor (no violations)', () => {
    const floor = applyContrastFloor(palette, NEUTRAL_SKIN_TOKENS.palette)
    expect(floor).toEqual({ palette, violations: [] })
  })

  it('keeps muted-gray meta text at AA body size on the off-white page and on surfaces', () => {
    expect(tokens.ext?.news?.metaColor).toBe(COURIER_LEDGER_META)
    expect(contrastRatio(COURIER_LEDGER_META, palette.bg)).toBeGreaterThanOrEqual(AA_BODY)
    expect(contrastRatio(COURIER_LEDGER_META, palette.surface)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('keeps the understated breaking rule and the accent visible as large marks', () => {
    for (const bg of [palette.bg, palette.surface]) {
      expect(contrastRatio(palette.breaking, bg)).toBeGreaterThanOrEqual(AA_LARGE)
      expect(contrastRatio(palette.accent, bg)).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('passes the full mount-time guard unchanged: palette and every ext.news key survive', () => {
    const finalized = finalizeSkinTokens(tokens, COURIER_LEDGER_SKIN_KEY)
    expect(finalized.palette).toEqual(palette)
    // ext.news is checked against the shared schema; metaColor enters its AA check and is kept.
    expect(finalized.ext?.news).toEqual(tokens.ext?.news)
  })
})

describe('fonts', () => {
  it('registers three self-hosted same-origin woff2 faces', () => {
    expect(getSkinFonts(COURIER_LEDGER_SKIN_KEY)).toEqual(fonts)
    expect(fonts.map(f => `${f.family}/${f.style}`)).toEqual([
      'Newsreader/normal', 'Newsreader/italic', 'Source Sans 3/normal',
    ])
    for (const face of fonts) {
      expect(fontFaceProblem(face)).toBeNull()
      expect(face.src).toMatch(/\/courier-ledger\/fonts\/[a-z0-9-]+\.woff2$/)
    }
  })

  it('names in every stack only the families it registers, then system fallbacks', () => {
    const families = new Set(fonts.map(f => f.family))
    expect(families).toEqual(new Set(['Newsreader', 'Source Sans 3']))
    expect(tokens.type.bodyFamily).toContain("'Newsreader'")
    expect(tokens.type.kickerFamily).toContain("'Source Sans 3'")
  })

  it('loads nothing at registration and loads the faces only when its scope mounts', () => {
    const constructed: string[] = []
    class FakeFontFace {
      constructor(family: string, source: string) {
        constructed.push(`${family} ${source}`)
      }
      load() {
        return Promise.resolve(this)
      }
    }
    const add = vi.fn()
    vi.stubGlobal('FontFace', FakeFontFace)
    Object.defineProperty(document, 'fonts', { value: { add }, configurable: true })

    // Another outlet's scope does not fetch this skin's faces.
    const other = { slug: 'other', skinKey: 'neutral', skinOverrides: null }
    const first = render(<OutletSkinScope outlet={other}><span /></OutletSkinScope>)
    expect(add).not.toHaveBeenCalled()
    first.unmount()

    const outlet = { slug: 'courier-ledger', skinKey: COURIER_LEDGER_SKIN_KEY, skinOverrides: null }
    render(<OutletSkinScope outlet={outlet}><span /></OutletSkinScope>)
    expect(add).toHaveBeenCalledTimes(3)
    expect(constructed.every(c => /url\("[^"]+\.woff2"\) format\("woff2"\)$/.test(c))).toBe(true)
  })
})

/** The only imports a data-only skin source may make: F13, its own tokens, its own fonts. */
const ALLOWED_IMPORT = /^(@\/features\/channels|\.\/tokens|\.\/fonts\/[a-z0-9-]+\.woff2\?url)$/

describe('zero layout code', () => {
  it('has sources that import no React, MUI, CSS or layout module', () => {
    const sources = import.meta.glob('./*.ts', { query: '?raw', import: 'default', eager: true })
    const code = Object.entries(sources).filter(([path]) => !path.includes('.test.'))
    expect(code.map(([path]) => path).sort()).toEqual(['./index.ts', './tokens.ts'])
    for (const [path, raw] of code) {
      const imports = [...String(raw).matchAll(/^import .* from '([^']+)'/gm)].map(m => m[1])
      for (const spec of imports) {
        expect(spec, path).toMatch(ALLOWED_IMPORT)
      }
    }
  })

  it('ships only data, its registration, tests, fonts and their licences', () => {
    const files = Object.keys(import.meta.glob('./**/*', { query: '?url', import: 'default' }))
      .map(p => p.replace(/^\.\//, ''))
      .sort()
    // (A glob never lists the importing module itself, so this test file is absent.)
    expect(files).toEqual([
      'distinct.test.ts',
      'fonts/OFL-Newsreader.txt',
      'fonts/OFL-SourceSans3.txt',
      'fonts/newsreader-latin-wght-italic.woff2',
      'fonts/newsreader-latin-wght-normal.woff2',
      'fonts/source-sans-3-latin-wght-normal.woff2',
      'index.ts',
      'tokens.ts',
    ])
  })
})
