/**
 * features/controller/personaEdit/personaEditStyles.test.ts
 * ---------------------------------------------------------------------------
 * NFR-001 (WCAG 2.1 AA): the colours the persona edit dialog uses for secondary
 * text (labels, helper text, the save hint) and for its error copy are COMPUTED
 * against their grounds, not eyeballed. COBRA's own `text.secondary` (#848482) is
 * the reason this file exists — it is below 4.5:1 on white, so the dialog does not
 * use it for text (see `personaEditStyles.ts`).
 */
import { describe, expect, it } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { contrastRatio } from '@/test/contrast'
import { MUTED_TEXT } from './personaEditStyles'

describe('persona edit colours meet AA for normal text (4.5:1)', () => {
  it('the muted text colour on white and on the preview ground (grey.100)', () => {
    expect(contrastRatio(MUTED_TEXT, '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(MUTED_TEXT, '#f5f5f5')).toBeGreaterThanOrEqual(4.5)
  })

  it('the error copy colour on white', () => {
    expect(contrastRatio(cobraTheme.palette.notifications.errorText, '#ffffff'))
      .toBeGreaterThanOrEqual(4.5)
  })

  it('documents the problem it avoids: the theme\'s text.secondary is NOT AA on white', () => {
    expect(contrastRatio(cobraTheme.palette.text.secondary, '#ffffff')).toBeLessThan(4.5)
  })
})
