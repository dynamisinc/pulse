/**
 * features/social/components/NewPostsPill.stickyOffset.test.ts
 * ---------------------------------------------------------------------------
 * The sticky "N new posts" pill must clear BOTH shell-published insets: the
 * compliance chrome (`--pulse-chrome-top`) and an active alert bar
 * (`--pulse-alert-height`, 0px when there is no alert), or the sticky alert covers
 * it (demo-polish F5, from F1's Gate-1 fold). Each var keeps a `0px` fallback, so
 * the pill still works in a tree where the shell does not publish them.
 *
 * Static: jsdom applies no stylesheet, so the CSS text is read off disk
 * (`src/test/readSource.ts`; Vitest blanks `*.css` imports).
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

describe('NewPostsPill — sticky offset', () => {
  const css = readSrcFile('features/social/components/NewPostsPill.module.css')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  it('sticks below the chrome AND the active alert bar, plus 8px', () => {
    expect(css.length).toBeGreaterThan(0)
    const chrome = String.raw`var\(--pulse-chrome-top,\s*0px\)`
    const alert = String.raw`var\(--pulse-alert-height,\s*0px\)`
    expect(css).toMatch(
      new RegExp(String.raw`top:\s*calc\(\s*${chrome}\s*\+\s*${alert}\s*\+\s*8px\s*\)`),
    )
    expect(css).toMatch(/position:\s*sticky/)
  })
})
