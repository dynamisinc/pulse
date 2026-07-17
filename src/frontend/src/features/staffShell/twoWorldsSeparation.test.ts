/**
 * features/staffShell/twoWorldsSeparation.test.ts
 * ---------------------------------------------------------------------------
 * Story 05 (Cadence chrome tokens + thumbnail-distinguishability gate) — the
 * mechanical enforcement of D7-009 / SHELL-CONTRACT.md §4's hard gate: the
 * participant world must NEVER import COBRA/Cadence staff-shell tokens.
 *
 * Uses Vite's `import.meta.glob` (eager, `?raw`) to read the REAL source text
 * of every `.ts`/`.tsx` file under each participant surface root that
 * currently exists in `src/features/` (`social`, `portal`, `news`, `press`,
 * `weather`, `participant-shell` — most don't exist yet; a glob with zero
 * matches is simply empty, not an error, so an unbuilt root is skipped rather
 * than failing). Each call site uses a literal glob pattern, as Vite's glob
 * transform requires. `node:fs` is deliberately NOT used here: `tsconfig.app
 * .json` intentionally omits Node ambient types from the browser app program
 * (`types: ["vite/client"]` only) so app/test code can't silently start
 * depending on Node built-ins — this test stays inside that same contract.
 *
 * Each file's static/dynamic import + `require` specifiers are parsed and
 * checked against a forbidden-specifier list (`@/theme/*`, `cobraTheme`,
 * `styledComponents`, `CobraStyles`, this feature's `staffShellTokens`).
 * Reading the real files (not re-implementing the check's own fixture) means
 * this test fails the moment a participant surface actually imports
 * staff-world chrome — precedent 17, no tautological tests — and the
 * file-count assertion guards against silently passing by scanning zero files.
 */
import { describe, expect, it } from 'vitest'

/** Specifiers that would mount COBRA/Cadence staff-world chrome on a participant surface. */
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^@\/theme(\/|$)/, // @/theme/cobraTheme, @/theme/styledComponents, @/theme/CobraStyles, ...
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  /staffShell\/staffShellTokens/,
]

/**
 * Extract every static `import ... from '<specifier>'`, dynamic
 * `import('<specifier>')`, and `require('<specifier>')` module specifier from
 * a source file's text. Deliberately specifier-only (not a full parse) so it
 * never matches prose in comments that merely *mentions* "COBRA"/"theme"
 * (see e.g. `ShellLayout.tsx`'s own header comment) without an actual import.
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
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

// Each participant surface root, read eagerly as raw text. One glob call per
// root with a literal pattern (Vite's import.meta.glob requires a literal at
// each call site); a root that doesn't exist yet just contributes {}.
const socialFiles = import.meta.glob('../social/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const portalFiles = import.meta.glob('../portal/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const newsFiles = import.meta.glob('../news/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const pressFiles = import.meta.glob('../press/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const weatherFiles = import.meta.glob('../weather/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const participantShellFiles = import.meta.glob('../participant-shell/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})

const PARTICIPANT_SURFACE_FILES: Record<string, string> = {
  ...socialFiles,
  ...portalFiles,
  ...newsFiles,
  ...pressFiles,
  ...weatherFiles,
  ...participantShellFiles,
}

describe('Two-worlds separation — participant surfaces import no COBRA/Cadence tokens (D7-009)', () => {
  it('scans at least one real participant-surface file (this test cannot vacuously pass)', () => {
    expect(Object.keys(PARTICIPANT_SURFACE_FILES).length).toBeGreaterThan(0)
  })

  it('finds NO import/require of @/theme/*, cobraTheme, styledComponents, CobraStyles, or staffShellTokens under any participant surface root', () => {
    const violations = findViolations(PARTICIPANT_SURFACE_FILES)

    if (violations.length > 0) {
      const detail = violations
        .map(v => `  ${v.file} imports "${v.specifier}"`)
        .join('\n')
      throw new Error(
        `Participant surface(s) import staff-world COBRA/Cadence tokens — this breaks the two-worlds hard gate (D7-009, SHELL-CONTRACT.md §4):\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })
})
