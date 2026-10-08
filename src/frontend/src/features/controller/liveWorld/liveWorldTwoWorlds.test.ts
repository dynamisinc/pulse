/**
 * features/controller/liveWorld/liveWorldTwoWorlds.test.ts
 * ---------------------------------------------------------------------------
 * The TWO-WORLDS guard for the console's LIVE WORLD column (demo-polish C2,
 * docs/features/demo-polish/18-live-world-column.md "Unmistakably staff"; the
 * cardinal rule in CLAUDE.md). The column shows participant CONTENT inside STAFF
 * chrome, so it must never be built from participant parts:
 *
 *   - no import from `@/features/social/components/post` (PostCard and its
 *     parts) or any participant stylesheet (`social.module.css`, any
 *     `*.module.css`);
 *   - no `PostCard` / participant skin / participant-shell / brand theme;
 *   - no `@mui/icons-material` (FontAwesome only);
 *   - COBRA is the control set: no raw MUI `Button` / `TextField` / `IconButton`;
 *   - no wall-clock read (`Date.now()`, `new Date()`): scenario time only;
 *   - `exerciseId` is read in exactly one place, as the React `key` that remounts
 *     the panel on an exercise switch (COR-001) — it is never passed anywhere.
 *
 * It reads the REAL source text of this folder's non-test files with Vite's
 * `import.meta.glob` (`?raw`) — `node:fs` is deliberately not used (the app TS
 * program omits Node types; see `staffShell/twoWorldsSeparation.test.ts`, whose
 * specifier-parsing approach this mirrors). Comments are stripped first, so prose
 * that merely MENTIONS `PostCard` is not a violation; only code is. A file-count
 * assertion keeps the guard from passing vacuously by scanning nothing.
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  [
    './*.ts',
    './*.tsx',
    '!./*.test.ts',
    '!./*.test.tsx',
    '!./liveWorldTestKit.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

/** Removes block and whole-line comments (specifier-only scanning must ignore prose). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n')
}

function importSpecifiers(code: string): string[] {
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  const found: string[] = []
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      if (match[1] !== undefined) found.push(match[1])
    }
  }
  return found
}

/** The names imported (value or type) from `module` in `code`. */
function namesImportedFrom(code: string, module: string): string[] {
  const names: string[] = []
  const pattern = new RegExp(
    `import\\s+(?:type\\s+)?\\{([^}]*)\\}\\s*from\\s*['"]${module.replace(/[/@]/g, '\\$&')}['"]`,
    'g',
  )
  for (const match of code.matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/)[0]?.trim()
      if (name) names.push(name)
    }
  }
  return names
}

const files = Object.entries(sources).map(([path, raw]) => ({
  path: path.replace('./', ''),
  code: stripComments(raw),
}))

describe('Live world column — the two-worlds guard', () => {
  it('scans the real files (non-vacuous)', () => {
    const names = files.map(file => file.path)
    for (const expected of [
      'LiveWorldColumn.tsx',
      'LiveWorldRow.tsx',
      'LiveWorldMedia.tsx',
      'useLiveWorldFeed.ts',
      'liveWorldModel.ts',
      'liveWorldStyles.ts',
    ]) {
      expect(names).toContain(expected)
    }
    expect(files.every(file => file.code.trim().length > 0)).toBe(true)
  })

  it('imports no participant post component, no participant stylesheet, no participant shell', () => {
    const forbidden: RegExp[] = [
      /features\/social\/components\/post(\/|$)/, // PostCard, PostHeader, PostBody, ...
      /components\/PostCard/,
      /social\.module\.css/,
      /\.module\.css$/, // no CSS Modules at all: the column is COBRA/sx only
      /features\/social\/theme/, // participant tokens and skin
      /participant-shell/,
      /BrandThemeProvider/,
      /features\/social\/components\/(Avatar|VerifiedMark|Composer|ThreadView)/,
      /@mui\/icons-material/,
    ]
    const violations: string[] = []
    for (const file of files) {
      for (const specifier of importSpecifiers(file.code)) {
        if (forbidden.some(pattern => pattern.test(specifier))) {
          violations.push(`${file.path} imports ${specifier}`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('names no PostCard (or participant post part) anywhere in code', () => {
    const participantParts = /\b(PostCard|PostHeader|PostBody|PostActions|PostMediaSlot)\b/
    const offenders = files
      .filter(file => participantParts.test(file.code))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('takes only pure data and services from the social feature (by path, not the UI barrel as a value)', () => {
    const allowedSocial = [
      /^@\/features\/social$/, // type-only imports below
      /^@\/features\/social\/services\/(feedService|feedStreamSource|postService|audience)$/,
      /^@\/features\/social\/utils\/hashtags$/,
      /^@\/features\/social\/components\/media\/(safeMediaUrl|formatDuration)$/,
    ]
    const violations: string[] = []
    for (const file of files) {
      for (const specifier of importSpecifiers(file.code)) {
        if (!specifier.startsWith('@/features/social')) continue
        if (!allowedSocial.some(pattern => pattern.test(specifier))) {
          violations.push(`${file.path} imports ${specifier}`)
        }
      }
      // The bare barrel exports PostCard & co: it may be imported for TYPES only.
      for (const match of file.code.matchAll(
        /import\s+(type\s+)?\{[^}]*\}\s*from\s*['"]@\/features\/social['"]/g,
      )) {
        if (match[1] === undefined) violations.push(`${file.path} has a VALUE import of the barrel`)
      }
    }
    expect(violations).toEqual([])
  })

  it('builds on COBRA: the column imports from @/theme/styledComponents, never raw MUI controls', () => {
    const column = files.find(file => file.path === 'LiveWorldColumn.tsx')
    expect(column).toBeDefined()
    expect(importSpecifiers(column?.code ?? '')).toContain('@/theme/styledComponents')

    const rawControls = ['Button', 'TextField', 'IconButton', 'ToggleButton', 'Select', 'Chip']
    const violations: string[] = []
    for (const file of files) {
      const names = namesImportedFrom(file.code, '@mui/material')
      for (const control of rawControls) {
        if (names.includes(control)) violations.push(`${file.path} imports ${control}`)
      }
    }
    expect(violations).toEqual([])
  })

  it('uses FontAwesome icons', () => {
    const column = files.find(file => file.path === 'LiveWorldColumn.tsx')
    expect(importSpecifiers(column?.code ?? '')).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('reads no wall-clock (scenario time only, COR-053)', () => {
    const offenders = files
      .filter(file => /\bDate\.now\s*\(|new\s+Date\s*\(/.test(file.code))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('reads exerciseId in exactly one place: as the React key that remounts on an exercise switch', () => {
    const occurrences = files.flatMap(file =>
      file.code
        .split('\n')
        .filter(line => /exerciseId/.test(line))
        .map(line => ({ file: file.path, line: line.trim() })))
    expect(occurrences.map(o => o.file)).toEqual(['LiveWorldColumn.tsx', 'LiveWorldColumn.tsx'])
    expect(occurrences[0]?.line)
      .toMatch(/const \{ exerciseId, timeZone \} = useExerciseContext\(\)/)
    expect(occurrences[1]?.line).toMatch(/key=\{exerciseId\}/)
  })
})
