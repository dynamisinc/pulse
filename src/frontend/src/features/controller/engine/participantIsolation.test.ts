/**
 * features/controller/engine/participantIsolation.test.ts
 * ---------------------------------------------------------------------------
 * Gate-2 fold S-1 (feature: autonomy-safety, story 07 — cut-to-fake provider
 * lever). Today the XC-002/SOC-003 guarantee that this module is staff-only
 * holds by module LOCATION plus a doc claim (07-cut-to-fake-provider.md AC5:
 * "the effective-provider fact is staff-only by construction") — nothing in
 * the codebase actually enforces it. Participants learning the exercise is
 * running on the Fake generation provider (`effectiveProvider`,
 * `providerCutToFake`, `alreadyFake` — this story's own new fields, plus every
 * pre-existing engine-settings field) is fiction-breaking, not merely an
 * internal detail (D0 §2), so this makes the guarantee STRUCTURAL: no
 * participant surface may import anything from `features/controller/engine/**`,
 * ever, by any import form.
 *
 * Mirrors the established two-worlds-guard pattern
 * (`features/staffShell/twoWorldsSeparation.test.ts`) but runs in the OPPOSITE
 * direction of that guard's own check: that test scans participant surfaces
 * for STAFF chrome imports (`@/theme/*`, COBRA tokens); this one scans the
 * same participant roots for imports of this ONE staff-only feature module.
 *
 * Uses Vite's `import.meta.glob` (eager, `?raw`) to read the REAL source text
 * of every `.ts`/`.tsx` file under each participant surface root
 * (`social`, `portal`, `outlets`, `weather` — most don't exist yet; a glob
 * with zero matches is simply empty, not an error, so an unbuilt root is
 * skipped rather than failing outright). `node:fs`/`node:path` are
 * deliberately NOT used (see `twoWorldsSeparation.test.ts`'s own header:
 * `tsconfig.app.json` omits Node ambient types from the browser app program,
 * and this test file lives under the same `src` program as app code) — so
 * relative-import resolution below is done with a purpose-built path-segment
 * check, not `path.resolve`.
 *
 * Each file's static/dynamic import + `require` specifiers are parsed and
 * checked against the guarded path: `@/features/controller/engine` (the alias
 * form) or any relative specifier that names `controller/engine` as adjacent
 * path segments (the relative form — matched by segment, not by resolving the
 * path against the importing file's own location, since a specifier that
 * literally writes out `controller/engine` resolves into the guarded tree no
 * matter how many `../` hops precede it; this repo's relative imports are
 * always written out in full, never with resolution-shortcut tricks). This is
 * a SPECIFIER match, not a substring search over the whole file — it cannot
 * flag a doc-comment that merely *mentions* the engine module (see
 * `features/social/services/livePostActions.ts`'s own header, which names
 * `features/controller/engine/services/liveReviewActions.ts` in prose without
 * importing it) — precedent 17, no tautological / over-eager tests.
 *
 * The file-count assertion guards against silently passing by scanning zero
 * files, matching the sibling guard's own non-vacuity discipline.
 */
import { describe, expect, it } from 'vitest'

/**
 * Specifiers that would import the staff-only engine-settings/review-cockpit
 * module onto a participant surface.
 */
const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  // The `@/...` alias form, anchored at the controller/engine root — also
  // matches any deeper subpath (`@/features/controller/engine/hooks/...`,
  // `@/features/controller/engine/services/engineSettingsActions`, ...).
  /^@\/features\/controller\/engine(\/|$)/,
  // The relative-path form (`../../controller/engine/...`,
  // `../../../controller/engine/hooks/useEngineSettings`, etc.) — matched by
  // directory-name substring rather than by resolving the path against the
  // importing file's location. Deliberately broad: this also re-matches the
  // alias form above (harmless — `findViolations` below dedupes per specifier
  // via `.some`), and catches ANY file under the guarded tree, not just the
  // three fields/hooks this story adds.
  /(^|\/)controller\/engine(\/|$)/,
]

/**
 * Extract every static `import ... from '<specifier>'`, SIDE-EFFECT-only
 * `import '<specifier>'`, dynamic `import('<specifier>')`, and
 * `require('<specifier>')` module specifier from a source file's text.
 * Deliberately specifier-only (not a full parse) so it never matches prose in
 * comments that merely *mentions* the engine module without an actual import.
 */
function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    // Side-effect-only import (no `from`), e.g. `import '@/features/controller/engine'` —
    // still a real module import that would otherwise bypass this gate.
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
// each call site); a root that doesn't exist yet just contributes {}, which
// is an explicit, documented skip (see module header) rather than a silent
// scan-nothing pass — the non-vacuity assertion below still requires at least
// one root (today: `social`) to have contributed real files.
const socialFiles = import.meta.glob('../../social/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const portalFiles = import.meta.glob('../../portal/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const outletsFiles = import.meta.glob('../../outlets/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})
const weatherFiles = import.meta.glob('../../weather/**/*.{ts,tsx}', {
  eager: true, query: '?raw', import: 'default',
})

const PARTICIPANT_SURFACE_FILES: Record<string, string> = {
  ...socialFiles,
  ...portalFiles,
  ...outletsFiles,
  ...weatherFiles,
}

describe('Participant surfaces never import the engine-settings module (SOC-003 / XC-002, autonomy-safety/07 S-1)', () => {
  it('scans at least one real participant-surface file (this test cannot vacuously pass)', () => {
    expect(Object.keys(PARTICIPANT_SURFACE_FILES).length).toBeGreaterThan(0)
  })

  it('finds NO import/require of features/controller/engine/** (alias or relative) under any participant surface root', () => {
    const violations = findViolations(PARTICIPANT_SURFACE_FILES)

    if (violations.length > 0) {
      const detail = violations
        .map(v => `  ${v.file} imports "${v.specifier}"`)
        .join('\n')
      throw new Error(
        'Participant surface(s) import the staff-only engine-settings module — a participant must ' +
        'NEVER be able to learn the effective generation provider (SOC-003 / XC-002; ' +
        `07-cut-to-fake-provider.md AC5). This breaks the two-worlds hard gate:\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })
})
