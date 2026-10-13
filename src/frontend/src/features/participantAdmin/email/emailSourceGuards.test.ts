/**
 * features/participantAdmin/email/emailSourceGuards.test.ts
 * ---------------------------------------------------------------------------
 * Source guards for story 13's folder, read off the REAL source text (Vite's eager `?raw`
 * glob), in the spirit of `cards/cardsSourceGuards.test.ts` and
 * `participantAdminSeparation.test.ts`:
 *   - STAFF world: COBRA styled components, FontAwesome only (no `@mui/icons-material`);
 *   - no participant-surface or brand-theme import;
 *   - SECRETS: nothing logs, toasts or stores (`console.`, `react-toastify`,
 *     `localStorage`, `sessionStorage`, cookies), no raw HTML injection;
 *   - ISOLATION: the service and the mock never mention an exercise id;
 *   - the folder never reads a join URL or an email address off a roster row except to
 *     test that one exists (`looksEmailable`).
 */
import { describe, expect, it } from 'vitest'

const ALL = import.meta.glob('./*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' }) as Record<
  string,
  string
>

/** Production files only (tests and test utils excluded). */
const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(ALL).filter(([path]) => !/\.test\.tsx?$/.test(path) && !path.includes('emailTestUtils')),
)

function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function specifiersOf(source: string): string[] {
  const found: string[] = []
  for (const pattern of [
    /(?:import|export)\s+[^'";]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of code(source).matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1])
    }
  }
  return found
}

function offenders(test: (path: string, source: string) => boolean): string[] {
  return Object.entries(SOURCES)
    .filter(([path, source]) => test(path, source))
    .map(([path]) => path)
}

describe('participantAdmin/email - source guards', () => {
  it('scans the folder (cannot pass vacuously)', () => {
    expect(Object.keys(SOURCES)).toEqual(expect.arrayContaining([
      './EmailLinksButton.tsx',
      './emailLinksService.ts',
      './emailLinksMocks.ts',
      './emailLinksFormat.ts',
      './useRosterSnapshot.ts',
      './index.ts',
      './types.ts',
    ]))
  })

  it('is COBRA and FontAwesome', () => {
    expect(specifiersOf(SOURCES['./EmailLinksButton.tsx'] ?? '')).toContain('@/theme/styledComponents')
    const muiIcons = (s: string) => specifiersOf(s).some(x => x.startsWith('@mui/icons-material'))
    expect(offenders((_p, s) => muiIcons(s))).toEqual([])
  })

  it('imports no participant surface and no brand theme', () => {
    const roots = 'social|portal|news|press|weather|participant-shell|login'
    const participantRoots = new RegExp(`features/(${roots})(/|$)`)
    const participantImport = (s: string) => specifiersOf(s).some(x => participantRoots.test(x))
    expect(offenders((_p, s) => participantImport(s))).toEqual([])
    expect(offenders((_p, s) => /BrandThemeProvider/.test(code(s)))).toEqual([])
  })

  it('never logs, toasts, stores or injects HTML', () => {
    expect(offenders((_p, s) => /\bconsole\s*\./.test(code(s)))).toEqual([])
    expect(offenders((_p, s) => specifiersOf(s).includes('react-toastify'))).toEqual([])
    expect(offenders((_p, s) => /\b(localStorage|sessionStorage)\b/.test(code(s)))).toEqual([])
    expect(offenders((_p, s) => /document\s*\.\s*cookie/.test(code(s)))).toEqual([])
    expect(offenders((_p, s) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(code(s)))).toEqual([])
  })

  it('never names an exercise id in a request (the server scopes everything)', () => {
    for (const path of ['./emailLinksService.ts', './emailLinksMocks.ts']) {
      expect(code(SOURCES[path] ?? '')).not.toMatch(/exerciseId/i)
    }
  })

  it('never reads a join URL, and reads an email address only to test that one exists', () => {
    expect(offenders((_p, s) => /joinUrl/.test(code(s)))).toEqual([])
    expect(offenders((path, s) => path !== './emailLinksFormat.ts' && /\.email\b/.test(code(s)))).toEqual([])
  })
})
