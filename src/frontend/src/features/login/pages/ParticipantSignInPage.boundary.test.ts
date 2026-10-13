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
 *  4. The Today's-word fields are `type="text"` in the JSX (the word is read off
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

const rawSources = import.meta.glob(
  ['./ParticipantSignInPage.tsx', '../services/participantSignInService.ts'],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const PAGE_SOURCE = rawSources['./ParticipantSignInPage.tsx'] ?? ''
const SERVICE_SOURCE = rawSources['../services/participantSignInService.ts'] ?? ''
const CSS_SOURCE = readSrcFile('features/login/pages/ParticipantSignInPage.module.css')

/** Drops block comments and whole-line / trailing line comments, keeping code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1')
}

const PAGE_CODE = stripComments(PAGE_SOURCE)
const SERVICE_CODE = stripComments(SERVICE_SOURCE)
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

/** The px value of `property` in a declaration block, or `undefined`. */
function pxValue(block: string, property: string): number | undefined {
  const match = new RegExp(`(?:^|[;\\s])${property}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`).exec(block)
  return match?.[1] === undefined ? undefined : Number(match[1])
}

describe('ParticipantSignInPage boundary - the scan is not vacuous', () => {
  it('sees the real page, service and stylesheet', () => {
    expect(PAGE_SOURCE).toContain('export function ParticipantSignInPage')
    expect(SERVICE_SOURCE).toContain('export async function signInWithDayWord')
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
  ])('the %s has no console output at all (the word and name are never logged)', (_label, code) => {
    expect(code).not.toMatch(/\bconsole\s*\./)
  })

  it('the page does not put the word or the name in a URL', () => {
    // navigate() is only ever given the role-aware entry '/'.
    const navigations = Array.from(PAGE_CODE.matchAll(/navigate\(([^)]*)\)/g), match => match[1])
    expect(navigations.length).toBeGreaterThan(0)
    for (const argument of navigations) {
      expect(argument?.trim()).toBe("'/'")
    }
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
    expect(ids.length).toBe(5)
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
