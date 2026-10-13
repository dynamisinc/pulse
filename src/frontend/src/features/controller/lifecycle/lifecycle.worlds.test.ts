/**
 * features/controller/lifecycle/lifecycle.worlds.test.ts
 * ---------------------------------------------------------------------------
 * The TWO-WORLDS guard for the StartEx / EndEx control (demo-polish C6). Mechanical, not a
 * promise: it reads the REAL source text of this folder and of every participant root and
 * checks module SPECIFIERS (comments stripped first, so prose that merely mentions a module
 * never trips it). A specifier is judged by the module it RESOLVES to, whatever its spelling.
 *
 *  1. STAFF side stays staff: nothing here imports participant styling, a participant surface,
 *     the participant shell, or `@mui/icons-material` (FontAwesome only).
 *  2. The control and its dialog are COBRA: buttons and text fields come from
 *     `@/theme/styledComponents`; no bare MUI `Button` / `TextField` / `IconButton`.
 *  3. PARTICIPANT side stays participant: no participant root imports this folder (the control
 *     carries the COBRA look and the power to end the exercise).
 *
 * The non-vacuity assertions require real files to have been scanned, and the extractor is
 * self-tested on synthetic sources so a dead regex fails.
 */
import { describe, expect, it } from 'vitest'

/** Where this test (and so the `./` glob) lives, as a path under `src/`. */
const THIS_DIR = 'features/controller/lifecycle'

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

/**
 * Every module specifier in `source`: static and type imports, side-effect imports,
 * dynamic `import()`, `require()`, and `export ... from` / `export * from` re-exports.
 */
function specifiersOf(source: string): string[] {
  const scannable = stripComments(source)
  const found: string[] = []
  for (const pattern of [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /export\s+(?:type\s+)?(?:\*(?:\s+as\s+\w+)?|\{[^}]*\})\s*from\s+['"]([^'"]+)['"]/g,
  ]) {
    for (const match of scannable.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1])
    }
  }
  return found
}

/** `baseDir` + `relative` ('../x', './y/z') as a normalised path under `src/`. */
function resolvePath(baseDir: string, relative: string): string {
  const parts = baseDir.split('/').filter(part => part.length > 0)
  for (const segment of relative.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join('/')
}

/** The directory (under `src/`) of a glob key like `../../social/a/B.tsx`. */
function dirOfGlobKey(globKey: string): string {
  const parts = globKey.split('/')
  parts.pop()
  return resolvePath(THIS_DIR, parts.join('/'))
}

/** The module a specifier points at, as a path under `src/` (`@/x/y` and `../../x/y` -> `x/y`). */
function resolveSpecifier(fileDir: string, specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.replace(/^@\//, '')
  if (specifier.startsWith('.')) return resolvePath(fileDir, specifier)
  return specifier
}

interface ForbiddenImport {
  readonly why: string
  readonly test: (resolved: string) => boolean
}

const FORBIDDEN_IN_STAFF: readonly ForbiddenImport[] = [
  { why: 'a CSS module (participant styling)', test: s => /\.module\.css$/.test(s) },
  { why: 'icons-material (FontAwesome only)', test: s => s.startsWith('@mui/icons-material') },
  { why: 'the participant shell', test: s => /^features\/participant-shell(\/|$)/.test(s) },
  { why: 'the Social channel', test: s => /^features\/social(\/|$)/.test(s) },
  {
    why: 'the portal / news / press / weather participant surfaces',
    test: s => /^features\/(portal|news|press|weather)(\/|$)/.test(s),
  },
]

/** Every forbidden import in `files` (globKey -> source), described one per entry. */
function staffViolations(files: Record<string, string>): string[] {
  const violations: string[] = []
  for (const [file, source] of Object.entries(files)) {
    const fileDir = dirOfGlobKey(file)
    for (const specifier of specifiersOf(source)) {
      const resolved = resolveSpecifier(fileDir, specifier)
      for (const rule of FORBIDDEN_IN_STAFF) {
        if (rule.test(resolved)) {
          violations.push(`${file} imports "${specifier}" (${resolved}) — ${rule.why}`)
        }
      }
    }
  }
  return violations
}

/** Every import of this folder in `files` (globKey -> source). */
function lifecycleImporters(files: Record<string, string>): string[] {
  const offenders: string[] = []
  for (const [file, source] of Object.entries(files)) {
    const fileDir = dirOfGlobKey(file)
    for (const specifier of specifiersOf(source)) {
      if (/^features\/controller\/lifecycle(\/|$)/.test(resolveSpecifier(fileDir, specifier))) {
        offenders.push(`${file} imports "${specifier}"`)
      }
    }
  }
  return offenders
}

/** The names imported from `module` by `source` (named imports only). */
function namedImportsFrom(source: string, module: string): string[] {
  const names: string[] = []
  const pattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s+from\\s+['"]${module}['"]`,
    'g',
  )
  for (const match of stripComments(source).matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim()
      if (name) names.push(name)
    }
  }
  return names
}

/** The component files that must be COBRA (buttons / fields from `styledComponents`). */
const COBRA_COMPONENT_FILES = ['ExerciseLifecycleControl', 'EndExerciseDialog']

describe('the StartEx / EndEx control stays in the STAFF world', () => {
  it('scans real files (cannot pass vacuously)', () => {
    expect(Object.keys(FEATURE_SOURCES).length).toBeGreaterThanOrEqual(6)
    expect(Object.keys(FEATURE_SOURCES).some(path => path.endsWith('ExerciseLifecycleControl.tsx'))).toBe(true)
    expect(Object.keys(PARTICIPANT_SOURCES).length).toBeGreaterThan(50)
  })

  it('imports no participant surface, participant styling, the participant shell, or icons-material', () => {
    expect(staffViolations(FEATURE_SOURCES)).toEqual([])
  })

  it('the control and its dialog are COBRA: styledComponents buttons + fields, no bare MUI Button/TextField', () => {
    const componentFiles = Object.entries(FEATURE_SOURCES).filter(([path]) =>
      new RegExp(`(${COBRA_COMPONENT_FILES.join('|')})\\.tsx$`).test(path))
    expect(componentFiles).toHaveLength(2)

    const cobraNames = componentFiles.flatMap(([, source]) =>
      namedImportsFrom(source, '@/theme/styledComponents'))
    expect(cobraNames).toEqual(expect.arrayContaining([
      'CobraPrimaryButton', 'CobraSecondaryButton', 'CobraDeleteButton', 'CobraLinkButton', 'CobraTextField',
    ]))

    for (const [file, source] of componentFiles) {
      const bare = namedImportsFrom(source, '@mui/material')
        .filter(name => ['Button', 'TextField', 'IconButton', 'Fab', 'ToggleButton'].includes(name))
      expect({ file, bare }).toEqual({ file, bare: [] })
    }
  })

  it('draws its icons from FontAwesome', () => {
    const control = Object.entries(FEATURE_SOURCES).find(([path]) => path.endsWith('ExerciseLifecycleControl.tsx'))
    expect(control).toBeDefined()
    const specifiers = specifiersOf(control?.[1] ?? '')
    expect(specifiers).toContain('@fortawesome/react-fontawesome')
    expect(specifiers).toContain('@fortawesome/free-solid-svg-icons')
  })
})

describe('participant surfaces never import the StartEx / EndEx control', () => {
  it('no participant root imports this folder', () => {
    expect(lifecycleImporters(PARTICIPANT_SOURCES)).toEqual([])
  })
})

describe('the scanners are not dead (self-test on synthetic sources)', () => {
  it('finds every import form, ignoring prose in comments', () => {
    const source = [
      "import a from '@/features/social/x'",
      "import type { B } from '../../participant-shell/y'",
      "import '@mui/icons-material/Add'",
      "const c = await import('./z.module.css')",
      "export { d } from '../../portal/w'",
      "// import nope from '@/features/social/commented'",
      "/* import nope2 from '@/features/news/commented' */",
    ].join('\n')

    expect(specifiersOf(source)).toEqual([
      '@/features/social/x',
      '../../participant-shell/y',
      '@mui/icons-material/Add',
      './z.module.css',
      '../../portal/w',
    ])
  })

  it('flags a participant import in either spelling, and passes a clean staff one', () => {
    const files = {
      '../bad/A.tsx': "import { SocialChannel } from '@/features/social'",
      '../bad/B.tsx': "import s from './a.module.css'",
      '../bad/C.tsx': "import { Add } from '@mui/icons-material'",
    }
    // THIS_DIR is features/controller/lifecycle, so ../bad is features/controller/bad.
    expect(staffViolations(files)).toHaveLength(3)
    expect(staffViolations({ '../bad/D.tsx': "import { CobraPrimaryButton } from '@/theme/styledComponents'" })).toEqual([])
    expect(lifecycleImporters({ '../../social/E.tsx': "import x from '../controller/lifecycle'" })).toHaveLength(1)
  })
})
