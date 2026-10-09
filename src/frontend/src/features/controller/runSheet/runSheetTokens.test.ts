/**
 * features/controller/runSheet/runSheetTokens.test.ts
 * ---------------------------------------------------------------------------
 * PINS the contrast of every text / background pair the run sheet draws (demo-polish C3,
 * Gate-1 H-1, H-2, M-5; NFR-001 WCAG 2.1 AA, 1.4.3: 4.5:1 for normal text). The ratios are
 * computed from the real token values, so a palette change that drops a pair below AA fails
 * here instead of shipping. Pure functions - no DOM.
 */
import { describe, expect, it } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { BUTTON_KBD_SX, FIELD_SX, runSheetTokens } from './runSheetTokens'
import { statusChipFor } from './runSheetStatus'
import { contrastRatio as contrast } from './runSheetTestKit'

const WHITE = runSheetTokens.panel
const SELECTED = runSheetTokens.selectedRow
const WORK_AREA = runSheetTokens.workArea
const AA = 4.5

describe('contrast helper', () => {
  it('matches known values', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
    // The old Skipped colour and the old Fire next hint, the two Gate-1 Highs:
    expect(contrast('#848482', '#ffffff')).toBeCloseTo(3.75, 1)
    expect(contrast('#848482', SELECTED)).toBeCloseTo(3.36, 1)
    expect(contrast('#ffffff', WORK_AREA)).toBeCloseTo(1.06, 1)
  })
})

describe('H-2 / M-5: informational text', () => {
  it('muted text is AA on the panel, the selected row and the work area', () => {
    expect(runSheetTokens.mutedText).toBe('#4a4f55')
    expect(contrast(runSheetTokens.mutedText, WHITE)).toBeGreaterThanOrEqual(AA)
    expect(contrast(runSheetTokens.mutedText, SELECTED)).toBeGreaterThanOrEqual(AA)
    expect(contrast(runSheetTokens.mutedText, WORK_AREA)).toBeGreaterThanOrEqual(AA)
    expect(contrast(runSheetTokens.mutedText, WHITE)).toBeGreaterThan(8)
    expect(contrast(runSheetTokens.mutedText, SELECTED)).toBeGreaterThan(7)
  })

  it('COBRA\'s text.secondary is NOT AA at this size, which is why the run sheet overrides it', () => {
    expect(contrast(cobraTheme.palette.text.secondary, WHITE)).toBeLessThan(AA)
  })

  it('the Skipped chip uses the muted text colour and is AA on white and on the selected row', () => {
    const skipped = statusChipFor({ status: 'skipped', skippedFrom: 'pending' })
    expect(skipped.color).toBe('#4a4f55')
    expect(contrast(skipped.color, WHITE)).toBeGreaterThanOrEqual(AA)
    expect(contrast(skipped.color, SELECTED)).toBeGreaterThanOrEqual(AA)
  })

  it('every status chip colour is AA on white and on the selected row', () => {
    const records = [
      { status: 'pending' as const },
      { status: 'fired' as const, firedPostId: 'p' },
      { status: 'skipped' as const, skippedFrom: 'pending' as const },
      { status: 'failed' as const, failure: { kind: 'failed' as const, message: 'x' } },
      { status: 'failed' as const, failure: { kind: 'unconfirmed' as const, message: 'x' } },
      { status: 'pending' as const, inFlight: true },
    ]
    for (const record of records) {
      const { color, label } = statusChipFor(record)
      expect(contrast(color, WHITE), `${label} on white`).toBeGreaterThanOrEqual(AA)
      expect(contrast(color, SELECTED), `${label} on the selected row`).toBeGreaterThanOrEqual(AA)
    }
  })

  it('the failed / unconfirmed / fired detail text is AA on the selected row too', () => {
    for (const color of [
      runSheetTokens.failedText,
      runSheetTokens.unconfirmedText,
      runSheetTokens.firedText,
      runSheetTokens.navy,
      runSheetTokens.bodyText,
    ]) {
      expect(contrast(color, WHITE)).toBeGreaterThanOrEqual(AA)
      expect(contrast(color, SELECTED)).toBeGreaterThanOrEqual(AA)
    }
  })

  it('field helper / error / label overrides use AA colours', () => {
    expect(FIELD_SX['& .MuiFormHelperText-root'].color).toBe(runSheetTokens.mutedText)
    expect(FIELD_SX['& .MuiFormHelperText-root.Mui-error'].color).toBe(runSheetTokens.failedText)
    expect(FIELD_SX['& .MuiInputLabel-root'].color).toBe(runSheetTokens.mutedText)
    expect(FIELD_SX['& .MuiInputLabel-root.Mui-error'].color).toBe(runSheetTokens.failedText)
  })
})

describe('banners', () => {
  it('body text is AA on the warning and error banners', () => {
    expect(contrast(runSheetTokens.warningBanner.text, runSheetTokens.warningBanner.background))
      .toBeGreaterThanOrEqual(AA)
    expect(contrast(runSheetTokens.errorBanner.text, runSheetTokens.errorBanner.background))
      .toBeGreaterThanOrEqual(AA)
  })

  it('the link button in a banner (Dismiss) is AA on the error banner', () => {
    expect(contrast(cobraTheme.palette.linkButton.main ?? '#000000', runSheetTokens.errorBanner.background))
      .toBeGreaterThanOrEqual(AA)
  })
})

describe('H-1: the keycap hint inside a coloured button', () => {
  it('takes the button\'s colours (inherit on transparent), not the grey keycap surface', () => {
    expect(BUTTON_KBD_SX.color).toBe('inherit')
    expect(BUTTON_KBD_SX.bgcolor).toBe('transparent')
    expect(BUTTON_KBD_SX.borderColor).toBe('currentColor')
  })

  it('so its text is the primary button\'s own contrast pair, which is AA', () => {
    const { main, contrastText } = cobraTheme.palette.buttonPrimary
    expect(contrast(contrastText, main)).toBeGreaterThanOrEqual(AA)
    // The bug: white hint text on the #f8f8f8 keycap surface.
    expect(contrast(contrastText, WORK_AREA)).toBeLessThan(1.2)
  })
})
