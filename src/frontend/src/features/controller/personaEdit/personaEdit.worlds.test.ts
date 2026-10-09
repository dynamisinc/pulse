/**
 * features/controller/personaEdit/personaEdit.worlds.test.ts
 * ---------------------------------------------------------------------------
 * The TWO-WORLDS guard for the persona profile edit (demo-polish story 21 /
 * PE-FE; story Tests: "no participant-style import"). Mechanical, not a promise:
 * it reads the REAL source text of this folder and of every participant root and
 * checks module SPECIFIERS (comments stripped first, so prose that merely
 * mentions a module never trips it).
 *
 * A specifier is judged by the module it RESOLVES to, whatever its spelling:
 * `@/features/social/...` and `../../social/...` are the same import, so the
 * relative form cannot slip past an alias-only pattern (Gate-1 L-9). Static
 * imports, side-effect imports, dynamic `import()`, `require()` and RE-EXPORTS
 * (`export { x } from '...'`, `export * from '...'`) are all edges.
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
 * The non-vacuity assertions require real files to have been scanned, and the
 * extractor / resolver are self-tested on synthetic sources so a dead regex fails.
 */
import { describe, expect, it } from 'vitest'

/** Where this test (and so the `./` glob) lives, as a path under `src/`. */
const THIS_DIR = 'features/controller/personaEdit'

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

/**
 * The module a specifier points at, as a path under `src/` for anything inside the
 * app (`@/x/y` and `../../x/y` both become `x/y`); a package name is returned as is.
 */
function resolveSpecifier(fileDir: string, specifier: string): string {
  if (specifier.startsWith('@/')) return specifier.replace(/^@\//, '')
  if (specifier.startsWith('.')) return resolvePath(fileDir, specifier)
  return specifier
}

/** The only participant-tree modules the staff feature may import: pure and world-neutral. */
const ALLOWED_SOCIAL_IMPORTS: readonly string[] = [
  'features/social/components/media/safeMediaUrl',
  'features/social/services/sanitize',
]

interface ForbiddenImport {
  readonly why: string
  /** `resolved` is the specifier resolved to a path under `src/` (or a package name). */
  readonly test: (resolved: string) => boolean
}

const FORBIDDEN_IN_STAFF: readonly ForbiddenImport[] = [
  { why: 'a CSS module (participant styling)', test: s => /\.module\.css$/.test(s) },
  { why: 'icons-material (FontAwesome only)', test: s => s.startsWith('@mui/icons-material') },
  { why: 'the participant shell', test: s => /^features\/participant-shell(\/|$)/.test(s) },
  { why: 'the participant social theme', test: s => /^features\/social\/theme(\/|$)/.test(s) },
  {
    why: 'a participant social module other than the two pure helpers',
    test: s => /^features\/social(\/|$)/.test(s) && !ALLOWED_SOCIAL_IMPORTS.includes(s),
  },
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
function personaEditImporters(files: Record<string, string>): string[] {
  const offenders: string[] = []
  for (const [file, source] of Object.entries(files)) {
    const fileDir = dirOfGlobKey(file)
    for (const specifier of specifiersOf(source)) {
      if (/^features\/controller\/personaEdit(\/|$)/.test(resolveSpecifier(fileDir, specifier))) {
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
const DIALOG_FILES = [
  'PersonaEditDialog',
  'ImageChooser',
  'VerifiedConfirmDialog',
  'DiscardChangesDialog',
  'PersonaEditButton',
]

describe('the persona edit stays in the STAFF world', () => {
  it('scans real files (cannot pass vacuously)', () => {
    expect(Object.keys(FEATURE_SOURCES).length).toBeGreaterThanOrEqual(8)
    expect(Object.keys(FEATURE_SOURCES).some(path => path.endsWith('PersonaEditDialog.tsx')))
      .toBe(true)
    expect(Object.keys(PARTICIPANT_SOURCES).length).toBeGreaterThan(50)
  })

  it('imports no participant styling, no icons-material, and only two pure social helpers', () => {
    expect(staffViolations(FEATURE_SOURCES)).toEqual([])
  })

  it('actually uses the allowed helpers it is permitted (the allow-list is not dead weight)', () => {
    const resolved = Object.entries(FEATURE_SOURCES).flatMap(([file, source]) =>
      specifiersOf(source).map(specifier => resolveSpecifier(dirOfGlobKey(file), specifier)))
    for (const allowed of ALLOWED_SOCIAL_IMPORTS) expect(resolved).toContain(allowed)
  })

  it('the dialogs are COBRA: styledComponents buttons + fields, no bare MUI Button/TextField', () => {
    const dialogFiles = Object.entries(FEATURE_SOURCES).filter(([path]) =>
      new RegExp(`(${DIALOG_FILES.join('|')})\\.tsx$`).test(path))
    expect(dialogFiles).toHaveLength(5)

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
  it('finds no import of controller/personaEdit — alias OR relative — under any participant root', () => {
    expect(personaEditImporters(PARTICIPANT_SOURCES)).toEqual([])
  })
})

describe('the guard itself (self-tests on synthetic sources)', () => {
  // A synthetic file in this folder: relative paths resolve from features/controller/personaEdit.
  const here = './Synthetic.tsx'

  it('extracts static, type, side-effect, dynamic, require and RE-EXPORT specifiers; ignores comments', () => {
    const sample = [
      "import { A } from '@/features/social/components/Avatar'",
      "import type { B } from '../../social/types/post'",
      "import '../../social/theme/social.css'",
      "const lazy = () => import('../../participant-shell/ShellLayout')",
      "const legacy = require('../../portal/x')",
      "export { C } from '../../social/components/PostCard'",
      "export * from '../../news/all'",
      "export type { D } from '@/features/weather/types'",
      "export * as E from '../../press/ns'",
      "// import { Z } from '../../social/commented'",
      "/* export { Y } from '../../social/blockcommented' */",
    ].join('\n')
    expect([...specifiersOf(sample)].sort()).toEqual([
      '@/features/social/components/Avatar',
      '@/features/weather/types',
      '../../news/all',
      '../../participant-shell/ShellLayout',
      '../../portal/x',
      '../../press/ns',
      '../../social/components/PostCard',
      '../../social/theme/social.css',
      '../../social/types/post',
    ].sort())
  })

  it('resolves relative and alias specifiers to the same module path', () => {
    const dir = dirOfGlobKey(here)
    expect(dir).toBe(THIS_DIR)
    expect(resolveSpecifier(dir, '../../social/components/Avatar'))
      .toBe('features/social/components/Avatar')
    expect(resolveSpecifier(dir, '@/features/social/components/Avatar'))
      .toBe('features/social/components/Avatar')
    expect(resolveSpecifier(dir, './textRules')).toBe('features/controller/personaEdit/textRules')
    expect(resolveSpecifier(dir, '@mui/material')).toBe('@mui/material')
    // From a participant file, two levels up lands back on the controller tree.
    expect(resolveSpecifier(
      dirOfGlobKey('../../social/components/X.tsx'),
      '../../controller/personaEdit/PersonaEditButton',
    )).toBe('features/controller/personaEdit/PersonaEditButton')
  })

  it('catches a RELATIVE participant import and a re-export, not just the alias form', () => {
    const violations = staffViolations({
      [here]: [
        "import { Avatar } from '../../social/components/Avatar'",
        "import styles from '../../social/components/PostCard.module.css'",
        "export { SocialBrandScope } from '../../social/theme/SocialBrandScope'",
        "export * from '../../participant-shell'",
        "import { Icon } from '@mui/icons-material/Add'",
        "import { Also } from '@/features/social'",
      ].join('\n'),
    })
    const flagged = new Set(violations.map(violation => violation.split('"')[1]))
    expect([...flagged].sort()).toEqual([
      '../../participant-shell',
      '../../social/components/Avatar',
      '../../social/components/PostCard.module.css',
      '../../social/theme/SocialBrandScope',
      '@/features/social',
      '@mui/icons-material/Add',
    ])
  })

  it('allows the two pure helpers in either spelling, and the feature\'s own / core imports', () => {
    expect(staffViolations({
      [here]: [
        "import { resolveSafeMediaUrl } from '@/features/social/components/media/safeMediaUrl'",
        "import { sanitizeText } from '../../social/services/sanitize'",
        "import { x } from './textRules'",
        "import { y } from '@/core/media'",
        "import { z } from '@/theme/styledComponents'",
      ].join('\n'),
    })).toEqual([])
  })

  it('finds a participant file importing this folder — alias, relative and re-export', () => {
    const offenders = personaEditImporters({
      '../../social/a/One.tsx':
        "import { PersonaEditButton } from '@/features/controller/personaEdit'",
      '../../social/a/Two.tsx':
        "import { PersonaEditButton } from '../../controller/personaEdit/PersonaEditButton'",
      '../../portal/Three.tsx': "export { PersonaEditButton } from '../controller/personaEdit'",
      '../../social/a/Four.tsx': "import { fine } from '../../controller/other'",
    })
    expect(offenders).toHaveLength(3)
  })
})
