/**
 * features/social/components/Composer.contrast.test.ts
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 H-3 / M-6 + the composer focus cue. The composer's colours are CSS
 * custom properties, so the contrast has to be COMPUTED from the stylesheet text that
 * ships, not asserted from a number typed in a comment:
 *
 *  - H-3: the near-limit counter (`--pc-low`) paints the 11px count NUMBER (text, needs
 *    4.5:1 on white) and the ring STROKE (a graphic, needs 3:1 on white and against the
 *    ring track `--pc-line`). The old `#b26a00` was 4.24:1 on white.
 *  - the over-limit number (`--pc-over`, 11px bold) and the muted count (`--pc-ink-muted`)
 *    are measured the same way, so the whole counter is pinned, not just the one fix.
 *  - M-6: the REQUIRED alt-text field's border must be a >= 3:1 control edge
 *    (WCAG 1.4.11): the shared `--pc-control-line` (`#7b8993`), not the 1.23:1 divider
 *    `--pc-line`. The token is declared once in `theme/social.module.css` (mirrored in
 *    `tokens.ts`) and the composer root and the explore search field read the same value.
 *  - the text area draws no outline (`outline: none`), so the composer root must carry a
 *    visible `:focus-within` cue whose colour is the accent (>= 3:1 via `accessibleAccent`).
 *
 * The CSS is read off disk (`readSrcFile`): Vitest blanks every `*.css` import.
 */
import { describe, expect, it } from 'vitest'
import { contrastRatio } from '@/test/contrast'
import { readSrcFile } from '@/test/readSource'
import { LIGHT_PALETTE } from '../theme/tokens'

const composerCss = readSrcFile('features/social/components/Composer.module.css')
const mediaCss = readSrcFile('features/social/components/ComposerMedia.module.css')
const tokensCss = readSrcFile('features/social/theme/social.module.css')
const searchCss = readSrcFile('features/social/explore/SearchBox.module.css')

const WHITE = '#ffffff'
const PANEL = '#f3f5f6'

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** A custom property's declared `#rrggbb` value in a sheet (comments stripped). */
function tokenValue(css: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(stripComments(css))
  if (match?.[1] === undefined) throw new Error(`token ${name} not declared as #rrggbb`)
  return match[1]
}

/** The body of the first rule whose selector is exactly `selector`. */
function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\:]/g, '\\$&')
  const match = new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^{}]*)\\}`).exec(stripComments(css))
  if (match?.[1] === undefined) throw new Error(`rule ${selector} not found`)
  return match[1]
}

describe('Composer counter contrast (H-3)', () => {
  const low = tokenValue(composerCss, '--pc-low')
  const over = tokenValue(composerCss, '--pc-over')
  const muted = tokenValue(composerCss, '--pc-ink-muted')
  const track = tokenValue(composerCss, '--pc-line')

  it('the near-limit count TEXT (--pc-low, 11px) is >= 4.5:1 on white', () => {
    expect(low.toLowerCase()).toBe('#a35f00')
    expect(contrastRatio(low, WHITE)).toBeGreaterThanOrEqual(4.5)
  })

  it('the near-limit ring STROKE is >= 3:1 on white AND against the ring track', () => {
    expect(contrastRatio(low, WHITE)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(low, track)).toBeGreaterThanOrEqual(3)
  })

  it('the over-limit and muted counts are >= 4.5:1 on white too', () => {
    expect(contrastRatio(over, WHITE)).toBeGreaterThanOrEqual(4.5)
    expect(contrastRatio(muted, WHITE)).toBeGreaterThanOrEqual(4.5)
  })

  it('the old #b26a00 really was under AA (the computation can fail)', () => {
    expect(contrastRatio('#b26a00', WHITE)).toBeLessThan(4.5)
  })

  it('the near-limit count and ring use --pc-low, so the fix covers both', () => {
    expect(ruleBody(composerCss, '.countLow')).toMatch(/color\s*:\s*var\(--pc-low\)/)
    expect(ruleBody(composerCss, '.ringProgressLow')).toMatch(/stroke\s*:\s*var\(--pc-low\)/)
  })
})

describe('the required alt-text field border (M-6, WCAG 1.4.11)', () => {
  it('reads the shared control-line token, not the 1.23:1 divider', () => {
    const border = ruleBody(mediaCss, '.altInput')
    expect(border).toMatch(/border\s*:\s*1px solid var\(--pc-control-line\)/)
    expect(border).not.toMatch(/var\(--pc-line\)/)
  })

  it('the token is one value everywhere and >= 3:1 on white and on the panel', () => {
    const shared = tokenValue(tokensCss, '--pc-control-line')
    expect(tokenValue(composerCss, '--pc-control-line')).toBe(shared)
    expect(shared.toLowerCase()).toBe(LIGHT_PALETTE.controlLine.toLowerCase())
    expect(contrastRatio(shared, WHITE)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(shared, PANEL)).toBeGreaterThanOrEqual(3)
    // The divider it replaces fails by a wide margin.
    expect(contrastRatio(tokenValue(tokensCss, '--pc-line'), WHITE)).toBeLessThan(1.5)
  })

  it('the explore search field reads the same shared token (one source of truth)', () => {
    expect(stripComments(searchCss)).toMatch(/--ex-control-line\s*:\s*var\(--pc-control-line\)/)
  })
})

describe('the composer focus cue', () => {
  it('the text area draws no outline, so the composer root shows an accent cue on :focus-within', () => {
    expect(ruleBody(composerCss, '.input:focus-visible')).toMatch(/outline\s*:\s*none/)
    const cue = ruleBody(composerCss, '.composer:focus-within')
    expect(cue).toMatch(/box-shadow\s*:\s*inset\s+0\s+-[23]px\s+0\s+var\(--pc-accent\)/)
  })
})
