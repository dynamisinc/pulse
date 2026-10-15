/**
 * features/participantAdmin/cards/cardsSourceGuards.test.ts
 * ---------------------------------------------------------------------------
 * Source guards for the whole folder, in the spirit of
 * `staffShell/twoWorldsSeparation.test.ts`, read off the REAL source text (Vite's eager
 * `?raw` glob), so they fail the moment a file actually does the forbidden thing.
 *
 * 1. NO PARTICIPANT-WORLD IMPORTS, in EVERY file of this folder, tests included. The card
 *    sheet is staff chrome around a neutral printed artifact (EL-15). It must never reach
 *    into a participant surface or a brand skin, so none of these may appear as an import
 *    (static, type-only, re-export, side-effect, dynamic, `require`, or `vi.mock`):
 *      - `features/(social|portal|news|weather|participant-shell|login)`, by alias or
 *        by a relative path that lands there;
 *      - `BrandThemeProvider`, by module path or by the imported name.
 * 2. THE GUARD IS SELF-TESTED: the scanner is run on fixture sources that DO violate each
 *    rule (and on ones that must pass), so a regression in the scanner cannot turn this
 *    into a vacuous pass. The fixtures are built at run time (the `staticImport`, `sideEffect`, ...
 *    helpers), so this file contains no forbidden import of its own and is itself scanned
 *    by guard 1.
 * 3. THE PAPER IS PLAIN: the card and sheet import no COBRA and no MUI; the staff chrome
 *    uses the COBRA components and FontAwesome; no file injects HTML, touches storage,
 *    lazy-loads an image or logs.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'

const sources = import.meta.glob('./*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

interface SourceFile {
  readonly path: string
  readonly text: string
}

/** This file's own name. Vite's glob leaves the importing module out, so it is read off disk. */
const SELF = './cardsSourceGuards.test.ts'

const files: readonly SourceFile[] = [
  ...Object.entries(sources).map(([path, text]) => ({ path, text: String(text) })),
  { path: SELF, text: readSrcFile('features/participantAdmin/cards/cardsSourceGuards.test.ts') },
]

const isTestFile = (path: string) => /\.test\.tsx?$/.test(path) || path.includes('cardsTestUtils')

/** Source with block and line comments removed, so prose never counts as an import. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

interface ImportRef {
  /** The module specifier. */
  readonly specifier: string
  /** What was imported (`{ A, B }`, `Default`, `type { T }`); empty for side-effect/dynamic. */
  readonly clause: string
}

/** Every import of any form in `source`. */
function importsOf(source: string): ImportRef[] {
  const code = stripComments(source)
  const refs: ImportRef[] = []
  // import <clause> from 'x'  /  import type { T } from 'x'  /  export { a } from 'x'
  for (const m of code.matchAll(/(?:import|export)\s+([^'";]*?)\s*from\s*['"]([^'"]+)['"]/g)) {
    refs.push({ clause: m[1] ?? '', specifier: m[2] ?? '' })
  }
  // import 'x'  (side-effect only)
  for (const m of code.matchAll(/import\s*['"]([^'"]+)['"]/g)) {
    refs.push({ clause: '', specifier: m[1] ?? '' })
  }
  // import('x')  require('x')  vi.mock('x')  vi.importActual('x')
  const calls = /(?:import|require|vi\.mock|vi\.importActual)\s*\(\s*['"]([^'"]+)['"]/g
  for (const m of code.matchAll(calls)) {
    refs.push({ clause: '', specifier: m[1] ?? '' })
  }
  return refs
}

const PARTICIPANT_FEATURES = 'social|portal|news|weather|participant-shell|login'

/** Specifier rules: each names what it forbids. */
const FORBIDDEN_SPECIFIERS: ReadonlyArray<{ readonly what: string; readonly pattern: RegExp }> = [
  {
    what: 'a participant-surface feature',
    pattern: new RegExp(`(?:^|/)features/(?:${PARTICIPANT_FEATURES})(?:/|$)`),
  },
  {
    what: 'a participant-surface feature (relative path)',
    pattern: new RegExp(`^(?:\\.\\./){2,}(?:${PARTICIPANT_FEATURES})(?:/|$)`),
  },
  { what: 'a brand theme', pattern: /BrandThemeProvider/ },
]

/** What `source` imports that this folder must never import (empty = clean). */
function forbiddenImports(source: string): string[] {
  const found: string[] = []
  for (const { specifier, clause } of importsOf(source)) {
    for (const { what, pattern } of FORBIDDEN_SPECIFIERS) {
      if (pattern.test(specifier)) found.push(`'${specifier}' is ${what}`)
    }
    if (/BrandThemeProvider/.test(clause)) found.push(`'${clause}' imports BrandThemeProvider`)
  }
  return found
}

// Keywords are assembled at run time, so this file's own source holds no literal import
// statement for the scanner to trip over: it is scanned by the guard like every other file.
const IMPORT = 'imp' + 'ort'
const EXPORT = 'exp' + 'ort'
const REQUIRE = 'requ' + 'ire'
const VI_MOCK = 'vi.mo' + 'ck'

const staticImport = (spec: string, clause = '{ Thing }') => `${IMPORT} ${clause} from '${spec}'\n`
const sideEffect = (spec: string) => `${IMPORT} '${spec}'\n`
const reExport = (spec: string) => `${EXPORT} { Feed } from '${spec}'\n`
const dynamicImport = (spec: string) => `const m = await ${IMPORT}('${spec}')\n`
const required = (spec: string) => `const m = ${REQUIRE}('${spec}')\n`
const mocked = (spec: string) => `${VI_MOCK}('${spec}')\n`
const multiLine = (spec: string) => `${IMPORT} {\n  A,\n  B,\n} from '${spec}'\n`

describe('no participant-world or brand imports anywhere in this folder', () => {
  it('scans every source file, tests and this guard included (not zero)', () => {
    const paths = files.map(file => file.path)
    expect(new Set(paths).size).toBe(paths.length) // no file counted twice
    expect(files.length).toBeGreaterThanOrEqual(20)
    expect(paths).toEqual(expect.arrayContaining([
      './Card.tsx',
      './CardSheet.tsx',
      './CardSheetPreview.tsx',
      './PrintCardsButton.tsx',
      './cardsService.ts',
      './cardsMocks.ts',
      './useRosterCards.ts',
      './Card.test.tsx',
      './CardSheetPreview.test.tsx',
      './cardsTestUtils.tsx',
      './cardsSourceGuards.test.ts',
    ]))
  })

  it('finds no forbidden import in any file', () => {
    const violations = files.flatMap(file =>
      forbiddenImports(file.text).map(violation => `${file.path}: ${violation}`))
    expect(violations).toEqual([])
  })
})

describe('the import guard detects what it forbids (self-test)', () => {
  it.each([
    ['social by alias', staticImport('@/features/social/components/Feed')],
    ['portal by alias', staticImport('@/features/portal/Home')],
    ['news by alias', staticImport('@/features/news/Story')],
    ['weather by alias', staticImport('@/features/weather/Radar')],
    ['participant-shell by alias', staticImport('@/features/participant-shell/ShellLayout')],
    ['login by alias', staticImport('@/features/login/pages/ParticipantSignInPage')],
    ['a deep relative path to a participant feature', staticImport('../../../features/social/x')],
    ['a short relative path to a participant feature', staticImport('../../social/x')],
    ['BrandThemeProvider by module path', staticImport('./BrandThemeProvider')],
    ['BrandThemeProvider by name', staticImport('./theme', '{ BrandThemeProvider as Skin }')],
    ['BrandThemeProvider as a default import', staticImport('./theme', 'BrandThemeProvider')],
    ['a type-only import', staticImport('@/features/social/types', 'type { Post }')],
    ['a side-effect import', sideEffect('@/features/weather/radar.css')],
    ['a re-export', reExport('@/features/portal/Feed')],
    ['a dynamic import', dynamicImport('@/features/news/Story')],
    ['a require', required('../../portal/Home')],
    ['a mocked module', mocked('@/features/login/services/joinService')],
    ['a multi-line import', multiLine('@/features/social/index')],
  ])('flags %s', (_label, source) => {
    expect(forbiddenImports(source).length).toBeGreaterThan(0)
  })

  it.each([
    ['a staff feature', staticImport('@/features/staff/staffRouteRegistry')],
    ['core modules', staticImport('@/core/exerciseContext')],
    ['the staff COBRA components', staticImport('@/theme/styledComponents', '{ CobraPrimaryButton }')],
    ['a sibling file', staticImport('./Card', '{ Card }')],
    ['a relative path that only looks similar', staticImport('../socialite/x')],
    ['MUI', staticImport('@mui/material', '{ Box }')],
    ['a line comment that mentions a forbidden import', `// ${staticImport('@/features/social/x')}`],
    ['a block comment that mentions one', `/* ${staticImport('@/features/portal/x')} */`],
    ['a plain string that is not an import', "const where = 'features/social'\n"],
  ])('does not flag %s', (_label, source) => {
    expect(forbiddenImports(source)).toEqual([])
  })

  it('reports WHAT was wrong, so a failure is actionable', () => {
    const [first] = forbiddenImports(staticImport('@/features/social/components/Feed'))
    expect(first).toContain('@/features/social/components/Feed')
    expect(first).toContain('participant-surface')
  })
})

describe('the printed paper is plain (no COBRA, no MUI, no injected HTML)', () => {
  const production = files.filter(file => !isTestFile(file.path))

  it.each(['./Card.tsx', './CardSheet.tsx', './cardFormat.ts', './safeQrDataUri.ts'])(
    '%s imports neither COBRA nor MUI',
    path => {
      const file = files.find(candidate => candidate.path === path)
      expect(file).toBeDefined()
      for (const { specifier } of importsOf(file?.text ?? '')) {
        expect(specifier).not.toMatch(/^@\/theme/)
        expect(specifier).not.toMatch(/^@mui\//)
        expect(specifier).not.toMatch(/cobra/i)
      }
    },
  )

  it('the staff chrome uses the COBRA components and FontAwesome', () => {
    const preview = files.find(file => file.path === './CardSheetPreview.tsx')?.text ?? ''
    const button = files.find(file => file.path === './PrintCardsButton.tsx')?.text ?? ''
    expect(preview).toMatch(/from '@\/theme\/styledComponents'/)
    expect(button).toMatch(/from '@\/theme\/styledComponents'/)
    expect(preview + button).toMatch(/@fortawesome\/react-fontawesome/)
    expect(preview + button).not.toMatch(/@mui\/icons-material/)
  })

  it('no production file injects HTML, writes storage, lazy-loads an image or logs', () => {
    for (const { path, text } of production) {
      const code = stripComments(text)
      expect(code, path).not.toMatch(/dangerouslySetInnerHTML/)
      expect(code, path).not.toMatch(/innerHTML\s*=/)
      expect(code, path).not.toMatch(/\b(?:local|session)Storage\b/)
      expect(code, path).not.toMatch(/loading=["']lazy["']/)
      expect(code, path).not.toMatch(/\bconsole\.(?:log|info|debug|warn|error)\b/)
    }
  })

  it('finds production files to check (not zero)', () => {
    expect(production.length).toBeGreaterThanOrEqual(10)
  })
})
