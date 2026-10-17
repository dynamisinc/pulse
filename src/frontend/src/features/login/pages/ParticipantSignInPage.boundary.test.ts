/**
 * features/login/pages/ParticipantSignInPage.boundary.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 09 ("Sign-in page: Today's word") — the SOURCE-SCAN guard the
 * story's cross-cutting "No-enterprise-look (D0 section 2)" AC asks for (the
 * technique story 08 describes for the join page, and
 * `staffShell/twoWorldsSeparation.test.ts` uses). The participant sign-in page
 * had no such guard before: story 02 verified it "by inspection". This one
 * reads the REAL files, so it fails the moment someone imports staff-world or
 * default-MUI chrome into the page.
 *
 * WHAT IT PINS
 *  1. TWO WORLDS: the page, its service and its CSS Module never import
 *     `@mui/*` (so no `@mui/material` look and no `@mui/icons-material`),
 *     `@/theme/*`, `cobraTheme`, `styledComponents` or `CobraStyles`, nor
 *     reach into the staff roster feature. Icons are FontAwesome only.
 *  2. CONTENT SECURITY (NFR-004): no `dangerouslySetInnerHTML` in the page, and
 *     no `console.*` call in the page or the service (the day word and name are
 *     credentials: "never logged").
 *  3. MOBILE-FIRST numbers (the Today's-word form is filled in on a phone):
 *     inputs are 16 px or larger (below that iOS Safari zooms on focus), the
 *     toggle buttons / inputs / submit are at least 44 px tall, the page never
 *     uses `100vw` (the classic cause of horizontal scroll), has a narrow-phone
 *     media query, and the toggle has a visible keyboard focus ring.
 *  4. CONTRAST, computed from the colours read off the stylesheet (never a
 *     hand-typed ratio - `src/test/contrast.ts`): the small staff-link text is at
 *     least 4.5:1 on the card (WCAG 1.4.3) and the input border at least 3:1
 *     against both the input fill and the card (1.4.11) - Gate-1 W-2.
 *  5. Forced-colors (Windows High Contrast) keeps a visible cue on the active
 *     method, which the box-shadow bar cannot (S-1); long exercise names wrap
 *     (S-3); the status region keeps a reserved height (S-4); every form is
 *     `method="post"` (S-6); "Exercise code" no longer appears in the page (W-1).
 *  6. The Today's-word fields are `type="text"` in the JSX (the word is read off
 *     a screen; a masked field only causes typos) with the attribute set the
 *     story lists - a second line of defence beside the RTL tests, on the
 *     source itself.
 *
 * HOW IT READS THEM. TS/TSX come from Vite's `import.meta.glob` with `?raw`.
 * CSS CANNOT: Vitest blanks every `*.css` id (`?raw` included), so a guard built
 * on it would pass vacuously; the stylesheet text is read off disk with
 * `readSrcFile` (`src/test/readSource.ts`). COMMENTS are stripped before any
 * scan so a file may DOCUMENT the ban (these files do). Non-vacuity is asserted:
 * the scan must see the real exports/rules, and the detectors are proven to bite
 * on literal bad input before they are trusted.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { contrastRatio } from '@/test/contrast'

const rawSources = import.meta.glob(
  [
    './ParticipantSignInPage.tsx',
    '../services/participantSignInService.ts',
    '../completeSignIn.ts',
    '../linkToken.ts',
    '../services/joinService.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const PAGE_SOURCE = rawSources['./ParticipantSignInPage.tsx'] ?? ''
const SERVICE_SOURCE = rawSources['../services/participantSignInService.ts'] ?? ''
// The shared "sign-in succeeded" step the page hands off to (Gate-2 W-2). It runs on the
// participant path, so it is held to the same two-worlds rule as the page itself.
const COMPLETE_SOURCE = rawSources['../completeSignIn.ts'] ?? ''
// The home-screen link method's parser and the join exchange it reuses (#606): the
// pasted link is a bearer credential, so both are held to the no-console rule too.
const LINK_TOKEN_SOURCE = rawSources['../linkToken.ts'] ?? ''
const JOIN_SERVICE_SOURCE = rawSources['../services/joinService.ts'] ?? ''
const CSS_SOURCE = readSrcFile('features/login/pages/ParticipantSignInPage.module.css')

/** Drops block comments and whole-line / trailing line comments, keeping code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const PAGE_CODE = stripComments(PAGE_SOURCE)
const SERVICE_CODE = stripComments(SERVICE_SOURCE)
const COMPLETE_CODE = stripComments(COMPLETE_SOURCE)
const CSS_CODE = stripComments(CSS_SOURCE)

/** Specifiers that would bring staff-world or default-MUI chrome onto this page. */
const FORBIDDEN_SPECIFIER_PATTERNS: readonly RegExp[] = [
  /^@mui\//, // @mui/material, @mui/icons-material, @mui/system, ...
  /^@\/theme(\/|$)/, // @/theme/cobraTheme, @/theme/styledComponents, @/theme/CobraStyles
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  /staffShellTokens/,
  /(^|\/)participantAdmin(\/|$)/, // the STAFF roster screen despite its name
]

/** Every static / side-effect / dynamic import and require specifier in `source`. */
function importSpecifiers(source: string): string[] {
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  return patterns.flatMap(pattern =>
    Array.from(source.matchAll(pattern), match => match[1]).filter(
      (specifier): specifier is string => specifier !== undefined,
    ),
  )
}

function forbiddenImports(source: string): string[] {
  return importSpecifiers(stripComments(source)).filter(specifier =>
    FORBIDDEN_SPECIFIER_PATTERNS.some(pattern => pattern.test(specifier)),
  )
}

/** The declaration block of the FIRST rule whose selector is exactly `.name`. */
function ruleBlock(css: string, className: string): string {
  const match = new RegExp(`\\.${className}\\s*\\{([^}]*)\\}`).exec(css)
  return match?.[1] ?? ''
}

/**
 * The `#rrggbb` value of `property` in a declaration block (a `1px solid` prefix, as on
 * `border`, is skipped). Throws if absent: a guard must not guess.
 */
function hexValue(block: string, property: string): string {
  const pattern = `(?:^|[;\\s])${property}\\s*:\\s*(?:1px solid\\s+)?(#[0-9a-fA-F]{6})\\b`
  const match = new RegExp(pattern).exec(block)
  const value = match?.[1]
  if (value === undefined) throw new Error(`no #rrggbb ${property} in: ${block}`)
  return value
}

/** The px value of `property` in a declaration block, or `undefined`. */
function pxValue(block: string, property: string): number | undefined {
  const match = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

describe('ParticipantSignInPage boundary - the scan is not vacuous', () => {
  it('sees the real page, service and stylesheet', () => {
    expect(PAGE_SOURCE).toContain('export function ParticipantSignInPage')
    expect(SERVICE_SOURCE).toContain('export async function signInWithDayWord')
    expect(COMPLETE_SOURCE).toContain('export function completeSignIn')
    expect(CSS_SOURCE).toContain('.toggleButton')
    expect(importSpecifiers(PAGE_CODE).length).toBeGreaterThan(5)
    expect(importSpecifiers(SERVICE_CODE)).toContain('@/core/services/api')
  })

  it('the import detector bites on every forbidden family', () => {
    const bad = [
      "import { Button } from '@mui/material'",
      "import { faPlus } from '@mui/icons-material'",
      "import { CobraPrimaryButton } from '@/theme/styledComponents'",
      "import { cobraTheme } from '@/theme/cobraTheme'",
      "import { CobraStyles } from '../../theme/CobraStyles'",
      "import '@mui/material/styles'",
      "const x = await import('@/theme/cobraTheme')",
    ]
    for (const line of bad) {
      expect(forbiddenImports(line), line).not.toEqual([])
    }
    expect(forbiddenImports("import { useState } from 'react'")).toEqual([])
    // a comment that merely MENTIONS the ban is not an import
    expect(forbiddenImports("// NO @mui/material, NO '@/theme/styledComponents'")).toEqual([])
  })
})

describe('ParticipantSignInPage boundary - the two-worlds rule (D0 section 2)', () => {
  it('the page imports no MUI, COBRA or theme module', () => {
    expect(forbiddenImports(PAGE_SOURCE)).toEqual([])
  })

  it('the service imports no MUI, COBRA or theme module', () => {
    expect(forbiddenImports(SERVICE_SOURCE)).toEqual([])
  })

  it('the shared completeSignIn step imports no MUI, COBRA or theme module', () => {
    expect(forbiddenImports(COMPLETE_SOURCE)).toEqual([])
  })

  it('the link-token parser and the join service import no MUI, COBRA or theme module', () => {
    expect(LINK_TOKEN_SOURCE).toContain('export function extractJoinToken')
    expect(JOIN_SERVICE_SOURCE).toContain('export async function signInWithLink')
    expect(forbiddenImports(LINK_TOKEN_SOURCE)).toEqual([])
    expect(forbiddenImports(JOIN_SERVICE_SOURCE)).toEqual([])
  })

  it('the page takes its icons from FontAwesome', () => {
    expect(importSpecifiers(PAGE_CODE)).toContain('@fortawesome/react-fontawesome')
    expect(importSpecifiers(PAGE_CODE)).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('the page is styled by its own CSS Module', () => {
    expect(importSpecifiers(PAGE_CODE)).toContain('./ParticipantSignInPage.module.css')
  })

  it('the stylesheet imports nothing (no @import of a shared or staff sheet)', () => {
    expect(CSS_CODE).not.toMatch(/@import/)
  })
})

describe('ParticipantSignInPage boundary - content security (NFR-004 / NFR-009)', () => {
  it('the page never uses dangerouslySetInnerHTML', () => {
    expect(PAGE_CODE).not.toContain('dangerouslySetInnerHTML')
  })

  it.each([
    ['page', PAGE_CODE],
    ['service', SERVICE_CODE],
    ['link-token parser', stripComments(LINK_TOKEN_SOURCE)],
    ['join service', stripComments(JOIN_SERVICE_SOURCE)],
  ])('the %s has no console output at all (the word and name are never logged)', (_label, code) => {
    expect(code).not.toMatch(/\bconsole\s*\./)
  })

  it('the page does not put the word or the name in a URL', () => {
    // The page never calls navigate() itself: it hands `navigate` to the shared
    // `completeSignIn`, which only ever goes to the role-aware entry '/'.
    expect(PAGE_CODE).not.toMatch(/\bnavigate\(/)
    expect(PAGE_CODE).toMatch(/completeSignIn\(/)
    const navigations = Array.from(
      COMPLETE_CODE.matchAll(/\bnavigate\(([^,)]*)/g),
      match => match[1]?.trim(),
    )
    expect(navigations).toEqual(['SIGNED_IN_PATH'])
    expect(COMPLETE_CODE).toMatch(/export const SIGNED_IN_PATH = '\/'/)
    expect(PAGE_CODE).not.toMatch(/location\.(search|hash|href)\s*=/)
    expect(PAGE_CODE).not.toMatch(/useSearchParams/)
  })
})

describe('ParticipantSignInPage boundary - the Today\'s-word fields in the source (09-AC2)', () => {
  /** Every `<input ... />` element in the page's JSX (an `=>` inside a prop contains `>`). */
  const INPUT_ELEMENTS = Array.from(PAGE_CODE.matchAll(/<input\b[\s\S]*?\/>/g), match => match[0])

  /** The JSX of the input whose id is `id`. */
  function inputElement(id: string): string {
    return INPUT_ELEMENTS.find(element => element.includes(`id="${id}"`)) ?? ''
  }

  it('finds both inputs', () => {
    expect(inputElement('participant-signin-word-name')).not.toBe('')
    expect(inputElement('participant-signin-word')).not.toBe('')
  })

  it.each(['participant-signin-word-name', 'participant-signin-word'])(
    '%s switches off auto-capitalise, auto-correct and spell-check, and uses the input class',
    id => {
      const element = inputElement(id)
      expect(element).toContain('autoCapitalize="none"')
      expect(element).toContain('autoCorrect="off"')
      expect(element).toContain('spellCheck={false}')
      expect(element).toContain('className={styles.input}')
      expect(element).toContain('required')
    },
  )

  it('the name is autocomplete="username" and the word is autocomplete="off"', () => {
    expect(inputElement('participant-signin-word-name')).toContain('autoComplete="username"')
    expect(inputElement('participant-signin-word')).toContain('autoComplete="off"')
  })

  it('the word field is type="text", not a masked type="password" field', () => {
    expect(inputElement('participant-signin-word')).toContain('type="text"')
    expect(inputElement('participant-signin-word')).not.toContain('type="password"')
    expect(inputElement('participant-signin-word-name')).toContain('type="text"')
  })

  it('every input on the page has a <label htmlFor> (no placeholder-only labels)', () => {
    const ids = INPUT_ELEMENTS.map(element => /\sid="([^"]+)"/.exec(element)?.[1])
    // Five on every page, plus the pasted-link field of the home-screen app (#606).
    expect(ids.length).toBe(6)
    for (const id of ids) {
      expect(id).toBeDefined()
      expect(PAGE_CODE, `label for ${String(id)}`).toContain(`htmlFor="${String(id)}"`)
    }
    expect(PAGE_CODE).not.toMatch(/placeholder=/)
  })

  it('the method toggles are type="button" with aria-pressed (not a div onClick)', () => {
    expect(PAGE_CODE).toMatch(/<button[^>]*type="button"[^>]*aria-pressed=/)
    expect(PAGE_CODE).not.toMatch(/<div[^>]*onClick/)
  })
})

describe('ParticipantSignInPage boundary - mobile-first numbers (NFR-001, 09 tech notes)', () => {
  it('the stylesheet has real rules (the guard is not vacuous)', () => {
    expect(CSS_CODE.length).toBeGreaterThan(1000)
    expect(ruleBlock(CSS_CODE, 'input')).not.toBe('')
    expect(ruleBlock(CSS_CODE, 'toggleButton')).not.toBe('')
    expect(ruleBlock(CSS_CODE, 'submitButton')).not.toBe('')
  })

  it('inputs are 16 px or larger (iOS Safari zooms the page on focus below that)', () => {
    const size = pxValue(ruleBlock(CSS_CODE, 'input'), 'font-size')
    expect(size).toBeDefined()
    expect(size ?? 0).toBeGreaterThanOrEqual(16)
  })

  it.each(['input', 'toggleButton', 'submitButton'])(
    '.%s is at least 44 px tall (touch target)',
    className => {
      const height = pxValue(ruleBlock(CSS_CODE, className), 'min-height')
      expect(height).toBeDefined()
      expect(height ?? 0).toBeGreaterThanOrEqual(44)
    },
  )

  it('the submit button text is at least 16 px too', () => {
    expect(pxValue(ruleBlock(CSS_CODE, 'submitButton'), 'font-size') ?? 0).toBeGreaterThanOrEqual(16)
  })

  it('never sizes anything to 100vw, and boxes the card and inputs so padding cannot overflow', () => {
    expect(CSS_CODE).not.toMatch(/\b100vw\b/)
    expect(ruleBlock(CSS_CODE, 'card')).toContain('box-sizing: border-box')
    expect(ruleBlock(CSS_CODE, 'card')).toContain('width: 100%')
    expect(ruleBlock(CSS_CODE, 'input')).toContain('box-sizing: border-box')
    expect(ruleBlock(CSS_CODE, 'input')).toContain('width: 100%')
  })

  it('lets the three toggle labels shrink and wrap instead of overflowing a 320 px card', () => {
    const block = ruleBlock(CSS_CODE, 'toggleButton')
    expect(block).toContain('min-width: 0')
    expect(block).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('has a narrow-phone media query (320 px viewport)', () => {
    expect(CSS_CODE).toMatch(/@media\s*\(max-width:\s*360px\)/)
  })

  it('the toggle shows a keyboard focus ring', () => {
    expect(CSS_CODE).toMatch(/\.toggleButton:focus-visible\s*\{[^}]*outline:/)
  })

  it('the active toggle is not distinguished by colour alone (weight + underline bar)', () => {
    const match = /\.toggleButton\[aria-pressed='true'\]\s*\{([^}]*)\}/.exec(CSS_CODE)
    expect(match?.[1]).toBeDefined()
    expect(match?.[1]).toMatch(/font-weight:\s*700/)
    expect(match?.[1]).toMatch(/box-shadow:[^;]*inset/)
  })

  it('keeps every class story 08 may read (additive change only)', () => {
    for (const className of [
      'page',
      'card',
      'brandRow',
      'brandIcon',
      'brandLabel',
      'heading',
      'toggleGroup',
      'toggleButton',
      'form',
      'field',
      'label',
      'input',
      'submitButton',
      'alert',
      'status',
      'staffLinkRow',
      'staffLink',
    ]) {
      expect(CSS_CODE, `.${className}`).toMatch(new RegExp(`\\.${className}\\s*[{:\\[]`))
    }
  })
})

describe('ParticipantSignInPage boundary - contrast, computed off the stylesheet (WCAG 1.4.3 / 1.4.11, Gate-1 W-2)', () => {
  const cardBackground = hexValue(ruleBlock(CSS_CODE, 'card'), 'background')

  it('reads real colours (the guard is not vacuous)', () => {
    expect(cardBackground).toBe('#ffffff')
    expect(hexValue(ruleBlock(CSS_CODE, 'input'), 'background')).toMatch(/^#[0-9a-f]{6}$/i)
  })

  it('the "Staff or controller?" text is at least 4.5:1 on the card', () => {
    const colour = hexValue(ruleBlock(CSS_CODE, 'staffLinkRow'), 'color')

    expect(contrastRatio(colour, cardBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('the input border is at least 3:1 against the input fill AND against the card', () => {
    const inputBlock = ruleBlock(CSS_CODE, 'input')
    const border = hexValue(inputBlock, 'border')
    const fill = hexValue(inputBlock, 'background')

    expect(contrastRatio(border, fill)).toBeGreaterThanOrEqual(3)
    expect(contrastRatio(border, cardBackground)).toBeGreaterThanOrEqual(3)
  })

  it.each([
    ['staffLink', 'color'],
    ['status', 'color'],
    ['label', 'color'],
    ['heading', 'color'],
  ])('.%s text is at least 4.5:1 on the card', (className, property) => {
    const colour = hexValue(ruleBlock(CSS_CODE, className), property)

    expect(contrastRatio(colour, cardBackground)).toBeGreaterThanOrEqual(4.5)
  })

  it('the submit button text is at least 4.5:1 on its fill, and the alert text on its fill', () => {
    const submit = ruleBlock(CSS_CODE, 'submitButton')
    expect(contrastRatio(hexValue(submit, 'color'), hexValue(submit, 'background'))).toBeGreaterThanOrEqual(4.5)
    const alert = ruleBlock(CSS_CODE, 'alert')
    expect(contrastRatio(hexValue(alert, 'color'), hexValue(alert, 'background'))).toBeGreaterThanOrEqual(4.5)
  })

  it('the contrast helper bites: the OLD values (#7c8894 text, #cdd7de border) fail the same bars', () => {
    expect(contrastRatio('#7c8894', '#ffffff')).toBeLessThan(4.5)
    expect(contrastRatio('#cdd7de', '#fbfcfd')).toBeLessThan(3)
  })
})

describe('ParticipantSignInPage boundary - Gate-1 folds (S-1, S-3, S-4, S-6, W-1)', () => {
  it('S-1: forced-colors mode keeps a visible cue on the active method (a border, not the dropped box-shadow)', () => {
    const forcedColors = new RegExp(
      '@media\\s*\\(forced-colors:\\s*active\\)\\s*\\{\\s*' +
        '\\.toggleButton\\[aria-pressed=\'true\'\\]\\s*\\{([^}]*)\\}',
    )
    const match = forcedColors.exec(CSS_CODE)
    expect(match?.[1]).toBeDefined()
    expect(match?.[1]).toMatch(/border-bottom:\s*3px solid CanvasText/)
  })

  it('S-3: the heading wraps a long exercise name', () => {
    expect(ruleBlock(CSS_CODE, 'heading')).toMatch(/overflow-wrap:\s*anywhere/)
  })

  it('S-4: the status region reserves its height so the text swap cannot shift the layout', () => {
    expect(ruleBlock(CSS_CODE, 'status')).toMatch(/min-height:\s*1\.4em/)
  })

  it('S-4: the page mounts the status region unconditionally and swaps only its text', () => {
    const statusElements = PAGE_CODE.match(/role="status"/g) ?? []
    expect(statusElements).toHaveLength(1)
    // Not `{isSubmitting ? (<p role="status" ...>) : null}` - the node must always exist.
    expect(PAGE_CODE).not.toMatch(/\?\s*\(\s*<p[^>]*role="status"/)
    expect(PAGE_CODE).toMatch(/\{isSubmitting \? 'Signing in…' : ''\}/)
  })

  it('S-6: every form (three, plus the home-screen link form, #606) is method="post"', () => {
    const forms = Array.from(PAGE_CODE.matchAll(/<form\b[\s\S]*?>/g), match => match[0])
    expect(forms).toHaveLength(4)
    for (const form of forms) {
      expect(form).toContain('method="post"')
    }
  })

  it('W-1: no user-visible "Exercise code" wording is left in the page (comments excluded)', () => {
    expect(PAGE_CODE).not.toMatch(/exercise code/i)
    expect(PAGE_CODE).toContain('View-only code')
    expect(PAGE_CODE).toContain('Sign in with a view-only code')
    expect(PAGE_CODE).toContain("That view-only code wasn't recognized.")
  })
})
