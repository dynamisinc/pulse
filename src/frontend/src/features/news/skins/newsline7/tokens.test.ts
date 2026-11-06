/**
 * news story 10: the `newsline7` token file (schema, D3-P3 values, AA floor).
 * A failing pair is fixed by tuning the token, never by exempting it.
 */

import { describe, expect, it } from 'vitest'
import {
  AA_BODY,
  AA_LARGE,
  CONTRAST_PAIRS,
  contrastRatio,
  finalizeSkinTokens,
  onColor,
  outletSkinTokensSchema,
} from '@/features/channels'
import { NEWS_SKIN_EXTENSION } from '../newsExtension'
import { NEWSLINE7_SKIN_KEY, tokens } from './tokens'

const NAVY = '#0f2749'
const RED = '#c8102e'
const WHITE = '#ffffff'

describe('newsline7 token file', () => {
  it('passes the strict OutletSkinTokens schema (v1) with no unknown keys and no clutter', () => {
    expect(outletSkinTokensSchema.safeParse(tokens).success).toBe(true)
    expect(tokens.schemaVersion).toBe(1)
    expect(NEWSLINE7_SKIN_KEY).toBe('newsline7')
    expect('clutter' in tokens).toBe(false)
  })

  it('carries the D3-P3 local-TV values', () => {
    expect(tokens.type.mastheadFamily).toMatch(/^'Oswald'/)
    expect(tokens.type.hedFamily).toMatch(/^'Oswald'/)
    expect(tokens.type.kickerFamily).toMatch(/^'Oswald'/)
    expect(tokens.type.bodyFamily).toMatch(/^'Source Sans 3'/)
    expect(tokens.type.dekFamily).toMatch(/^'Source Sans 3'/)
    expect(tokens.type.hedCase).toBe('uppercase')
    expect(tokens.palette.accent).toBe(RED)
    expect(tokens.palette.breaking).toBe(RED)
    expect(tokens.palette.bg).toBe(WHITE)
    expect(tokens.layout).toEqual({ rail: true, homeLead: 'video-lead' })
    expect(tokens.media.playerTint).toBe(NAVY)
    expect(tokens.breaking).toEqual({ style: 'bar', vocabulary: 'BREAKING NEWS' })
    expect(tokens.ext?.news).toEqual({ masthead: 'tv-bar', mastheadFill: NAVY, liveChip: 'LIVE' })
  })

  it('names no outlet: the displayed name ("Metro Desk 9") is registry data, not a token', () => {
    expect(JSON.stringify(tokens)).not.toMatch(/newsline ?7|metro desk/i)
  })

  it('ends every font stack in a generic family, so a blocked face falls back cleanly', () => {
    const { hedCase: _hedCase, ...stacks } = tokens.type
    for (const stack of Object.values(stacks)) {
      expect(stack.split(',').at(-1)?.trim()).toBe('sans-serif')
    }
  })

  it('uses only ext.news keys the news extension schema declares, with matching types', () => {
    for (const [key, value] of Object.entries(tokens.ext?.news ?? {})) {
      const spec = NEWS_SKIN_EXTENSION.keys[key]
      expect(spec, `ext.news.${key}`).toBeDefined()
      if (spec?.type === 'enum') expect(spec.values).toContain(value)
      if (spec?.type === 'boolean') expect(typeof value).toBe('boolean')
      if (spec?.type === 'string') expect(typeof value).toBe('string')
      if (spec?.type === 'color') expect(value).toMatch(/^#[0-9a-f]{6}$/i)
    }
  })
})

describe('newsline7 a11y floor (NFR-001)', () => {
  it.each(CONTRAST_PAIRS.map(p => [p.fg, p.bg, p.min] as const))(
    '%s on %s meets %s:1',
    (fg, bg, min) => {
      expect(contrastRatio(tokens.palette[fg], tokens.palette[bg])).toBeGreaterThanOrEqual(min)
    },
  )

  it('needs no clamp when finalized (the floor leaves palette and ext untouched)', () => {
    const finalized = finalizeSkinTokens(tokens, NEWSLINE7_SKIN_KEY)
    expect(finalized.palette).toEqual(tokens.palette)
    expect(finalized.ext?.news).toEqual(tokens.ext?.news)
  })

  it('reads white on the red breaking bar at body size', () => {
    expect(onColor(tokens.palette.breaking)).toBe(WHITE)
    expect(contrastRatio(WHITE, tokens.palette.breaking)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('reads red link text on white and on the surface at body size', () => {
    expect(contrastRatio(tokens.palette.link, WHITE)).toBeGreaterThanOrEqual(AA_BODY)
    const { link, surface } = tokens.palette
    expect(contrastRatio(link, surface)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('reads body text on the page and on the surface', () => {
    expect(contrastRatio(tokens.palette.text, tokens.palette.bg)).toBeGreaterThanOrEqual(AA_BODY)
    const { text, surface } = tokens.palette
    expect(contrastRatio(text, surface)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it('reads white on the navy masthead band and player chrome; the band shows on the page', () => {
    for (const fill of [NAVY, tokens.media.playerTint]) {
      expect(onColor(fill)).toBe(WHITE)
      expect(contrastRatio(WHITE, fill)).toBeGreaterThanOrEqual(AA_BODY)
    }
    expect(contrastRatio(NAVY, tokens.palette.bg)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('keeps the LIVE chip a red fill with white text: red text on navy would fail', () => {
    expect(contrastRatio(RED, NAVY)).toBeLessThan(AA_LARGE)
    expect(contrastRatio(WHITE, RED)).toBeGreaterThanOrEqual(AA_BODY)
  })
})
