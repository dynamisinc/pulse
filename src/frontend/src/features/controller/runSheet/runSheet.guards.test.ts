/**
 * features/controller/runSheet/runSheet.guards.test.ts
 * ---------------------------------------------------------------------------
 * Structural guards for the run sheet (inject-queue story 07, AC "Staff world only"),
 * so the rules hold by CONSTRUCTION rather than by a doc claim. They read the REAL source
 * text of every non-test file under `runSheet/` (Vite `import.meta.glob`, eager, `?raw`;
 * comments stripped so prose that merely mentions a module is not a violation):
 *
 *  - TWO WORLDS: no participant component or skin — nothing from `features/social` (the
 *    `PostCard` family and the barrel that re-exports it), `participant-shell`, or a CSS module;
 *  - ICONS: FontAwesome only — never `@mui/icons-material`;
 *  - STAFF COMPONENTS: buttons and text fields are COBRA (`@/theme/styledComponents`), never a
 *    raw MUI `Button` / `IconButton` / `TextField`;
 *  - NO TELEMETRY: the console emits nothing for queue actions (the server emits the one
 *    `inject_action` event; IQ-8) — so no import of `@/core/telemetry`;
 *  - NO `exerciseId` in the service or the mock (the server scopes every request; COR-001);
 *  - NO new hard-coded hex colours: colours come from the shared `consoleChrome` tokens;
 *  - NFR-004: no `dangerouslySetInnerHTML` (staff-authored text is rendered as React text);
 *  - the frozen seam: `RunSheetPanel` takes NO props.
 *
 * `node:fs` is deliberately not used (the app tsconfig omits Node types) — see
 * `controller/engine/participantIsolation.test.ts`, whose lexer approach this mirrors.
 */
import { describe, expect, it } from 'vitest'
import { RunSheetPanel } from './RunSheetPanel'

const modules = import.meta.glob('./**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const isTestOrHarness = (path: string): boolean =>
  /\.test\.(ts|tsx)$/.test(path) || path.endsWith('runSheetTestHarness.tsx')

const productionFiles: Record<string, string> = Object.fromEntries(
  Object.entries(modules).filter(([path]) => !isTestOrHarness(path)),
)

/** Strips comments but leaves string/template literals intact. */
function stripComments(source: string): string {
  return source.replace(
    /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`)|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    (match, stringLiteral: string | undefined) => (stringLiteral === undefined ? '' : match),
  )
}

function importSpecifiers(source: string): string[] {
  const code = stripComments(source)
  const out: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /export\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) if (match[1] !== undefined) out.push(match[1])
  }
  return out
}

/** Names imported from a given module specifier (named imports only). */
function namedImportsFrom(source: string, specifier: string): string[] {
  const code = stripComments(source)
  const names: string[] = []
  const pattern = new RegExp(`import\\s*(?:type\\s*)?\\{([^}]*)\\}\\s*from\\s*['"]${specifier}['"]`, 'g')
  for (const match of code.matchAll(pattern)) {
    for (const part of (match[1] ?? '').split(',')) {
      const name = part.trim().split(/\s+as\s+/)[0]?.replace(/^type\s+/, '').trim()
      if (name) names.push(name)
    }
  }
  return names
}

const violations = (test: (specifier: string) => boolean): string[] =>
  Object.entries(productionFiles).flatMap(([file, source]) =>
    importSpecifiers(source).filter(test).map(specifier => `${file} -> ${specifier}`),
  )

describe('runSheet guards — not vacuous', () => {
  it('scans the real production files (and finds the files this story owns)', () => {
    const names = Object.keys(productionFiles)
    expect(names.length).toBeGreaterThanOrEqual(20)
    for (const expected of [
      './types.ts',
      './injectService.ts',
      './injectMock.ts',
      './useInjectQueue.ts',
      './RunSheetPanel.tsx',
      './RunSheetRow.tsx',
      './InjectItemEditor.tsx',
      './media/InjectMediaField.tsx',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('the detector is real: it flags a participant import when one is planted', () => {
    const planted = "import { PostCard } from '@/features/social/components/PostCard'"
    expect(importSpecifiers(planted)).toEqual(['@/features/social/components/PostCard'])
    expect(importSpecifiers("// import { x } from '@mui/icons-material'")).toEqual([])
  })
})

describe('runSheet guards — two worlds (no participant component, no participant skin)', () => {
  it('imports nothing from features/social (PostCard and friends) or participant-shell', () => {
    expect(
      violations(s => /(^|\/)features\/social(\/|$)/.test(s) || /participant-shell/.test(s)),
    ).toEqual([])
  })

  it('imports no CSS module (the participant skinning mechanism)', () => {
    expect(violations(s => /\.module\.css$/.test(s))).toEqual([])
  })

  it('never names a participant component', () => {
    const offenders = Object.entries(productionFiles)
      .filter(([, source]) =>
        /\b(PostCard|ParticipantPostView|FeedColumn)\b/.test(stripComments(source)),
      )
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

describe('runSheet guards — icons and staff components', () => {
  it('uses FontAwesome only: never @mui/icons-material', () => {
    expect(violations(s => s.startsWith('@mui/icons-material'))).toEqual([])
    const usesFontAwesome = Object.values(productionFiles).some(source =>
      importSpecifiers(source).includes('@fortawesome/free-solid-svg-icons'),
    )
    expect(usesFontAwesome).toBe(true)
  })

  it('uses COBRA buttons / fields, never a raw MUI Button, IconButton or TextField', () => {
    const forbidden = new Set(['Button', 'IconButton', 'TextField', 'LoadingButton', 'Fab'])
    const offenders = Object.entries(productionFiles).flatMap(([file, source]) =>
      namedImportsFrom(source, '@mui/material')
        .filter(name => forbidden.has(name))
        .map(name => `${file} imports ${name}`),
    )
    expect(offenders).toEqual([])
    const usesCobra = Object.values(productionFiles).some(source =>
      importSpecifiers(source).includes('@/theme/styledComponents'),
    )
    expect(usesCobra).toBe(true)
  })

  it('takes its colours from the shared consoleChrome tokens: no hard-coded hex in production code', () => {
    const offenders = Object.entries(productionFiles).flatMap(([file, source]) =>
      [...stripComments(source).matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => `${file}: ${m[0]}`),
    )
    expect(offenders).toEqual([])
  })
})

describe('runSheet guards — telemetry, scope, content security', () => {
  it('emits no telemetry for queue actions (the server is the single emitter)', () => {
    expect(violations(s => s.includes('core/telemetry'))).toEqual([])
  })

  it('the service and the mock never mention an exerciseId in code (the server scopes)', () => {
    for (const file of ['./injectService.ts', './injectMock.ts', './injectErrors.ts', './injectGuards.ts']) {
      const source = productionFiles[file]
      expect(source, file).toBeDefined()
      expect(stripComments(source ?? ''), file).not.toMatch(/exerciseId/i)
    }
  })

  it('renders staff-authored text as React text: no dangerouslySetInnerHTML', () => {
    const offenders = Object.entries(productionFiles)
      .filter(([, source]) => stripComments(source).includes('dangerouslySetInnerHTML'))
      .map(([file]) => file)
    expect(offenders).toEqual([])
  })
})

describe('runSheet guards — the frozen mount seam', () => {
  it('RunSheetPanel takes no props (the orchestrator mounts <RunSheetPanel /> unchanged)', () => {
    expect(RunSheetPanel.length).toBe(0)
  })
})
