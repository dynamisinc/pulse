/**
 * features/social/components/media/mediaPhone.css.test.ts
 * ---------------------------------------------------------------------------
 * Source-level guards for the phone media rules (mobile-tablet story 04; NFR-001).
 * jsdom does no layout and Vitest blanks CSS imports, so the stylesheets are read
 * off disk (like MediaViewer.inset.test.ts); the real measurements live in
 * e2e/media-viewer.phone.spec.ts.
 *
 * Locks in: on a COARSE pointer the video Mute/Expand and the composer Remove
 * controls become real 44px boxes (not an overflowing ::before/::after hit-slop, the
 * #584 lesson); the viewer respects the safe-area insets; mouse sizes are unchanged.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '')
const viewer = strip(readSrcFile('features/social/components/media/MediaViewer.module.css'))
const video = strip(readSrcFile('core/media/player/VideoPlayer.module.css'))
const composer = strip(readSrcFile('features/social/components/ComposerMedia.module.css'))

/** The body of the first `@media (pointer: coarse) { ... }` block. */
function coarseBlock(css: string): string {
  const start = css.indexOf('@media (pointer: coarse)')
  expect(start, 'no coarse-pointer block').toBeGreaterThanOrEqual(0)
  return css.slice(start, css.indexOf('\n}\n', start) + 3)
}

describe('phone media CSS', () => {
  it('video Mute / Expand are 44px on a coarse pointer, 34px otherwise', () => {
    expect(/\.control\s*\{[^}]*width:\s*34px/.exec(video)).not.toBeNull()
    const block = coarseBlock(video)
    expect(block).toMatch(/\.control\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/)
    // Declared before .playToggle (52px) so the larger centre button keeps winning.
    expect(video.indexOf('@media (pointer: coarse)')).toBeLessThan(video.indexOf('.playToggle {'))
  })

  it('composer Remove is 44px on a coarse pointer and the body reserves room', () => {
    const block = coarseBlock(composer)
    expect(block).toMatch(/\.remove\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px/)
    expect(block).toMatch(/\.attachBody\s*\{[^}]*padding-right:\s*44px/)
  })

  it('no media control uses an out-of-container hit-slop pseudo-element', () => {
    for (const css of [viewer, video, composer]) {
      expect(css).not.toMatch(/\.(control|remove|closeButton|navButton)(:{1,2})(before|after)/)
    }
  })

  it('the viewer pads out the side safe areas and budgets the bottom one', () => {
    const root = /\.viewer\s*\{([^{}]*)\}/.exec(viewer)?.[1] ?? ''
    expect(root).toMatch(/padding-left:\s*env\(safe-area-inset-left/)
    expect(root).toMatch(/padding-right:\s*env\(safe-area-inset-right/)
    expect(viewer).toMatch(/\.toolbar\s*\{[^}]*env\(safe-area-inset-bottom/)
    expect(viewer).toMatch(/\.image\s*\{[^}]*env\(safe-area-inset-bottom/)
  })

  it('the viewer controls are 44px tall everywhere', () => {
    expect(/\.closeButton,\s*\.navButton\s*\{([^}]*)\}/.exec(viewer)?.[1] ?? '')
      .toMatch(/min-width:\s*44px;[^}]*height:\s*44px/)
  })
})
