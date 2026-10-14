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
 * SCOPE. The glob covers EVERY non-test source file under this folder, nested
 * folders included (`./**` — C5's `TakedownAction.tsx` lands here and is held to
 * the same rules). Test files and `liveWorldTestKit.ts` (test-only builders) are
 * excluded. Every import-like specifier is checked: `import … from`, side-effect
 * `import '…'`, dynamic `import('…')`, `require('…')`, AND re-exports
 * (`export … from '…'`, `export * from '…'`), which would otherwise smuggle a
 * participant module through a barrel.
 *
 * THE SOCIAL ALLOWLIST. Anything imported from `@/features/social` must match an
 * entry of `ALLOWED_SOCIAL_IMPORTS` below — each with the reason it is safe. The
 * list is deliberately short and explicit: a new entry is a conscious decision
 * that the module is pure data/service (no participant skin, no UI), made in code
 * review, not an accident of "it compiled". Relative paths into `social` are
 * rejected outright (they would bypass the allowlist). The bare barrel
 * `@/features/social` also exports `PostCard` and friends, so it may be imported
 * for TYPES only.
 *
 * It reads the REAL source text with Vite's `import.meta.glob` (`?raw`) — `node:fs`
 * is deliberately not used (the app TS program omits Node types; see
 * `staffShell/twoWorldsSeparation.test.ts`, whose specifier-parsing approach this
 * mirrors). Comments are stripped first, so prose that merely MENTIONS `PostCard`
 * is not a violation; only code is. A file-count assertion keeps the guard from
 * passing vacuously, and the parser has its own self-test.
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(
  [
    './**/*.ts',
    './**/*.tsx',
    '!./**/*.test.ts',
    '!./**/*.test.tsx',
    '!./liveWorldTestKit.ts',
  ],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

/**
 * The only modules the Live world folder may import from the social feature, and
 * why each is safe (pure data / service, no participant skin, no UI). See the
 * module header: adding an entry is a review decision.
 */
const ALLOWED_SOCIAL_IMPORTS: readonly { readonly pattern: RegExp; readonly why: string }[] = [
  {
    pattern: /^@\/features\/social$/,
    why: 'the barrel, for TYPES ONLY (Post/ParticipantPostView/ReplyTarget…); it also exports '
      + 'PostCard, so a value import is rejected separately',
  },
  {
    pattern: /^@\/features\/social\/services\/(feedService|feedStreamSource|postService|audience)$/,
    why: 'the feed read seam, the shared ref-counted arrival transport, the sole XC-002 '
      + 'narrowing (toParticipantView) and the compact-count formatter: services, no UI',
  },
  {
    pattern: /^@\/features\/social\/utils\/hashtags$/,
    why: 'the pure hashtag parser (one definition of "what a hashtag is")',
  },
  {
    pattern: /^@\/features\/social\/components\/media\/(safeMediaUrl|formatDuration)$/,
    why: 'pure helpers only: the media URL allow-list (NFR-004) and the duration formatter',
  },
  {
    pattern: /^@\/features\/social\/services\/removedPosts$/,
    why: 'C5: the pure removed-post id store the console wires into `isRowRemoved` / '
      + 'TakedownAction (a store, no UI)',
  },
]

/** Removes block and whole-line comments (specifier-only scanning must ignore prose). */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter(line => !/^\s*\/\//.test(line))
    .join('\n')
}

/** Every module specifier `code` imports, side-effect-imports, requires or RE-EXPORTS. */
function moduleSpecifiers(code: string): string[] {
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g, // import … from '…'
    /import\s+['"]([^'"]+)['"]/g, // import '…'
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g, // import('…')
    /require\(\s*['"]([^'"]+)['"]\s*\)/g, // require('…')
    /export\s+(?:type\s+)?\*(?:\s+as\s+[\w$]+)?\s*from\s*['"]([^'"]+)['"]/g, // export * [as x] from
    /export\s+(?:type\s+)?\{[^}]*\}\s*from\s*['"]([^'"]+)['"]/g, // export { … } from
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

describe('Live world column — the guard\'s own machinery', () => {
  it('parses imports, side-effect imports, dynamic imports, require, and RE-EXPORTS', () => {
    const code = [
      "import { A } from '@/a'",
      "import type { B } from '@/b'",
      "import '@/side-effect'",
      "const lazy = import('@/dynamic')",
      "const old = require('@/required')",
      "export * from '@/star'",
      "export * as ns from '@/star-as'",
      "export { C, D } from '@/named'",
      "export type { E } from '@/named-type'",
      'export { local }',
    ].join('\n')
    expect(moduleSpecifiers(code).sort()).toEqual([
      '@/a', '@/b', '@/dynamic', '@/named', '@/named-type', '@/required',
      '@/side-effect', '@/star', '@/star-as',
    ])
  })

  it('ignores specifiers that only appear in comments', () => {
    const code = stripComments([
      "/* import { X } from '@/block-comment' */",
      "// export * from '@/line-comment'",
      "import { Y } from '@/real'",
    ].join('\n'))
    expect(moduleSpecifiers(code)).toEqual(['@/real'])
  })

  it('flags a participant module smuggled through a re-export', () => {
    const forbidden = /features\/social\/components\/post(\/|$)/
    expect(moduleSpecifiers("export * from '@/features/social/components/post'")
      .some(s => forbidden.test(s))).toBe(true)
    expect(moduleSpecifiers("export { PostCard } from '@/features/social/components/post'")
      .some(s => forbidden.test(s))).toBe(true)
  })

  it('documents every allowlist entry (a reason is mandatory)', () => {
    expect(ALLOWED_SOCIAL_IMPORTS.length).toBeGreaterThan(0)
    for (const entry of ALLOWED_SOCIAL_IMPORTS) {
      expect(entry.why.trim().length).toBeGreaterThan(20)
    }
  })
})

describe('Live world column — the two-worlds guard', () => {
  it('scans the real files (non-vacuous), nested folders included', () => {
    const names = files.map(file => file.path)
    for (const expected of [
      'LiveWorldColumn.tsx',
      'LiveWorldRow.tsx',
      'LiveWorldMedia.tsx',
      'useLiveWorldFeed.ts',
      'liveWorldModel.ts',
      'liveWorldStyles.ts',
      'index.ts',
    ]) {
      expect(names).toContain(expected)
    }
    expect(files.every(file => file.code.trim().length > 0)).toBe(true)
    // Tests and the test kit are NOT scanned (they legitimately name PostCard in prose, etc.).
    expect(names.some(name => /\.test\.tsx?$/.test(name))).toBe(false)
    expect(names).not.toContain('liveWorldTestKit.ts')
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
      for (const specifier of moduleSpecifiers(file.code)) {
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

  it('takes only what the SOCIAL ALLOWLIST names, and the bare barrel for types only', () => {
    const violations: string[] = []
    for (const file of files) {
      for (const specifier of moduleSpecifiers(file.code)) {
        // A relative path into `social` would sidestep the allowlist entirely.
        if (specifier.startsWith('.') && /(^|\/)social(\/|$)/.test(specifier)) {
          violations.push(`${file.path} reaches into social by relative path: ${specifier}`)
          continue
        }
        if (!specifier.startsWith('@/features/social')) continue
        if (!ALLOWED_SOCIAL_IMPORTS.some(entry => entry.pattern.test(specifier))) {
          violations.push(`${file.path} imports ${specifier} (not on the social allowlist)`)
        }
      }
      // The bare barrel exports PostCard & co: it may be imported for TYPES only —
      // neither a value import nor a re-export of it.
      const barrelStatement = new RegExp(
        '(import|export)\\s+(type\\s+)?(\\{[^}]*\\}|\\*(?:\\s+as\\s+[\\w$]+)?)\\s*from\\s*'
        + '[\'"]@/features/social[\'"]',
        'g',
      )
      for (const match of file.code.matchAll(barrelStatement)) {
        if (match[2] === undefined) {
          violations.push(`${file.path} has a VALUE ${match[1]} of the social barrel`)
        }
      }
    }
    expect(violations).toEqual([])
  })

  it('builds on COBRA: the column imports from @/theme/styledComponents, never raw MUI controls', () => {
    const column = files.find(file => file.path === 'LiveWorldColumn.tsx')
    expect(column).toBeDefined()
    expect(moduleSpecifiers(column?.code ?? '')).toContain('@/theme/styledComponents')

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
    expect(moduleSpecifiers(column?.code ?? '')).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('reads no wall-clock (scenario time only, COR-053)', () => {
    const offenders = files
      .filter(file => /\bDate\.now\s*\(|new\s+Date\s*\(/.test(file.code))
      .map(file => file.path)
    expect(offenders).toEqual([])
  })

  it('reads exerciseId in exactly one place: as the React key that remounts on a switch', () => {
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
