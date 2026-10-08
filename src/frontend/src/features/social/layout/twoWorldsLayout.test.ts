/**
 * features/social/layout/twoWorldsLayout.test.ts
 * ---------------------------------------------------------------------------
 * The two-worlds rule for the F1 frame (demo-polish F1, "No enterprise look"):
 * nothing under `social/layout/**`, and not `SocialChannel.tsx` itself, may import
 * MUI, the COBRA theme or its styled components, or the MUI icon set. The channel is
 * participant-world: CSS Modules + FontAwesome only.
 *
 * Same technique as `staffShell/twoWorldsSeparation.test.ts`: read the REAL source
 * text through Vite's eager `?raw` glob and parse import specifiers (not prose, so a
 * comment that merely mentions "COBRA" is fine). `node:fs` is deliberately avoided --
 * the app program's `types` is `["vite/client"]` only.
 *
 * NON-VACUITY: the scan must find a minimum number of files, must find the
 * FontAwesome import it expects in the rail, and the detector must flag a synthetic
 * offender -- so an empty glob or a broken regex fails instead of passing silently.
 */
import { describe, expect, it } from 'vitest'

const FORBIDDEN: RegExp[] = [
  /^@mui\//, // @mui/material, @mui/icons-material, @mui/system, ...
  /^@\/theme(\/|$)/, // @/theme/cobraTheme, @/theme/styledComponents, @/theme/CobraStyles
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  /staffShellTokens/,
  /^@emotion\//,
]

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

function violations(files: Record<string, string>): Array<{ file: string; specifier: string }> {
  const found: Array<{ file: string; specifier: string }> = []
  for (const [file, source] of Object.entries(files)) {
    for (const specifier of extractImportSpecifiers(source)) {
      if (FORBIDDEN.some(pattern => pattern.test(specifier))) found.push({ file, specifier })
    }
  }
  return found
}

const layoutSources = import.meta.glob(
  ['./**/*.{ts,tsx}', '!./**/*.test.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
) as Record<string, string>

const channelSources = import.meta.glob('../SocialChannel.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

describe('social/layout/** and SocialChannel.tsx stay in the participant world', () => {
  it('scans a real set of files (cannot pass vacuously)', () => {
    expect(Object.keys(layoutSources).length).toBeGreaterThanOrEqual(15)
    expect(Object.keys(channelSources)).toEqual(['../SocialChannel.tsx'])
  })

  it('imports no MUI, no COBRA theme / styled components, no emotion', () => {
    expect(violations({ ...layoutSources, ...channelSources })).toEqual([])
  })

  it('takes its icons from FontAwesome (the rail really uses it)', () => {
    const rail = layoutSources['./NavRail.tsx']
    expect(rail).toBeDefined()
    expect(extractImportSpecifiers(rail ?? '')).toContain('@fortawesome/free-solid-svg-icons')
  })

  it('the detector bites: it flags MUI, MUI icons, and COBRA imports', () => {
    // Built from fragments on purpose: a literal import line in THIS file's source would
    // be (rightly) flagged by `staffShell/twoWorldsSeparation.test.ts`, which scans
    // every file under `social/**` -- including this one.
    const named = (names: string, specifier: string) =>
      ['import', names, 'from', JSON.stringify(specifier)].join(' ')
    const bare = (specifier: string) => ['import', JSON.stringify(specifier)].join(' ')
    const offender = [
      named('{ Button }', '@mui/material'),
      named('{ Foo }', '@mui/icons-material/Foo'),
      named('{ CobraPrimaryButton }', '@/theme/styledComponents'),
      bare('@/theme/cobraTheme'),
    ].join('\n')
    const found = violations({ './fixture.tsx': offender }).map(v => v.specifier)
    expect(found).toEqual([
      '@mui/material',
      '@mui/icons-material/Foo',
      '@/theme/styledComponents',
      '@/theme/cobraTheme',
    ])
  })

  it('does not flag prose that merely mentions the staff theme', () => {
    expect(violations({ './prose.ts': '// no COBRA, no @mui/material here\nexport const x = 1' })).toEqual([])
  })
})
