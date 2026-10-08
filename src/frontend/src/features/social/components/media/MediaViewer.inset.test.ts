/**
 * features/social/components/media/MediaViewer.inset.test.ts
 * ---------------------------------------------------------------------------
 * The lightbox is `position: fixed` and portalled to <body>, and the shell's alert bar
 * is `position: fixed` too (PRT-010). With only `--pulse-chrome-top` as its top inset the
 * viewer's own header and close button would start UNDER an active alert. Its top must
 * clear BOTH published offsets (Wave 2 Gate-2 low); the stylesheet is read off disk
 * because Vitest blanks CSS imports.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

const css = readSrcFile('features/social/components/media/MediaViewer.module.css')
  .replace(/\/\*[\s\S]*?\*\//g, '')

describe('MediaViewer top inset', () => {
  it('clears the compliance banner AND the alert bar', () => {
    const viewer = /\.viewer\s*\{([^{}]*)\}/.exec(css)?.[1] ?? ''
    const chrome = String.raw`var\(--pulse-chrome-top,\s*0px\)`
    const alert = String.raw`var\(--pulse-alert-height,\s*0px\)`
    expect(viewer).toMatch(new RegExp(String.raw`top\s*:\s*calc\(\s*${chrome}\s*\+\s*${alert}\s*\)`))
  })
})
