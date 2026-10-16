/**
 * features/controller/personaEdit/personaEditStyles.test.ts
 * ---------------------------------------------------------------------------
 * NFR-001 (WCAG 2.1 AA): the colours the persona edit dialog uses for secondary
 * text (labels, helper text, the save hint) and for its error copy are COMPUTED
 * against their grounds, not eyeballed. The muted text is the COBRA token
 * (`palette.text.muted`, demo-feedback 25), not a local grey.
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

  it('the muted text is the COBRA token, not a local grey', () => {
    expect(MUTED_TEXT).toBe(cobraTheme.palette.text.muted)
  })
})
