/**
 * features/controller/components/PersonaComposer.touch.test.ts
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024): the persona composer's touch contract, read from its stylesheet source (CSS
 * Modules are not evaluated by jsdom, and the composer needs a heavy provider stack to mount).
 * Under `@media (pointer: coarse)` every composer button is >= 44 x 44 as real layout space, the
 * tight button groups are >= 8px apart, and there is no ::before / ::after hit-slop anywhere.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

const css = readSrcFile('features/controller/components/PersonaComposer.module.css')

const coarseBlock = css.slice(css.indexOf('@media (pointer: coarse)'))

describe('PersonaComposer.module.css - touch', () => {
  it('has a (pointer: coarse) block, not a width query, for touch sizing', () => {
    expect(css).toContain('@media (pointer: coarse)')
  })

  it('grows every composer button to min 44 x 44', () => {
    expect(coarseBlock).toMatch(/\.composer button[\s\S]*?min-width:\s*44px/)
    expect(coarseBlock).toMatch(/\.composer button[\s\S]*?min-height:\s*44px/)
  })

  it('spaces the tight button groups at least 8px apart', () => {
    expect(coarseBlock).toMatch(/\.bannerActions[\s\S]*?gap:\s*8px/)
    expect(coarseBlock).toMatch(/\.presets[\s\S]*?gap:\s*8px/)
  })

  it('uses no pseudo-element hit-slop', () => {
    const rules = coarseBlock.replace(/\/\*[\s\S]*?\*\//g, '')
    expect(rules).not.toMatch(/::?(before|after)/)
  })
})
