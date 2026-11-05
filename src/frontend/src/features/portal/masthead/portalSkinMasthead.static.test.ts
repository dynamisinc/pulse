/**
 * Static rules over the portal skin + masthead source (exercise-portal story 06, #771):
 *  - AC1 / D0 §2: no COBRA theme, no `@/theme/styledComponents`, no MUI component and no
 *    MUI icons (the skin may use MUI's `styles` only through F13).
 *  - AC4 / COR-053: no wall-clock (`Date.now`, `new Date()`) and no `toLocale*` / browser-
 *    zone getters anywhere in either folder.
 *  - AC6: the masthead stylesheet keeps 320 px free of horizontal scroll (the name line
 *    truncates, no fixed width wider than a phone, the tagline drops on phones).
 * Read off disk, so it covers every file added to the folders later.
 */
import { describe, expect, it } from 'vitest'
import { readSrcFile } from '@/test/readSource'
import { extractImportSpecifiers, FORBIDDEN_SPECIFIER_PATTERNS } from '@/test/twoWorlds'

const SOURCES = import.meta.glob([
  '../skin/**/*.{ts,tsx}',
  './**/*.{ts,tsx}',
  '!../skin/**/*.test.{ts,tsx}',
  '!./**/*.test.{ts,tsx}',
], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const CSS = readSrcFile('features/portal/masthead/PortalMasthead.module.css')

/** Strips comments so prose that names a banned API is ignored. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1')
}

const CLOCK_BANS: readonly RegExp[] = [
  /\bDate\s*(\.\s*now|\[\s*['"]now['"]\s*\])/,
  /\bnew\s+Date\s*(\(\s*\)|(?!\s*\())/,
  /\bperformance\s*\.\s*now/,
  /\.toLocale[A-Za-z]*\s*\(/,
  /\.get(Hours|Minutes|Seconds|Date|Day|Month|FullYear|Year|TimezoneOffset)\s*\(/,
  /\.to(Time|Date)String\s*\(/,
  /\bIntl\s*\.\s*DateTimeFormat\b/,
]

const files = Object.entries(SOURCES)

describe('portal skin + masthead: static rules', () => {
  it('covers both folders', () => {
    expect(files.map(([path]) => path)).toEqual(expect.arrayContaining([
      '../skin/portalTokens.ts',
      '../skin/PortalSkinScope.tsx',
      './PortalMasthead.tsx',
      './mastheadDateline.ts',
      './mastheadTone.ts',
    ]))
  })

  it.each(files)('%s imports no COBRA theme, no styledComponents, no MUI component (AC1)', (_p, source) => {
    for (const specifier of extractImportSpecifiers(source)) {
      for (const pattern of FORBIDDEN_SPECIFIER_PATTERNS) expect(specifier).not.toMatch(pattern)
      expect(specifier).not.toMatch(/^@mui\//)
    }
  })

  it.each(files)('%s never reads wall-clock or the browser zone (AC4)', (_p, source) => {
    const body = code(source)
    for (const banned of CLOCK_BANS) expect(body, String(banned)).not.toMatch(banned)
  })

  it('the bans are not vacuous', () => {
    for (const evasion of ['Date.now()', 'new Date()', 'x.toLocaleDateString()', 'd.getHours()']) {
      expect(CLOCK_BANS.some(banned => banned.test(evasion)), evasion).toBe(true)
    }
    // Built at runtime: an import-shaped LITERAL here would itself trip the repo's
    // two-worlds gate (`staffShell/twoWorldsSeparation.test.ts`), which scans this file.
    const staffSpecifier = ['@', 'theme', 'cobraTheme'].join('/')
    expect(extractImportSpecifiers(`import { cobraTheme } from '${staffSpecifier}'`)
      .some(s => FORBIDDEN_SPECIFIER_PATTERNS.some(p => p.test(s)))).toBe(true)
  })

  it('the masthead never sets a fixed width wider than a 320 px phone (AC6)', () => {
    for (const match of code(CSS).matchAll(/(?:^|[\s;{])(min-)?width:\s*(\d+)px/g)) {
      expect(Number(match[2])).toBeLessThanOrEqual(320)
    }
    expect(code(CSS)).not.toMatch(/100vw/)
  })

  it('the name line truncates instead of scrolling, and the tagline drops on phones (AC6)', () => {
    const body = code(CSS)
    const rule = (selector: string) => new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`).exec(body)?.[1] ?? ''
    expect(rule('name')).toMatch(/white-space:\s*nowrap/)
    expect(rule('name')).toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('name')).toMatch(/min-width:\s*0/)
    expect(rule('brand')).toMatch(/min-width:\s*0/)
    expect(rule('masthead')).toMatch(/max-width:\s*100%/)
    expect(rule('tagline')).toMatch(/display:\s*none/)
    // A long zone name wraps the dateline under the tagline instead of clipping.
    expect(rule('metaLine')).toMatch(/flex-wrap:\s*wrap/)
    expect(rule('dateline')).toMatch(/min-width:\s*0/)
    expect(rule('dateline')).not.toMatch(/white-space:\s*nowrap/)
    // Wide hero content cannot widen the page (the header itself no longer clips).
    expect(rule('hero')).toMatch(/max-width:\s*100%/)
    expect(rule('hero')).toMatch(/overflow-x:\s*clip/)
    // Nothing clips the alerts entry's focus ring (story 14).
    expect(rule('masthead')).not.toMatch(/overflow:\s*hidden/)
    // Only the skin's variables colour the masthead (no raw colour literals).
    expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}\b/)
  })
})
