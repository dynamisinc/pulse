/**
 * features/login/pages/JoinPage.boundary.test.ts
 * ---------------------------------------------------------------------------
 * Easy-login story 08, cross-cutting "No-enterprise-look (D0 §2)" and "Content
 * security (NFR-004)": a SOURCE-SCAN guard that the join page and its service stay
 * in the PARTICIPANT world.
 *
 * It reads the REAL source of `JoinPage.tsx` and `joinService.ts` with
 * `import.meta.glob(…, { query: '?raw', eager: true })` (the technique
 * `features/staffShell/twoWorldsSeparation.test.ts` uses; `node:fs` is deliberately
 * not used because the app TypeScript program has no Node types) and FAILS on any
 * import of:
 *   - `@mui/*`  (the join page is plain HTML + a CSS Module; no default MUI look,
 *                no `@mui/icons-material` either: icons are FontAwesome only),
 *   - `@/theme/*`, `cobraTheme`, `styledComponents`, `CobraStyles` (the COBRA
 *     staff-world look must never reach a participant page),
 *   - the staff roster screen, `features/participantAdmin/*` (join URLs and
 *     sign-in credentials live there).
 * The scan is specifier-only (imports, side-effect imports, dynamic `import()`,
 * `require()`), so a comment that merely MENTIONS "COBRA" does not trip it.
 *
 * Two non-vacuity guards keep it honest: the glob must actually find the two
 * production files (and no test file: `.test.` files are excluded by negative
 * glob patterns, because this very file spells out forbidden specifiers in its
 * fixtures), and the detector is proven to bite on a fixture for each forbidden
 * specifier before it is trusted on the real files.
 *
 * It also pins the rest of the participant-world house rules that a reviewer
 * would otherwise check by eye, on the comment-stripped source: no `sx` prop, no
 * `dangerouslySetInnerHTML`, no `console.*` call (the token is a credential), the
 * skin is the page's own CSS Module, and icons come from FontAwesome.
 */
import { describe, expect, it } from 'vitest'

/** Specifiers that would pull the staff world, or a default MUI look, into this page. */
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^@mui(\/|$)/, // @mui/material, @mui/icons-material, @mui/system, ...
  /^@\/theme(\/|$)/, // @/theme/cobraTheme, @/theme/styledComponents, @/theme/CobraStyles, ...
  /^(\.\.?\/)+theme(\/|$)/, // the same, reached by a relative path
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  /(^|\/)participantAdmin(\/|$)/, // the STAFF roster screen
]

/** Every static / side-effect / dynamic import and `require` specifier in a source file. */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const specifier = match[1]
      if (specifier !== undefined) specifiers.push(specifier)
    }
  }
  return specifiers
}

interface Violation {
  file: string
  specifier: string
}

function findViolations(filesByPath: Record<string, string>): Violation[] {
  const violations: Violation[] = []
  for (const [file, source] of Object.entries(filesByPath)) {
    for (const specifier of extractImportSpecifiers(source)) {
      if (FORBIDDEN_SPECIFIER_PATTERNS.some(pattern => pattern.test(specifier))) {
        violations.push({ file, specifier })
      }
    }
  }
  return violations
}

/** Strips comments so the file headers (which discuss the ban) never trip a code check. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

// The page and the service, as raw text. Negative patterns drop every test file
// (this one included: its fixtures contain the forbidden specifiers on purpose).
const JOIN_SOURCES = import.meta.glob(
  [
    './JoinPage*.{ts,tsx}',
    '../services/joinService*.ts',
    '!./**/*.test.*',
    '!../services/**/*.test.*',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const PAGE_SOURCE = JOIN_SOURCES['./JoinPage.tsx'] ?? ''
const SERVICE_SOURCE = JOIN_SOURCES['../services/joinService.ts'] ?? ''

describe('the detector (so the scan below cannot pass vacuously)', () => {
  const violationsFor = (specifier: string) =>
    findViolations({ 'fixture.tsx': `import { Thing } from '${specifier}'` })

  it.each([
    '@mui/material',
    '@mui/material/Button',
    '@mui/icons-material',
    '@mui/icons-material/Warning',
    '@mui/system',
    '@/theme/cobraTheme',
    '@/theme/styledComponents',
    '@/theme/CobraStyles',
    '@/theme',
    '../../theme/cobraTheme',
    '../../../theme/styledComponents',
    '@/features/participantAdmin/pages/RosterPage',
  ])('flags an import of %s', specifier => {
    expect(violationsFor(specifier)).toEqual([{ file: 'fixture.tsx', specifier }])
  })

  it.each([
    "import '@mui/material/styles'",
    "const m = await import('@mui/material')",
    "const m = require('@/theme/cobraTheme')",
  ])('flags the non-default import form: %s', source => {
    expect(findViolations({ 'fixture.tsx': source })).toHaveLength(1)
  })

  it.each([
    'react',
    'react-router-dom',
    '@tanstack/react-query',
    '@fortawesome/react-fontawesome',
    '@fortawesome/free-solid-svg-icons',
    '@/core/auth',
    '@/features/app-shell/constants',
    './JoinPage.module.css',
    '../services/joinService',
  ])('does not flag %s', specifier => {
    expect(violationsFor(specifier)).toEqual([])
  })

  it('ignores prose that merely mentions a forbidden name', () => {
    expect(findViolations({
      'fixture.tsx': "/* NO @mui/material, NO cobraTheme */\nimport { x } from 'react'",
    })).toEqual([])
  })
})

describe('the join page and its service stay in the participant world (D0 §2)', () => {
  it('scans the page and the service, and no test file', () => {
    const files = Object.keys(JOIN_SOURCES)
    expect(files).toContain('./JoinPage.tsx')
    expect(files).toContain('../services/joinService.ts')
    expect(files.filter(file => /\.test\./.test(file))).toEqual([])
    expect(PAGE_SOURCE.length).toBeGreaterThan(0)
    expect(SERVICE_SOURCE.length).toBeGreaterThan(0)
  })

  it('imports no @mui/*, @/theme/*, cobraTheme, styledComponents or CobraStyles', () => {
    const violations = findViolations(JOIN_SOURCES)

    if (violations.length > 0) {
      const detail = violations.map(v => `  ${v.file} imports "${v.specifier}"`).join('\n')
      throw new Error(
        `The join page / service import staff-world or default-MUI modules (D0 §2 two-worlds rule):\n${detail}`,
      )
    }
    expect(violations).toEqual([])
  })

  it('draws its skin from its own CSS Module and its icons from FontAwesome', () => {
    const imports = extractImportSpecifiers(PAGE_SOURCE)

    expect(imports).toContain('./JoinPage.module.css')
    expect(imports).toContain('@fortawesome/react-fontawesome')
    expect(imports).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('does not import the sign-in page or its stylesheet (story 09 owns those)', () => {
    const imports = extractImportSpecifiers(PAGE_SOURCE)

    expect(imports.filter(specifier => /ParticipantSignInPage/.test(specifier))).toEqual([])
  })

  it('is sx-free (no MUI system props, no inline style objects)', () => {
    const code = stripComments(PAGE_SOURCE)

    expect(code).not.toMatch(/\bsx\s*=/)
    expect(code).not.toMatch(/\bstyle\s*=\s*\{/)
  })

  it('never injects raw HTML (NFR-004: the exercise name is a React text node)', () => {
    for (const source of [PAGE_SOURCE, SERVICE_SOURCE]) {
      expect(stripComments(source)).not.toMatch(
        /dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/,
      )
    }
  })

  it('has no console call at all (the link token is a credential)', () => {
    for (const source of [PAGE_SOURCE, SERVICE_SOURCE]) {
      expect(stripComments(source)).not.toMatch(/\bconsole\s*\./)
    }
  })

  it('never reads or writes a token to a URL, a storage area or a cookie itself', () => {
    for (const source of [PAGE_SOURCE, SERVICE_SOURCE]) {
      expect(stripComments(source)).not.toMatch(/localStorage|sessionStorage|document\.cookie/)
    }
  })
})
