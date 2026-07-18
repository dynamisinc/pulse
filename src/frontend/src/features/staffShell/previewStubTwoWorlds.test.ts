/**
 * features/staffShell/previewStubTwoWorlds.test.ts
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) — the mechanical two-worlds gate for
 * `components/PortalStub.tsx` specifically (SHELL-CONTRACT.md §4 hard gate;
 * D7-009).
 *
 * `twoWorldsSeparation.test.ts` (story 05) scans the participant SURFACE
 * ROOTS (`features/{social,portal,news,press,weather,participant-shell}`);
 * `PortalStub.tsx` deliberately lives under `features/staffShell/components/`
 * (it is the STAGED content, not a real channel — see its module header), so
 * that scan does not reach it. This test ships this story's OWN narrow copy
 * of the same check, scoped to exactly the one file that renders
 * participant-world content inside this feature: `PortalStub.tsx` must
 * import NO COBRA/Cadence token AND no MUI component — everything else in
 * `features/staffShell` legitimately uses both (it is the staff frame).
 *
 * Uses Vite's `import.meta.glob` (eager, `?raw`) to read the REAL source
 * text, mirroring `twoWorldsSeparation.test.ts`'s own approach — this fails
 * the moment the stub actually imports staff-world chrome, not a
 * re-implemented fixture (WAVE0-REVIEW precedent 17).
 */
import { describe, expect, it } from 'vitest'

const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^@\/theme(\/|$)/,
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  // Bare name (not path-scoped): also catches the relative form a sibling in
  // components/ would write — `../staffShellTokens` — which the path-scoped
  // `staffShell/staffShellTokens` pattern missed. No participant module carries
  // this name, so a bare match cannot over-match (Gate-1 W-001).
  /staffShellTokens/,
  /^@mui\//,
]

function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    // Side-effect-only import (no `from`), e.g. `import '@mui/material'` or
    // `import '../staffShellTokens'` — still a real import that would otherwise
    // bypass this gate.
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

const portalStubFiles = import.meta.glob('./components/PortalStub.tsx', {
  eager: true, query: '?raw', import: 'default',
})

describe('PortalStub — imports no COBRA/Cadence token and no MUI component (D7-009, SHELL-CONTRACT §4)', () => {
  it('scans the real PortalStub.tsx source (this test cannot vacuously pass)', () => {
    expect(Object.keys(portalStubFiles).length).toBe(1)
  })

  it('finds NO import/require of @/theme/*, cobraTheme, styledComponents, CobraStyles, staffShellTokens, or @mui/*', () => {
    const violations: Array<{ file: string; specifier: string }> = []

    for (const [file, source] of Object.entries(portalStubFiles)) {
      for (const specifier of extractImportSpecifiers(source as string)) {
        if (FORBIDDEN_SPECIFIER_PATTERNS.some(pattern => pattern.test(specifier))) {
          violations.push({ file, specifier })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations.map(v => `  ${v.file} imports "${v.specifier}"`).join('\n')
      throw new Error(
        `PortalStub.tsx (the staged participant-world content) imports staff-world chrome — this breaks the two-worlds hard gate (D7-009, SHELL-CONTRACT.md §4):\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })
})
