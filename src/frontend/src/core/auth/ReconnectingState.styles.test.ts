/**
 * core/auth/ReconnectingState.styles.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login Gate-2 W-5: the "Reconnecting..." screen is shown to a participant on a
 * phone with a flaky connection, so its numbers matter: text at least 16 px, controls at
 * least 44 px tall, no horizontal scroll at 320 px, WCAG 2.1 AA contrast (NFR-001).
 *
 * jsdom has no layout engine, so these facts are read off the stylesheet itself
 * (`readSrcFile`: Vitest blanks every `*.css` import, so a glob would pass vacuously) and
 * contrast is COMPUTED from the colours read, never a hand-typed ratio. Same technique as
 * `features/login/pages/JoinPage.styles.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { contrastRatio } from '@/test/contrast'

const CSS = readSrcFile('core/auth/ReconnectingState.module.css')
const CODE = CSS.replace(/\/\*[\s\S]*?\*\//g, '')

interface Rule {
  readonly selectors: readonly string[]
  readonly body: string
}

const RULES: readonly Rule[] = [...CODE.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(match => ({
  selectors: (match[1] ?? '').split(',').map(selector => selector.trim()).filter(Boolean),
  body: match[2] ?? '',
}))

function declared(selector: string, property: string): string | undefined {
  let value: string | undefined
  for (const rule of RULES.filter(candidate => candidate.selectors.includes(selector))) {
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

function colour(selector: string, property: string): string {
  const value = declared(selector, property)
  if (value === undefined || !/^#[0-9a-f]{6}$/i.test(value)) {
    throw new Error(`${selector} { ${property} } must be a #rrggbb colour, got "${value}"`)
  }
  return value
}

const CARD = colour('.card', 'background')

describe('the stylesheet is read for real (so nothing below passes vacuously)', () => {
  it('finds the screen\'s classes', () => {
    for (const selector of ['.page', '.card', '.heading', '.region', '.action', '.secondary']) {
      expect(declared(selector, 'box-sizing') ?? declared(selector, 'color'), selector).toBeDefined()
    }
  })
})

describe('text size and tap targets', () => {
  it('declares every font-size as at least 16px', () => {
    const sizes = [...CODE.matchAll(/font-size\s*:\s*([^;]+);/g)].map(match => (match[1] ?? '').trim())
    expect(sizes.length).toBeGreaterThan(0)
    for (const size of sizes) {
      expect(px(size), `font-size: ${size}`).toBeGreaterThanOrEqual(16)
    }
  })

  it('makes Try again and Sign in again at least 44px tall; Try again is full width', () => {
    expect(px(declared('.action', 'min-height'))).toBeGreaterThanOrEqual(44)
    expect(px(declared('.secondary', 'min-height'))).toBeGreaterThanOrEqual(44)
    expect(declared('.action', 'width')).toBe('100%')
  })
})

describe('no horizontal scroll at 320px', () => {
  it('sizes by border-box, lets the card shrink, and wraps long words', () => {
    expect(declared('.page', 'box-sizing')).toBe('border-box')
    expect(declared('.card', 'box-sizing')).toBe('border-box')
    expect(declared('.card', 'width')).toBe('100%')
    expect(declared('.card', 'min-width')).toBe('0')
    expect(px(declared('.card', 'max-width'))).toBeLessThanOrEqual(400)
    expect(declared('.message', 'overflow-wrap')).toBe('anywhere')
    expect(CODE).not.toMatch(/overflow-x\s*:\s*(?:scroll|auto)/)
  })

  it('leaves at least 240px of content width at 320px', () => {
    const pagePadding = px(declared('.page', 'padding'))
    const narrowCardPadding = RULES
      .filter(rule => rule.selectors.includes('.card') && /padding/.test(rule.body))
      .map(rule => px(/padding\s*:\s*([^;]+)/.exec(rule.body)?.[1]?.trim()))
      .at(-1) ?? 0
    expect(320 - 2 * pagePadding - 2 * narrowCardPadding).toBeGreaterThanOrEqual(240)
  })
})

describe('contrast, WCAG 2.1 AA (NFR-001)', () => {
  const textPairs: ReadonlyArray<readonly [string, string, string]> = [
    ['the heading', colour('.heading', 'color'), CARD],
    ['the message box', colour('.region', 'color'), colour('.region', 'background')],
    ['Try again', colour('.action', 'color'), colour('.action', 'background')],
    ['Try again on hover', colour('.action', 'color'), colour('.action:hover', 'background')],
    [
      'Try again while a retry runs',
      colour('.action', 'color'),
      colour(".action[aria-disabled='true']", 'background'),
    ],
    ['Sign in again', colour('.secondary', 'color'), CARD],
  ]

  it.each(textPairs)('%s text is at least 4.5:1', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5)
  })

  it('draws the focus rings and the Try again fill at least 3:1 against the card (1.4.11)', () => {
    const ring = (selector: string): string | undefined => {
      const rule = RULES.find(candidate => candidate.selectors.includes(selector))
      return /outline\s*:\s*\d+px solid (#[0-9a-f]{6})/i.exec(rule?.body ?? '')?.[1]
    }
    for (const selector of ['.region:focus-visible', '.action:focus-visible']) {
      expect(ring(selector), selector).toBeDefined()
      expect(contrastRatio(ring(selector) ?? '#ffffff', CARD), selector).toBeGreaterThanOrEqual(3)
    }
    expect(contrastRatio(colour('.action', 'background'), CARD)).toBeGreaterThanOrEqual(3)
  })

  it('the message box border is DECORATIVE (words and icon carry it; forced colours add one)', () => {
    // The resting border is a pale hairline on purpose (it is below 3:1 against the card), so
    // this test does not pretend otherwise. WCAG 1.4.11 asks for 3:1 only on a boundary that is
    // NEEDED to identify a component; here the state is carried by the sentence and the icon
    // (`ReconnectingState.test.tsx` pins both) and the text inside the box clears 4.5:1 (above).
    const restingRule = RULES.find(rule => rule.selectors.includes('.region'))
    const border = /border\s*:\s*\d+px solid (#[0-9a-f]{6})/i.exec(restingRule?.body ?? '')?.[1]
    expect(border).toBeDefined()
    expect(contrastRatio(border ?? '#ffffff', CARD)).toBeLessThan(3)

    // What a person who needs the boundary DOES get: Windows High Contrast drops author
    // colours, so the box is given a solid system-colour border there.
    const forced = new RegExp(
      '@media\\s*\\(forced-colors:\\s*active\\)\\s*\\{[^@]*'
      + '\\.region\\s*\\{[^}]*border\\s*:\\s*2px solid CanvasText',
    )
    expect(forced.test(CODE)).toBe(true)
  })
})

describe('motion and fetches', () => {
  it('stops the spinner under prefers-reduced-motion', () => {
    expect(new RegExp(
      '@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)\\s*\\{[^@]*'
      + '\\.spinner\\s*\\{[^}]*animation\\s*:\\s*none',
    ).test(CODE)).toBe(true)
  })

  it('keeps a visible cue in forced-colors mode', () => {
    expect(CODE).toMatch(/@media\s*\(forced-colors:\s*active\)/)
  })

  it('carries no @import and no url(): nothing is fetched by the stylesheet', () => {
    expect(CODE).not.toMatch(/@import/)
    expect(CODE).not.toMatch(/url\s*\(/)
  })
})
