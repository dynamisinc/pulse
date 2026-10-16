/**
 * touchHitArea.test.ts: the coarse-pointer 44 px hit-area CSS (mobile-tablet 05/17).
 * jsdom cannot hit-test, so this pins the generated CSS contract. The real
 * on-device measurement lives in the Playwright phone specs.
 */
import { describe, expect, it } from 'vitest'
import { TOUCH_TARGET_MIN_PX, touchHitAreaCss } from './touchHitArea'

describe('touchHitAreaCss', () => {
  const css = touchHitAreaCss('.x-hit')

  it('makes the control the containing block for its pseudo-element', () => {
    expect(css).toMatch(/\.x-hit\s*\{\s*position:\s*relative;/)
  })

  it('extends the hit area only on coarse pointers, never for a mouse', () => {
    expect(css).toMatch(/@media \(pointer: coarse\)\s*\{\s*\.x-hit::after/)
    // The ::after rule exists only inside the media query.
    expect(css.indexOf('::after')).toBeGreaterThan(css.indexOf('(pointer: coarse)'))
  })

  it('is at least 44 px square and centred, so the visual box never moves', () => {
    expect(TOUCH_TARGET_MIN_PX).toBe(44)
    expect(css).toContain('width: max(100%, 44px)')
    expect(css).toContain('height: max(100%, 44px)')
    expect(css).toContain('transform: translate(-50%, -50%)')
  })
})
