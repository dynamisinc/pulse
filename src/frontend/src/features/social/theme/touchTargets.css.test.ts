/**
 * features/social/theme/touchTargets.css.test.ts
 * ---------------------------------------------------------------------------
 * CSS contract for participant touch targets (mobile-tablet story 18; NFR-001).
 * jsdom applies no stylesheets, so the contract is asserted on the real CSS text (read off disk
 * with `readSrcFile`, since Vitest blanks `*.css` imports): each control's >= 44px
 * sizing lives ONLY inside `@media (pointer: coarse)` (a mouse layout is unchanged), reads
 * the shared `--pulse-touch-min` (fallback 44px), and uses
 * real layout space -- never an invisible `::before`/`::after` slop that neighbours could
 * intercept (Copilot, PR #584).
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

const actions = readSrcFile('features/social/components/post/PostActions.module.css')
const composer = readSrcFile('features/social/components/Composer.module.css')
const media = readSrcFile('features/social/components/ComposerMedia.module.css')
const header = readSrcFile('features/social/layout/DetailHeader.module.css')
const profile = readSrcFile('features/social/pages/Profile.module.css')

/** The text of every `@media (pointer: coarse) { ... }` block (brace-balanced). */
function coarseBlocks(css: string): string {
  const out: string[] = []
  let from = 0
  for (;;) {
    const at = css.indexOf('@media (pointer: coarse)', from)
    if (at < 0) break
    const open = css.indexOf('{', at)
    let depth = 0
    let i = open
    for (; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}' && --depth === 0) break
    }
    out.push(css.slice(open + 1, i))
    from = i
  }
  return out.join('\n')
}

const outsideCoarse = (css: string): string => css.replace(coarseBlocks(css), '')

const CASES: Array<[string, string, string]> = [
  ['PostActions .actionButton', actions, '.actionButton'],
  ['Composer .postButton', composer, '.postButton'],
  ['Composer .emojiButton', composer, '.emojiButton'],
  ['ComposerMedia .attachButton', media, '.attachButton'],
  ['DetailHeader .back', header, '.back'],
  ['Profile .statButton', profile, '.statButton'],
]

describe('touch-target CSS contract', () => {
  it.each(CASES)('%s: grows to --pulse-touch-min only on a coarse pointer', (_n, css, sel) => {
    const coarse = coarseBlocks(css)
    expect(coarse).toContain(sel)
    expect(coarse).toContain('var(--pulse-touch-min, 44px)')
  })

  it.each(CASES)('%s: desktop rules never mention the touch minimum', (_n, css) => {
    expect(outsideCoarse(css)).not.toContain('--pulse-touch-min')
  })

  it('uses real layout space, not a pseudo-element hit slop', () => {
    for (const css of [actions, composer, media, header, profile]) {
      expect(coarseBlocks(css)).not.toMatch(/::?(before|after)/)
    }
  })
})
