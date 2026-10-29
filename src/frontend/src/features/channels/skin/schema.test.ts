/**
 * Story 13 AC "Schema = the CAN list": the token keys are exactly the D3-P2
 * CAN list; unknown keys (anything on the CANNOT list) are rejected at the
 * type level and by the runtime schema.
 */

import { describe, expect, it } from 'vitest'
import {
  SKIN_TOKEN_KEYS,
  isFontStack,
  outletSkinTokensSchema,
  skinOverridesSchema,
  type OutletSkinOverrides,
  type OutletSkinTokens,
} from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'
import { WEATHER_DESK_STUB_TOKENS } from './tokens/weather-desk'

/** The D3-P2 CANNOT list, spelled as a token author might try. */
const CANNOT_KEYS = [
  'slotOrder', 'anatomy', 'scenarioTime', 'clock', 'embed', 'linkCard', 'watermark',
  'share', 'comments', 'a11y', 'contrast', 'bodySize', 'telemetry',
]

describe('OutletSkinTokens schema', () => {
  it('exposes exactly the CAN list at the top level', () => {
    expect([...SKIN_TOKEN_KEYS].sort()).toEqual([
      'breaking', 'byline', 'clutter', 'dateline', 'density', 'ext', 'layout', 'media',
      'palette', 'schemaVersion', 'type',
    ])
  })

  it.each([
    ['neutral', NEUTRAL_SKIN_TOKENS],
    ['wire-room stub', WIRE_ROOM_STUB_TOKENS],
    ['weather-desk stub', WEATHER_DESK_STUB_TOKENS],
  ])('accepts the shipped %s token file', (_name, tokens) => {
    expect(outletSkinTokensSchema.safeParse(tokens).success).toBe(true)
  })

  it.each(CANNOT_KEYS)('rejects the CANNOT-list key "%s" at the top level', key => {
    const withKey = { ...NEUTRAL_SKIN_TOKENS, [key]: true }
    expect(outletSkinTokensSchema.safeParse(withKey).success).toBe(false)
    expect(skinOverridesSchema.safeParse({ [key]: true }).success).toBe(false)
  })

  it('rejects unknown keys inside a section', () => {
    const tokens = { ...NEUTRAL_SKIN_TOKENS, palette: { ...NEUTRAL_SKIN_TOKENS.palette, seal: '#2d9cdb' } }
    expect(outletSkinTokensSchema.safeParse(tokens).success).toBe(false)
    expect(skinOverridesSchema.safeParse({ layout: { slotOrder: ['hero'] } }).success).toBe(false)
  })

  it('rejects a missing schemaVersion or another version', () => {
    const { schemaVersion: _omit, ...rest } = NEUTRAL_SKIN_TOKENS
    expect(outletSkinTokensSchema.safeParse(rest).success).toBe(false)
    const v2 = { ...NEUTRAL_SKIN_TOKENS, schemaVersion: 2 }
    expect(outletSkinTokensSchema.safeParse(v2).success).toBe(false)
  })

  it('accepts partial overrides and rejects bad values in them', () => {
    expect(skinOverridesSchema.safeParse({ palette: { accent: '#c8102e' } }).success).toBe(true)
    expect(skinOverridesSchema.safeParse({ palette: { accent: 'red' } }).success).toBe(false)
    expect(skinOverridesSchema.safeParse({ layout: { homeLead: 'carousel' } }).success).toBe(false)
  })

  it('takes only flat ext values', () => {
    expect(skinOverridesSchema.safeParse({ ext: { news: { masthead: 'tv-bar', liveChip: true } } }).success)
      .toBe(true)
    const nested = { ext: { news: { masthead: { nested: 1 } } } }
    expect(skinOverridesSchema.safeParse(nested).success).toBe(false)
  })

  it('requires font stacks to end in a generic family and carry no CSS', () => {
    expect(isFontStack("'Oswald', 'Arial Narrow', sans-serif")).toBe(true)
    expect(isFontStack('Newsreader, Georgia, serif')).toBe(true)
    expect(isFontStack("'Oswald'")).toBe(false)
    expect(isFontStack('x; background: url(https://evil.example/f.woff2), serif')).toBe(false)
    expect(isFontStack('')).toBe(false)
    expect(isFontStack('"Foo, serif')).toBe(false)
    expect(isFontStack("'Foo\", serif")).toBe(false)
  })

  it('rejects CANNOT-list keys at the type level', () => {
    // @ts-expect-error -- the watermark slot is not a token (NFR-008)
    const watermark: OutletSkinTokens = { ...NEUTRAL_SKIN_TOKENS, watermark: false }
    // @ts-expect-error -- slot order is fixed (D3-P1)
    const slots: OutletSkinOverrides = { layout: { slotOrder: ['hero'] } }
    // @ts-expect-error -- no comments, ever (NWS-031)
    const comments: OutletSkinOverrides = { comments: true }
    // @ts-expect-error -- the a11y floor is not a token
    const floor: OutletSkinOverrides = { a11y: { minContrast: 2 } }
    expect([watermark, slots, comments, floor]).toHaveLength(4)
  })
})
