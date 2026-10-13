/**
 * features/login/pages/JoinPage.styles.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08, AC5 ("a phone at 320 px wide: no horizontal scroll, text at
 * least 16 px, the one button at least 44 px tall") and the WCAG 2.1 AA contrast
 * half of the accessibility cross-cutting AC (NFR-001).
 *
 * jsdom has no layout engine, so a rendered-page test cannot see a font size, a
 * tap-target height or a colour. These facts live in `JoinPage.module.css`, so this
 * guard reads that stylesheet off disk (`readSrcFile`: Vitest blanks every `*.css`
 * import, `?raw` included, so a glob would pass vacuously) and checks the
 * declarations themselves. Contrast is COMPUTED from the colours it just read, with
 * the shared `test/contrast.ts` arithmetic, never a hand-typed ratio.
 *
 * What it pins:
 *   - EVERY `font-size` in the file is at least 16px (px or rem);
 *   - `.action` (the Try again button / sign-in link) is at least 44px tall;
 *   - the card cannot force horizontal scroll at 320px: border-box sizing, width
 *     100%, `min-width: 0`, a max width, no fixed width wider than the viewport,
 *     no `overflow-x`, and long words wrap in the heading and the message;
 *   - text contrast is at least 4.5:1 for every text/background pair (normal text,
 *     1.4.3), and the focus outline and the action's fill reach 3:1 against the
 *     white card (non-text, 1.4.11);
 *   - the spinner stops under `prefers-reduced-motion`;
 *   - the file carries no `@import` and no `url(…)` (no network fetch before
 *     sign-in, no default-MUI or COBRA styling pulled in by a stylesheet).
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { contrastRatio } from '@/test/contrast'

const CSS = readSrcFile('features/login/pages/JoinPage.module.css')

/** The stylesheet minus its comments. */
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  readonly selectors: readonly string[]
  readonly body: string
}

/** Every `selector { declarations }` block, including those nested in an @media. */
const RULES: readonly Rule[] = [...CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selectors: (match[1] ?? '').split(',').map(selector => selector.trim()).filter(Boolean),
  body: match[2] ?? '',
}))

/** The rules that apply to exactly `selector` (it may share a rule with others). */
function rulesFor(selector: string): Rule[] {
  return RULES.filter(rule => rule.selectors.includes(selector))
}

/** The value of `property` in the (last) rule for `selector`, or undefined. */
function declared(selector: string, property: string): string | undefined {
  let value: string | undefined
  for (const rule of rulesFor(selector)) {
    const found = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*([^;]+)`, 'i').exec(rule.body)
    if (found?.[1] !== undefined) value = found[1].trim()
  }
  return value
}

function px(value: string | undefined): number {
  const match = /^(-?[\d.]+)px$/.exec(value ?? '')
  if (match?.[1] === undefined) throw new Error(`expected a px value, got "${value}"`)
  return Number(match[1])
}

/** A colour declared as `#rrggbb`. */
function colour(selector: string, property: string): string {
  const value = declared(selector, property)
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${selector} { ${property} } must be a #rrggbb colour, got "${value}"`)
  }
  return value
}

const CARD_BACKGROUND = colour('.card', 'background')

describe('the stylesheet is read for real (so nothing below passes vacuously)', () => {
  it('finds the page classes', () => {
    for (const selector of ['.page', '.card', '.heading', '.region', '.status', '.alert', '.action']) {
      expect(rulesFor(selector).length, `${selector} rule`).toBeGreaterThan(0)
    }
  })
})

describe('text size and tap target (AC5)', () => {
  it('declares every font-size as at least 16px', () => {
    const sizes = [...CODE.matchAll(/font-size\s*:\s*([^;]+);/g)].map(match => (match[1] ?? '').trim())

    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) {
      const rem = /^([\d.]+)rem$/.exec(size)
      const pixels = rem?.[1] !== undefined ? Number(rem[1]) * 16 : px(size)
      expect(pixels, `font-size: ${size}`).toBeGreaterThanOrEqual(16)
    }
  })

  it('sets the body text of the page and of the live region to 16px or more', () => {
    expect(px(declared('.page', 'font-size'))).toBeGreaterThanOrEqual(16)
    expect(px(declared('.region', 'font-size'))).toBeGreaterThanOrEqual(16)
    expect(px(declared('.brandLabel', 'font-size'))).toBeGreaterThanOrEqual(16)
  })

  it('makes the one action (Try again / Go to sign in) at least 44px tall', () => {
    expect(px(declared('.action', 'min-height'))).toBeGreaterThanOrEqual(44)
  })

  it('makes the action full width, so it is a thumb target as wide as the card', () => {
    expect(declared('.action', 'width')).toBe('100%')
  })
})

describe('no horizontal scroll at 320px (AC5)', () => {
  it('sizes the page and card by border-box and lets the card shrink', () => {
    expect(declared('.page', 'box-sizing')).toBe('border-box')
    expect(declared('.card', 'box-sizing')).toBe('border-box')
    expect(declared('.card', 'width')).toBe('100%')
    expect(declared('.card', 'min-width')).toBe('0')
    expect(px(declared('.card', 'max-width'))).toBeLessThanOrEqual(400)
  })

  it('leaves at least 240px of content width at 320px (page padding + card padding)', () => {
    const pagePadding = px(declared('.page', 'padding'))
    // The card padding that applies at 320px is the one inside the narrow-screen media query.
    const narrowCardPadding = RULES
      .filter(rule => rule.selectors.includes('.card') && /padding/.test(rule.body))
      .map(rule => px(/padding\s*:\s*([^;]+)/.exec(rule.body)?.[1]?.trim()))
      .at(-1) ?? 0

    expect(320 - 2 * pagePadding - 2 * narrowCardPadding).toBeGreaterThanOrEqual(240)
  })

  it('has no fixed width wider than the viewport and no horizontal overflow', () => {
    for (const match of CODE.matchAll(/(?:^|[;\s{])(?:min-)?width\s*:\s*([\d.]+)px/g)) {
      expect(Number(match[1]), `width: ${match[1]}px`).toBeLessThanOrEqual(320)
    }
    expect(CODE).not.toMatch(/overflow-x\s*:\s*(?:scroll|auto)/)
  })

  it('wraps long words (an exercise name) in the heading and the message', () => {
    expect(declared('.heading', 'overflow-wrap')).toBe('anywhere')
    expect(declared('.message', 'overflow-wrap')).toBe('anywhere')
  })
})

describe('contrast, WCAG 2.1 AA (NFR-001)', () => {
  const textPairs: ReadonlyArray<readonly [string, string, string]> = [
    ['the brand row', colour('.brandRow', 'color'), CARD_BACKGROUND],
    ['the heading', colour('.heading', 'color'), CARD_BACKGROUND],
    ['the status region', colour('.status', 'color'), colour('.status', 'background')],
    ['the notice region', colour('.notice', 'color'), colour('.notice', 'background')],
    ['the alert region', colour('.alert', 'color'), colour('.alert', 'background')],
    ['the action', colour('.action', 'color'), colour('.action', 'background')],
    ['the action on hover', colour('.action', 'color'), colour('.action:hover', 'background')],
  ]

  it.each(textPairs)('%s text is at least 4.5:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('draws the focus outlines and the action fill at least 3:1 against the white card', () => {
    const regionOutline = /outline\s*:\s*\d+px solid (#[0-9a-f]{6})/i
      .exec(rulesFor('.region:focus-visible')[0]?.body ?? '')?.[1]
    const actionOutline = /outline\s*:\s*\d+px solid (#[0-9a-f]{6})/i
      .exec(rulesFor('.action:focus-visible')[0]?.body ?? '')?.[1]

    expect(regionOutline).toBeDefined()
    expect(actionOutline).toBeDefined()
    expect(contrastRatio(regionOutline ?? '#ffffff', CARD_BACKGROUND)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(actionOutline ?? '#ffffff', CARD_BACKGROUND)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(colour('.action', 'background'), CARD_BACKGROUND)).toBeGreaterThanOrEqual(3)
  })
})

describe('motion and fetches', () => {
  it('stops the spinner under prefers-reduced-motion', () => {
    const reducedMotionRule = new RegExp(
      '@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)\\s*\\{[^@]*'
      + '\\.spinner\\s*\\{[^}]*animation\\s*:\\s*none',
    )
    const reduced = reducedMotionRule.test(CODE)

    expect(reduced).toBe(true)
  })

  it('carries no @import and no url(): nothing is fetched by the stylesheet', () => {
    expect(CODE).not.toMatch(/@import/)
    expect(CODE).not.toMatch(/url\s*\(/)
  })
})
