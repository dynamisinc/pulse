/**
 * Story 13 AC "A11y floor enforced": WCAG 2.1 contrast maths, the shipped
 * palettes pass, and a violating pair is clamped to the neutral fallback.
 */

import { describe, expect, it } from 'vitest'
import {
  AA_BODY,
  CONTRAST_PAIRS,
  applyContrastFloor,
  contrastRatio,
  onColor,
  relativeLuminance,
} from './contrast'
import type { OutletSkinPalette } from './schema'
import { NEUTRAL_SKIN_TOKENS } from './tokens/neutral'
import { WIRE_ROOM_STUB_TOKENS } from './tokens/wire-room'
import { WEATHER_DESK_STUB_TOKENS } from './tokens/weather-desk'

const NEUTRAL = NEUTRAL_SKIN_TOKENS.palette

function passesAll(palette: OutletSkinPalette): boolean {
  return CONTRAST_PAIRS.every(p => contrastRatio(palette[p.fg], palette[p.bg]) >= p.min)
}

describe('contrast maths', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contrastRatio('#fff', '#fff')).toBeCloseTo(1, 5)
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })

  it('treats an unparseable colour as failing', () => {
    expect(contrastRatio('red', '#ffffff')).toBe(0)
  })

  it('picks an on-colour that is always at least AA body', () => {
    for (const color of ['#ffd400', '#e6007e', '#c8102e', '#0f2749', '#777777', '#808080', '#9a3412']) {
      expect(contrastRatio(onColor(color), color)).toBeGreaterThanOrEqual(AA_BODY)
    }
  })
})

describe('applyContrastFloor', () => {
  it.each([
    ['neutral', NEUTRAL],
    ['wire-room stub', WIRE_ROOM_STUB_TOKENS.palette],
    ['weather-desk stub', WEATHER_DESK_STUB_TOKENS.palette],
  ])('the shipped %s palette passes every pair untouched', (_name, palette) => {
    expect(passesAll(palette)).toBe(true)
    expect(applyContrastFloor(palette, NEUTRAL)).toEqual({ palette, violations: [] })
  })

  it('clamps a failing foreground to the neutral one and reports it', () => {
    const loud = { ...NEUTRAL, text: '#ffd400' } // yellow body text on white: ~1.4:1
    const result = applyContrastFloor(loud, NEUTRAL)
    expect(result.palette.text).toBe(NEUTRAL.text)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]).toMatch(/^text #ffd400 on bg #ffffff/)
    expect(passesAll(result.palette)).toBe(true)
  })

  it('clamps the background too when the neutral foreground still fails on it', () => {
    const dark = { ...NEUTRAL, bg: '#111111', text: '#222222' }
    const result = applyContrastFloor(dark, NEUTRAL)
    expect(passesAll(result.palette)).toBe(true)
    expect(result.violations.length).toBeGreaterThan(0)
  })

  it('keeps a loud but legible tabloid palette (black on yellow)', () => {
    const scoop = { ...NEUTRAL, bg: '#ffd400', surface: '#ffffff', text: '#000000', link: '#000000',
      accent: '#e6007e', breaking: '#e6007e' }
    const result = applyContrastFloor(scoop, NEUTRAL)
    expect(result.violations).toEqual([])
    expect(result.palette).toEqual(scoop)
  })

  it('falls back to the whole neutral palette when a clamp cannot settle', () => {
    const bad = { ...NEUTRAL, bg: '#000000', text: '#ffffff', link: '#000080' }
    const result = applyContrastFloor(bad, NEUTRAL)
    expect(passesAll(result.palette)).toBe(true)
  })
})
