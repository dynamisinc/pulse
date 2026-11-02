/**
 * Computed contrast of the portal's default tokens (exercise-portal story 06, AC6;
 * NFR-001): ≥ 4.5:1 for text, ≥ 3:1 for UI, on every pair the portal and its masthead
 * draw, and F13's floor leaves the defaults untouched (nothing is silently clamped).
 */
import { describe, expect, it } from 'vitest'
import {
  AA_BODY,
  AA_LARGE,
  contrastRatio,
  finalizeSkinTokens,
  onColor,
  type OutletSkinTokens,
} from '@/features/channels'
import { mastheadTodayColor } from '../masthead/mastheadTone'
import { PORTAL_SKIN_KEY, PORTAL_TODAY_GOLD, portalTokens } from '.'

const p = portalTokens.palette

describe('portal default tokens: computed contrast (AC6)', () => {
  it.each([
    ['text on bg', p.text, p.bg],
    ['text on surface', p.text, p.surface],
    ['link on bg', p.link, p.bg],
    ['link on surface', p.link, p.surface],
    ['masthead text (on-accent) on the station-blue band', onColor(p.accent), p.accent],
    ['the gold "Today" on the station-blue band', PORTAL_TODAY_GOLD, p.accent],
  ])('%s is ≥ 4.5:1', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_BODY)
  })

  it.each([
    ['the band (accent) on bg', p.accent, p.bg],
    ['the band (accent) on surface', p.accent, p.surface],
    ['the red accent rule (breaking) on bg', p.breaking, p.bg],
    ['the red accent rule (breaking) on surface', p.breaking, p.surface],
  ])('%s is ≥ 3:1 (UI)', (_label, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('the F13 floor keeps the defaults as authored (no pair needed clamping)', () => {
    const finalized = finalizeSkinTokens(portalTokens, PORTAL_SKIN_KEY)
    expect(finalized.palette).toEqual(portalTokens.palette)
    expect(finalized.ext?.portal?.todayColor).toBe(PORTAL_TODAY_GOLD)
  })
})

describe('mastheadTodayColor: the gold-on-band AA guard', () => {
  const withBand = (accent: string, todayColor?: unknown): OutletSkinTokens => ({
    ...portalTokens,
    palette: { ...p, accent },
    ext: todayColor === undefined ? {} : { portal: { todayColor: todayColor as string } },
  })

  it('keeps the default gold on the default band', () => {
    expect(mastheadTodayColor(portalTokens)).toBe(PORTAL_TODAY_GOLD)
  })

  it('keeps an override gold that is AA on the band', () => {
    expect(mastheadTodayColor(withBand(p.accent, '#ffd75e'))).toBe('#ffd75e')
  })

  it('falls back to the on-accent colour when the gold is below 4.5:1 on the band', () => {
    const tokens = withBand(p.accent, '#3b5db0')
    expect(contrastRatio('#3b5db0', p.accent)).toBeLessThan(AA_BODY)
    expect(mastheadTodayColor(tokens)).toBe(onColor(p.accent))
  })

  it('falls back to the on-accent colour when a lighter brand band fails the default gold', () => {
    expect(mastheadTodayColor(withBand('#ffe08a'))).toBe(onColor('#ffe08a'))
  })

  it('ignores a non-hex value', () => {
    expect(mastheadTodayColor(withBand(p.accent, 'gold; color: red'))).toBe(PORTAL_TODAY_GOLD)
  })

  it.each(['#0b3d91', '#7a1f1f', '#ffe08a', '#000000', '#ffffff', '#3a7d44'])(
    'is always ≥ 4.5:1 on a %s band',
    accent => {
      const today = mastheadTodayColor(withBand(accent))
      expect(contrastRatio(today, accent)).toBeGreaterThanOrEqual(AA_BODY)
    },
  )
})
