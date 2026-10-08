/**
 * features/controller/runSheet/runSheet.twoWorlds.test.ts
 * ---------------------------------------------------------------------------
 * AC "Staff world only": the run sheet uses `@/theme/styledComponents` + `staffShellTokens`
 * and imports NO participant skin or `PostCard`. A source scan (Vite's `import.meta.glob`,
 * `?raw`, so no Node `fs`) over every non-test file in this folder, checked by import
 * SPECIFIER (a comment that merely mentions "PostCard" is not an import):
 *   - no participant component / theme / shell import (`@/features/social/components`,
 *     `PostCard`, `*.module.css`, `participant-shell`, the social `theme/`);
 *   - FontAwesome only for icons (never `@mui/icons-material`);
 *   - COBRA replacements, not raw MUI, for the controls COBRA covers (buttons, text field);
 *   - the panel and its editor really do use COBRA components and the staff shell tokens;
 *   - no wall-clock rendering: `Date.now()` / bare `new Date()` do not appear (scenario time
 *     comes from `@/core/clock`; the only wall-clock read is `wallClockNowIso`, for the
 *     export file's informational `exportedAt`);
 *   - no `exerciseId` is put on a request here (the fire service builds the input from the
 *     exercise context for stamping only, and `publishPost` drops it).
 */
import { describe, expect, it } from 'vitest'

const sources = import.meta.glob(['./*.ts', './*.tsx'], {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

const appSources = Object.entries(sources).filter(
  ([path]) => !/\.test\.tsx?$/.test(path) && !path.endsWith('runSheetTestKit.tsx'),
)

function specifiers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const found: string[] = []
  for (const pattern of [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    /import\s+['"]([^'"]+)['"]/g,
    /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) if (match[1]) found.push(match[1])
  }
  return found
}

function importedNames(source: string, from: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const names: string[] = []
  const named = /import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*['"]([^'"]+)['"]/g
  for (const match of code.matchAll(named)) {
    if (match[2] === from) {
      names.push(...(match[1] ?? '').split(',').map(part => part.trim().split(/\s+as\s+/)[0] ?? ''))
    }
  }
  return names.filter(name => name !== '')
}

describe('run sheet - staff world only', () => {
  it('scans a real set of files (not vacuously)', () => {
    expect(appSources.length).toBeGreaterThanOrEqual(12)
    expect(appSources.map(([path]) => path)).toContain('./RunSheetPanel.tsx')
  })

  it('imports no participant component, skin, theme or shell', () => {
    const forbidden = [
      /^@\/features\/social\/components(\/|$)/,
      /^@\/features\/social\/theme(\/|$)/,
      /^@\/features\/social\/layout(\/|$)/,
      /^@\/features\/social$/,
      /PostCard/,
      /participant-shell/,
      /\.module\.css$/,
    ]
    for (const [path, source] of appSources) {
      for (const specifier of specifiers(source)) {
        expect(
          forbidden.some(pattern => pattern.test(specifier)),
          `${path} imports the participant-world module "${specifier}"`,
        ).toBe(false)
      }
    }
  })

  it('uses FontAwesome for icons, never @mui/icons-material', () => {
    for (const [path, source] of appSources) {
      for (const specifier of specifiers(source)) {
        expect(specifier.startsWith('@mui/icons-material'), `${path} imports ${specifier}`).toBe(false)
      }
    }
    const panel = sources['./RunSheetPanel.tsx'] ?? ''
    expect(specifiers(panel)).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('uses COBRA controls instead of raw MUI buttons and text fields', () => {
    const rawControls = ['Button', 'IconButton', 'TextField', 'Select', 'Chip']
    for (const [path, source] of appSources) {
      const raw = importedNames(source, '@mui/material').filter(name => rawControls.includes(name))
      expect(raw, `${path} imports raw MUI ${raw.join(', ')}`).toEqual([])
    }
  })

  it('the panel and editor are built from @/theme/styledComponents and staffShellTokens', () => {
    for (const file of ['./RunSheetPanel.tsx', './BeatEditor.tsx', './RunSheetBeatRow.tsx']) {
      const source = sources[file] ?? ''
      expect(specifiers(source), file).toContain('@/theme/styledComponents')
    }
    for (const file of ['./RunSheetPanel.tsx', './BeatEditor.tsx', './RunSheetBeatRow.tsx']) {
      expect(specifiers(sources[file] ?? ''), file).toContain('@/features/staffShell/staffShellTokens')
    }
  })

  it('reads no wall clock to display anything (scenario time only)', () => {
    for (const [path, source] of appSources) {
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(/\bDate\.now\s*\(/.test(code), `${path} calls Date.now()`).toBe(false)
      expect(/new Date\(\s*\)/.test(code), `${path} calls new Date()`).toBe(false)
    }
    // The one wall-clock read is the export file's informational timestamp.
    const users = appSources
      .filter(([, source]) => source.includes('wallClockNowIso'))
      .map(([path]) => path)
    expect(users).toEqual(['./RunSheetPanel.tsx'])
  })

  it('the fire path never writes an exerciseId onto a request body', () => {
    const fire = sources['./runSheetFire.ts'] ?? ''
    // It is a stamp on CreatePostInput (which publishPost strips), never a body literal.
    expect(fire).not.toMatch(/api\.(post|get|put|patch)/)
    expect(sources['./runSheetStore.ts'] ?? '').not.toMatch(/api\./)
  })
})
