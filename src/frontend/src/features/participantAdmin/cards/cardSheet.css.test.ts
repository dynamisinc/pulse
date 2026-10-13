/**
 * features/participantAdmin/cards/cardSheet.css.test.ts
 * ---------------------------------------------------------------------------
 * The paper, guarded. jsdom cannot evaluate print media (and Vitest stubs every CSS import
 * to empty), so these assertions read the REAL stylesheet text off disk and check the
 * rules the story promises: eight cards a page (two by four), a dashed cut guide,
 * `break-inside: avoid`, a QR of at least 1.25in, `#root` and the screen-only chrome hidden
 * under `@media print`, no COBRA colour anywhere, and NO `@page` rule in the stylesheet
 * (it is injected while the preview is open; see `CardSheetPreview.test.tsx`). The manual
 * print checklist in README.md covers what only a printer can.
 *
 * The import and content guards for the whole folder live in `cardsSourceGuards.test.ts`.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { cobraTheme } from '@/theme/cobraTheme'
import { CARD_SHEET_PAGE_RULE } from './cardFormat'

const CSS_PATH = 'features/participantAdmin/cards/cardSheet.module.css'
const css = readSrcFile(CSS_PATH)

/** Strips /* comments *\/ so prose in the header never satisfies (or breaks) an assertion. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** The text between the braces of the block that opens at `openIndex` (a `{`). */
function braceBody(text: string, openIndex: number): string {
  let depth = 0
  for (let i = openIndex; i < text.length; i++) {
    if (text[i] === '{') depth += 1
    if (text[i] === '}') {
      depth -= 1
      if (depth === 0) return text.slice(openIndex + 1, i)
    }
  }
  throw new Error('unbalanced braces in the stylesheet')
}

const clean = stripComments(css)
const printStart = clean.indexOf('@media print')
const printCss = braceBody(clean, clean.indexOf('{', printStart))
const screenCss = clean.slice(0, printStart)

/** The declarations of the first rule for exactly `selector` within `scope`. */
function rule(scope: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`(?:^|\\n|\\})\\s*${escaped}\\s*\\{`).exec(scope)
  if (match === null) throw new Error(`no rule for ${selector}`)
  return braceBody(scope, match.index + match[0].length - 1)
}

describe('the paper (US Letter, eight-up)', () => {
  it('has NO @page rule in the stylesheet: it would apply to every print in the app', () => {
    // Comments are stripped, so the prose explaining this does not count.
    expect(clean).not.toMatch(/@page/)
  })

  it('gets Letter portrait with 0.5in margins from the rule injected while the preview is open', () => {
    expect(CARD_SHEET_PAGE_RULE).toMatch(/size:\s*letter portrait/)
    expect(CARD_SHEET_PAGE_RULE).toMatch(/margin:\s*0\.5in/)
  })

  it('lays a page out as two columns by four rows', () => {
    const page = rule(screenCss, '.page')
    expect(page).toMatch(/display:\s*grid/)
    expect(page).toMatch(/grid-template-columns:\s*repeat\(2,/)
    expect(page).toMatch(/grid-template-rows:\s*repeat\(4,/)
  })

  it('prints each page as the 7.5in x 9.9in printable area, then breaks the page', () => {
    const page = rule(printCss, '.page')
    expect(page).toMatch(/width:\s*7\.5in/)
    expect(page).toMatch(/height:\s*9\.9in/) // inside the 10in area: slack so no blank sheet
    expect(page).toMatch(/break-after:\s*page/)
    expect(rule(printCss, '.page:last-child')).toMatch(/break-after:\s*auto/)
  })

  it('gives each card a dashed cut-guide border and never splits it across pages', () => {
    const card = rule(screenCss, '.card')
    expect(card).toMatch(/border:\s*1px dashed #000/)
    expect(card).toMatch(/break-inside:\s*avoid/)
    expect(card).toMatch(/page-break-inside:\s*avoid/)
  })

  it('makes the QR at least 1.25in square', () => {
    const qr = rule(screenCss, '.qr')
    const width = Number(/(?:^|[\s;])width:\s*([\d.]+)in/.exec(qr)?.[1])
    const height = Number(/(?:^|[\s;])height:\s*([\d.]+)in/.exec(qr)?.[1])
    const minWidth = Number(/min-width:\s*([\d.]+)in/.exec(qr)?.[1])
    expect(width).toBeGreaterThanOrEqual(1.25)
    expect(height).toBeGreaterThanOrEqual(1.25)
    expect(minWidth).toBeGreaterThanOrEqual(1.25)
  })

  it('fits eight cards on the page: 2 x 4 cells inside 7.5in x 9.9in with 0.1in gutters', () => {
    // card = (7.5 - 0.1) / 2 wide, (9.9 - 3 x 0.1) / 4 tall. The QR must fit the height
    // with room for the header, link and help line.
    const cardHeightIn = (9.9 - 3 * 0.1) / 4
    const cardWidthIn = (7.5 - 0.1) / 2
    expect(rule(screenCss, '.page')).toMatch(/gap:\s*0\.1in/)
    expect(cardHeightIn).toBeCloseTo(2.4, 5)
    expect(cardWidthIn).toBeCloseTo(3.7, 5)
    expect(1.3 + 0.16 + 0.55).toBeLessThan(cardHeightIn) // QR + padding + header/footer lines
  })
})

describe('what does not print', () => {
  it('hides #root, but only while the preview is open', () => {
    const hide = /html\.sheetOpen\s*>\s*body\s*>\s*:global\(#root\)\s*\{([^}]*)\}/.exec(printCss)
    expect(hide?.[1]).toMatch(/display:\s*none\s*!important/)
  })

  it('hides every other stray body-level layer too', () => {
    const hide = /html\.sheetOpen\s*>\s*body\s*>\s*:not\(\.overlay\)\s*\{([^}]*)\}/.exec(printCss)
    expect(hide?.[1]).toMatch(/display:\s*none\s*!important/)
  })

  it('hides the toolbar, the banner and the skipped summary (.screenOnly)', () => {
    expect(rule(printCss, '.screenOnly')).toMatch(/display:\s*none\s*!important/)
  })

  it('does not hide #root outside @media print, or when the preview is closed', () => {
    expect(screenCss).not.toContain('#root')
    expect(/(^|\n)\s*(html|body)\b[^{]*\{/.test(screenCss)).toBe(false)
    // every print rule that touches html/body is scoped to the open-preview class
    for (const selector of printCss.match(/(?:^|\n)\s*(?:html|body)[^{]*\{/g) ?? []) {
      expect(selector).toContain('.sheetOpen')
    }
  })

  it('turns the fixed full-screen overlay into ordinary page flow for printing', () => {
    const overlay = rule(printCss, '.overlay')
    expect(overlay).toMatch(/position:\s*static\s*!important/)
    expect(overlay).toMatch(/overflow:\s*visible\s*!important/)
  })

  it('keeps the shell\'s 100%-height / overflow lock from truncating the sheet', () => {
    const lock = rule(printCss, 'html.sheetOpen,\n  html.sheetOpen body')
    expect(lock).toMatch(/height:\s*auto\s*!important/)
    expect(lock).toMatch(/overflow:\s*visible\s*!important/)
  })
})

describe('neutral, legible with background graphics off', () => {
  it('uses no background fill on the card but white, so nothing depends on graphics', () => {
    const card = rule(screenCss, '.card')
    expect(card).toMatch(/background:\s*#fff/)
    expect(card).toMatch(/color:\s*#000/)
    const cardsCss = ['.card', '.qr', '.writeLine', '.cardHeader'].map(s => rule(screenCss, s)).join('\n')
    const backgrounds = cardsCss.match(/background(?:-color)?:\s*[^;]+;/g) ?? []
    expect(backgrounds.every(b => /#fff\b/.test(b))).toBe(true)
  })

  it('draws the writing line and header rule with borders (which print with graphics off)', () => {
    expect(rule(screenCss, '.writeLine')).toMatch(/border-bottom:\s*[\d.]+px solid #000/)
    expect(rule(screenCss, '.cardHeader')).toMatch(/border-bottom:\s*1px solid #000/)
  })

  it('has no COBRA palette colour anywhere in the card or page styles', () => {
    const palette = cobraTheme.palette
    const cobraHexes = [
      palette.buttonPrimary.main,
      palette.buttonPrimary.dark,
      palette.buttonPrimary.light,
      palette.primary.main,
      palette.primary.light,
      palette.linkButton.light,
      palette.grid.main,
      palette.background.default,
    ].map(hex => hex.toLowerCase())
    const used = (clean.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map(hex => hex.toLowerCase())
    for (const hex of cobraHexes) expect(used).not.toContain(hex)
  })

  it('clamps the exercise name to two lines so a long one cannot push the card apart', () => {
    const exercise = rule(screenCss, '.exercise')
    expect(exercise).toMatch(/-webkit-line-clamp:\s*2/)
    expect(exercise).toMatch(/overflow:\s*hidden/)
  })

  it('sets the help line at 7pt or larger (legible on paper)', () => {
    const size = Number(/font-size:\s*([\d.]+)pt/.exec(rule(screenCss, '.help'))?.[1])
    expect(size).toBeGreaterThanOrEqual(7)
    expect(size).toBeLessThanOrEqual(7.5)
  })

  it('sets the sign-in name and the link in a monospace face', () => {
    expect(rule(screenCss, '.signIn,\n.link')).toMatch(/font-family:[^;]*monospace/)
  })
})
