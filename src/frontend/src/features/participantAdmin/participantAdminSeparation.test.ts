/**
 * features/participantAdmin/participantAdminSeparation.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — source-level guards for the staff roster screen. Reads
 * the REAL source text of the files this story owns (Vite `import.meta.glob`,
 * `?raw`; `node:fs` is deliberately not used — the app tsconfig omits Node
 * types) and fails the moment one of them breaks a rule that no behavioural
 * test could see:
 *
 *   - STAFF world: no `@mui/icons-material` (FontAwesome only), and the COBRA
 *     styled components ARE used;
 *   - no import of a participant surface (the other direction of the
 *     two-worlds gate lives in `staffShell/twoWorldsSeparation.test.ts`);
 *   - the slot seam: this story imports nothing from `dayWord/`, `cards/` or
 *     `email/` — the orchestrator composes them through `RosterPage`'s props;
 *   - SECRETS: nothing here logs, toasts, or stores anything (`console.`,
 *     `react-toastify`, `localStorage`, `sessionStorage`), and no raw HTML
 *     injection (`dangerouslySetInnerHTML`);
 *   - ISOLATION: the service and the mock adapter never mention an exercise id,
 *     so there is no way for a request to carry one.
 *
 * Scoped to the folders this story owns, so it stays valid when stories 11/12/13
 * add their own folders beside them.
 */
import { describe, expect, it } from 'vitest'

const ALL = import.meta.glob('./**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
}) as Record<string, string>

const OWNED_PREFIXES = [
  './pages/',
  './components/people/',
  './services/',
  './hooks/',
  './mocks/',
  './types.ts',
  './ParticipantAdminRoute.tsx',
]

const SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(ALL).filter(([path]) =>
    OWNED_PREFIXES.some(prefix => path.startsWith(prefix))
    && !/\.test\.tsx?$/.test(path)
    && !path.startsWith('./test/'),
  ),
)

function specifiersOf(source: string): string[] {
  const found: string[] = []
  for (const pattern of [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of source.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1])
    }
  }
  return found
}

/** Source with comments removed, so prose that merely MENTIONS a rule never trips it. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

function offenders(test: (path: string, source: string) => boolean): string[] {
  return Object.entries(SOURCES)
    .filter(([path, source]) => test(path, source))
    .map(([path]) => path)
}

describe('participantAdmin (staff roster) — source guards', () => {
  it('scans the files this story owns (cannot pass vacuously)', () => {
    const paths = Object.keys(SOURCES)
    expect(paths.length).toBeGreaterThan(15)
    expect(paths).toContain('./pages/RosterPage.tsx')
    expect(paths).toContain('./services/rosterService.ts')
    expect(paths).toContain('./mocks/rosterMocks.ts')
  })

  it('uses FontAwesome, never @mui/icons-material', () => {
    expect(offenders((_p, s) => specifiersOf(s).some(x => x.startsWith('@mui/icons-material')))).toEqual([])
  })

  it('is COBRA: the screen imports the styled components from @/theme/styledComponents', () => {
    expect(offenders((_p, s) => specifiersOf(s).includes('@/theme/styledComponents')).length)
      .toBeGreaterThan(3)
  })

  it('imports no participant surface', () => {
    const participantRoots =
      /features\/(social|portal|news|press|weather|participant-shell|login)(\/|$)/
    expect(offenders((_p, s) => specifiersOf(s).some(x => participantRoots.test(x)))).toEqual([])
  })

  it('does not import the slot folders (dayWord/, cards/, email/): the props are the seam', () => {
    const slotFolders = /(^|\/)(dayWord|cards|email)(\/|$)/
    expect(offenders((_p, s) => specifiersOf(s).some(x => slotFolders.test(x)))).toEqual([])
  })

  it('never logs, toasts, or stores anything (a join URL must not escape through any of them)', () => {
    expect(offenders((_p, s) => /\bconsole\s*\./.test(code(s)))).toEqual([])
    expect(offenders((_p, s) => specifiersOf(s).includes('react-toastify'))).toEqual([])
    expect(offenders((_p, s) => /\b(localStorage|sessionStorage)\b/.test(code(s)))).toEqual([])
    expect(offenders((_p, s) => /document\s*\.\s*cookie/.test(code(s)))).toEqual([])
  })

  it('never injects raw HTML', () => {
    expect(offenders((_p, s) => /dangerouslySetInnerHTML|innerHTML\s*=/.test(code(s)))).toEqual([])
  })

  it('never puts a join URL in a title attribute or a toast', () => {
    expect(offenders((_p, s) => /title=\{[^}]*joinUrl/.test(code(s)))).toEqual([])
  })

  it('the service and the mock adapter never mention an exercise id (so no request can carry one)', () => {
    const wire = ['./services/rosterService.ts', './mocks/rosterMocks.ts', './types.ts']
    for (const path of wire) {
      expect(SOURCES[path], path).toBeDefined()
      expect(/exercise[-_ ]?id/i.test(code(SOURCES[path] ?? '')), path).toBe(false)
    }
  })

  it('only the query/mutation hooks read the exercise id, and only to key the cache', () => {
    const readers = offenders((_p, s) => /useExerciseContext\(\)/.test(code(s)))
    expect(readers.sort()).toEqual([
      './hooks/useRoster.ts',
      './hooks/useRosterMutations.ts',
      './pages/RosterPage.tsx',
    ])
  })
})
