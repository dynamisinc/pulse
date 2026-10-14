/**
 * features/controller/liveWorld/liveWorldStyles.test.ts
 * ---------------------------------------------------------------------------
 * WCAG 2.1 AA contrast for the Live world column's tokens (NFR-001), COMPUTED
 * from the very values the components use (`test/contrast.ts`), so a retuned token
 * can't silently drop below AA: metadata text on every surface it sits on, the
 * title-bar text on the navy bar, and the non-text indicators (panel border,
 * error icon) against the surfaces they sit on. Also pins the staff provenance of
 * the tokens (sourced from the staff shell / COBRA, not a participant skin).
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/test/contrast'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { liveWorldTokens, monoMeta, srOnly } from './liveWorldStyles'

const NORMAL_TEXT = 4.5
const NON_TEXT = 3

describe('liveWorldTokens contrast (AA)', () => {
  it('metadata text clears 4.5:1 on the row, hover and toolbar surfaces', () => {
    for (const surface of [
      liveWorldTokens.surface,
      liveWorldTokens.surfaceHover,
      liveWorldTokens.toolbar,
    ]) {
      expect(contrastRatio(liveWorldTokens.meta, surface)).toBeGreaterThanOrEqual(NORMAL_TEXT)
    }
    expect(monoMeta.color).toBe(liveWorldTokens.meta)
  })

  it('primary ink and the focus/verified navy clear 4.5:1 on every surface', () => {
    for (const surface of [
      liveWorldTokens.surface,
      liveWorldTokens.surfaceHover,
      liveWorldTokens.toolbar,
    ]) {
      expect(contrastRatio(liveWorldTokens.ink, surface)).toBeGreaterThanOrEqual(NORMAL_TEXT)
      expect(contrastRatio(liveWorldTokens.focus, surface)).toBeGreaterThanOrEqual(NORMAL_TEXT)
    }
  })

  it('title-bar text and muted text clear 4.5:1 on the navy bar', () => {
    expect(contrastRatio(liveWorldTokens.barText, liveWorldTokens.barBackground))
      .toBeGreaterThanOrEqual(NORMAL_TEXT)
    expect(contrastRatio(liveWorldTokens.barTextMuted, liveWorldTokens.barBackground))
      .toBeGreaterThanOrEqual(NORMAL_TEXT)
  })

  it('non-text indicators (panel border, focus ring, error icon) clear 3:1', () => {
    expect(contrastRatio(liveWorldTokens.panelBorder, liveWorldTokens.surface))
      .toBeGreaterThanOrEqual(NON_TEXT)
    expect(contrastRatio(liveWorldTokens.focus, liveWorldTokens.surface))
      .toBeGreaterThanOrEqual(NON_TEXT)
    expect(contrastRatio(liveWorldTokens.danger, liveWorldTokens.surface))
      .toBeGreaterThanOrEqual(NON_TEXT)
    expect(contrastRatio(liveWorldTokens.danger, liveWorldTokens.toolbar))
      .toBeGreaterThanOrEqual(NON_TEXT)
  })
})

describe('liveWorldTokens provenance (staff world)', () => {
  it('takes its chrome from the staff shell tokens: navy bar, mono stack, COBRA border', () => {
    expect(liveWorldTokens.barBackground).toBe(staffShellTokens.header.background)
    expect(liveWorldTokens.mono).toBe(staffShellTokens.classificationTag.fontFamily)
    expect(liveWorldTokens.panelBorder).toBe(staffShellTokens.toolstrip.borderColor)
    expect(liveWorldTokens.danger).toBe(staffShellTokens.accent.cadenceRed)
  })

  it('is a monospaced metadata stack', () => {
    expect(liveWorldTokens.mono).toMatch(/monospace/)
  })
})

describe('srOnly', () => {
  it('uses pixel STRINGS: under MUI sx a bare 1 means 100% and margin -1 means -8px', () => {
    expect(srOnly.width).toBe('1px')
    expect(srOnly.height).toBe('1px')
    expect(srOnly.margin).toBe('-1px')
    for (const value of [srOnly.width, srOnly.height, srOnly.margin]) {
      expect(typeof value).toBe('string')
    }
  })

  it('is absolutely positioned, clipped and non-wrapping (visually hidden, still readable)', () => {
    expect(srOnly.position).toBe('absolute')
    expect(srOnly.overflow).toBe('hidden')
    expect(srOnly.clip).toBe('rect(0 0 0 0)')
    expect(srOnly.whiteSpace).toBe('nowrap')
  })
})
