/**
 * features/controller/personaEdit/personaEdit.worlds.test.ts
 * ---------------------------------------------------------------------------
 * The TWO-WORLDS guard for the persona profile edit (demo-polish story 21 /
 * PE-FE; story Tests: "no participant-style import"). Mechanical, not a promise:
 * it reads the REAL source text of this folder and of every participant root and
 * checks module SPECIFIERS (comments stripped first, so prose that merely
 * mentions a module never trips it).
 *
 *  1. STAFF side stays staff: nothing here imports participant styling — no
 *     `.module.css`, no participant theme / Avatar / PostCard / shell, and no
 *     `@mui/icons-material`. The only `social` imports allowed are two pure,
 *     world-neutral helpers (the media URL allow-list and the text sanitizer).
 *  2. The dialog is COBRA: it takes its buttons and text fields from
 *     `@/theme/styledComponents` and imports no bare MUI `Button` / `TextField`.
 *  3. PARTICIPANT side stays participant: no participant root imports this folder
 *     (it carries the COBRA look and the staff-only `personaType`).
 *  4. Text is never cut: no `.slice()` / `.substring()` / `.substr()` and no
 *     `maxLength` in the feature's source (a cut through a surrogate pair is a
 *     server 400 — see `textRules.ts`).
 *
 * The non-vacuity assertions require real files to have been scanned.
 */
import { describe, expect, it } from 'vitest'

const ownFiles = import.meta.glob('./*.{ts,tsx}', { eager: true, query: '?raw', import: 'default' })
const socialFiles = import.meta.glob('../../social/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const shellFiles = import.meta.glob('../../participant-shell/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const portalFiles = import.meta.glob('../../portal/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const newsFiles = import.meta.glob('../../news/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const pressFiles = import.meta.glob('../../press/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const weatherFiles = import.meta.glob('../../weather/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})

const isTestFile = (path: string) => /\.test\.|\.testUtils\./.test(path)

/** This folder's production sources (no tests, no test harness). */
const FEATURE_SOURCES: Record<string, string> = Object.fromEntries(
  Object.entries(ownFiles as Record<string, string>).filter(([path]) => !isTestFile(path)),
)

const PARTICIPANT_SOURCES: Record<string, string> = {
  ...(socialFiles as Record<string, string>),
  ...(shellFiles as Record<string, string>),
  ...(portalFiles as Record<string, string>),
  ...(newsFiles as Record<string, string>),
  ...(pressFiles as Record<string, string>),
  ...(weatherFiles as Record<string, string>),
}

/** Strips comments but leaves string literals intact (so `'//'` inside a string survives). */
function stripComments(source: string): string {
  return source.replace(
    /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, stringLiteral: string | undefined) => (stringLiteral === undefined ? '' : match),
  )
}

/** Every module specifier (static, side-effect, dynamic, require) in `source`. */
function specifiersOf(source: string): string[] {
  const scannable = stripComments(source)
  const found: string[] = []
  for (const pattern of [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of scannable.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1])
    }
  }
  return found
}

/** The names imported from `module` by `source` (named imports only). */
function namedImportsFrom(source: string, module: string): string[] {
  const names: string[] = []
  const pattern = new RegExp(`import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${module}['"]`, 'g')
  for (const match of stripComments(source).matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim()
      if (name) names.push(name)
    }
  }
  return names
}

/** The only participant-tree modules the staff feature may import: pure and world-neutral. */
const ALLOWED_SOCIAL_IMPORTS: readonly string[] = [
  '@/features/social/components/media/safeMediaUrl',
  '@/features/social/services/sanitize',
]

interface ForbiddenImport {
  readonly why: string
  readonly test: (specifier: string) => boolean
}

const FORBIDDEN_IN_STAFF: readonly ForbiddenImport[] = [
  { why: 'a CSS module (participant styling)', test: s => /\.module\.css$/.test(s) },
  { why: 'icons-material (FontAwesome only)', test: s => s.startsWith('@mui/icons-material') },
  { why: 'the participant shell', test: s => s.includes('participant-shell') },
  { why: 'the participant social theme', test: s => /social\/theme/.test(s) },
  {
    why: 'a participant social module other than the two pure helpers',
    test: s => /(^|\/)features\/social(\/|$)/.test(s) && !ALLOWED_SOCIAL_IMPORTS.includes(s),
  },
  { why: 'the portal/news/press/weather participant surfaces', test: s => /features\/(portal|news|press|weather)(\/|$)/.test(s) },
]

describe('the persona edit stays in the STAFF world', () => {
  it('scans real files (cannot pass vacuously)', () => {
    expect(Object.keys(FEATURE_SOURCES).length).toBeGreaterThanOrEqual(8)
    expect(Object.keys(FEATURE_SOURCES).some(path => path.endsWith('PersonaEditDialog.tsx'))).toBe(true)
    expect(Object.keys(PARTICIPANT_SOURCES).length).toBeGreaterThan(50)
  })

  it('imports no participant styling, no icons-material, and only two pure social helpers', () => {
    const violations: string[] = []
    for (const [file, source] of Object.entries(FEATURE_SOURCES)) {
      for (const specifier of specifiersOf(source)) {
        for (const rule of FORBIDDEN_IN_STAFF) {
          if (rule.test(specifier)) violations.push(`${file} imports "${specifier}" — ${rule.why}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('actually uses the allowed helpers it is permitted (the allow-list is not dead weight)', () => {
    const all = Object.values(FEATURE_SOURCES).flatMap(specifiersOf)
    for (const allowed of ALLOWED_SOCIAL_IMPORTS) expect(all).toContain(allowed)
  })

  it('the dialog is COBRA: styledComponents buttons + text fields, no bare MUI Button/TextField', () => {
    const dialogFiles = Object.entries(FEATURE_SOURCES).filter(([path]) =>
      /(PersonaEditDialog|ImageChooser|VerifiedConfirmDialog|PersonaEditButton)\.tsx$/.test(path))
    expect(dialogFiles).toHaveLength(4)

    const cobraNames = dialogFiles.flatMap(([, source]) =>
      namedImportsFrom(source, '@/theme/styledComponents'))
    expect(cobraNames).toEqual(expect.arrayContaining([
      'CobraPrimaryButton', 'CobraSecondaryButton', 'CobraLinkButton', 'CobraTextField',
    ]))

    for (const [file, source] of dialogFiles) {
      const bare = namedImportsFrom(source, '@mui/material')
        .filter(name => ['Button', 'TextField', 'IconButton', 'Fab', 'ToggleButton'].includes(name))
      expect({ file, bare }).toEqual({ file, bare: [] })
    }
  })

  it('never cuts user text: no slice / substring / substr / maxLength in the feature source', () => {
    const offenders: string[] = []
    for (const [file, source] of Object.entries(FEATURE_SOURCES)) {
      const code = stripComments(source)
      for (const pattern of [/\.slice\(/, /\.substring\(/, /\.substr\(/, /maxLength/]) {
        if (pattern.test(code)) offenders.push(`${file}: ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

describe('participant surfaces never import the persona edit', () => {
  it('finds no import of controller/personaEdit under any participant root', () => {
    const offenders: string[] = []
    for (const [file, source] of Object.entries(PARTICIPANT_SOURCES)) {
      for (const specifier of specifiersOf(source)) {
        if (/controller\/personaEdit/.test(specifier)) offenders.push(`${file} imports "${specifier}"`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the extractor really finds a forbidden import (guard against a dead regex)', () => {
    const sample = [
      "import { PersonaEditButton } from '@/features/controller/personaEdit'",
      "// import { x } from '@/features/controller/personaEdit/commented'",
      "const lazy = () => import('../../controller/personaEdit/PersonaEditButton')",
    ].join('\n')
    expect(specifiersOf(sample)).toEqual([
      '@/features/controller/personaEdit',
      '../../controller/personaEdit/PersonaEditButton',
    ])
  })
})
