/**
 * touchTarget.test.ts: the coarse-pointer 44 px touch-target CSS
 * (mobile-tablet 05/17). jsdom cannot lay out or hit-test, so this pins the
 * generated CSS contract; the on-device check is e2e/alert-bar.phone.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import { TOUCH_TARGET_MIN_PX, touchTargetCss } from './touchTarget'

describe('touchTargetCss', () => {
  const css = touchTargetCss('.x-hit')

  it('applies only on coarse pointers, never for a mouse', () => {
    expect(css.trim().startsWith('@media (pointer: coarse)')).toBe(true)
  })

  it('makes the control itself at least 44 px square with centred content', () => {
    expect(TOUCH_TARGET_MIN_PX).toBe(44)
    expect(css).toMatch(/\.x-hit\s*\{[^}]*min-width:\s*44px/)
    expect(css).toMatch(/\.x-hit\s*\{[^}]*min-height:\s*44px/)
    expect(css).toContain('display: inline-flex')
    expect(css).toContain('align-items: center')
  })

  it('uses real layout space, not an overflowing pseudo-element hit-slop', () => {
    expect(css).not.toContain('::after')
  })
})
