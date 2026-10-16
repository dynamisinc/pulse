/**
 * src/test/twoWorlds.ts
 * ---------------------------------------------------------------------------
 * TEST-ONLY helper: the two-worlds import gate's forbidden-specifier list and its
 * specifier parser, extracted verbatim from `features/staffShell/twoWorldsSeparation.test.ts`
 * (the real gate, D7-009 / SHELL-CONTRACT §4) so a narrower check (demo-feedback 25's
 * `theme/cobraTheme.contrast.test.ts`) applies the SAME list instead of a second copy.
 * Pure functions over source text; never import this from non-test code.
 */

/** Specifiers that would mount COBRA/Cadence staff-world chrome on a participant surface. */
export const FORBIDDEN_SPECIFIER_PATTERNS: RegExp[] = [
  /^@\/theme(\/|$)/, // @/theme/cobraTheme, @/theme/styledComponents, @/theme/CobraStyles, ...
  /cobraTheme/i,
  /styledComponents/,
  /CobraStyles/,
  // Bare name (not path-scoped): also catches both the aliased
  // (`@/features/staffShell/staffShellTokens`) and relative (`../staffShellTokens`)
  // import forms — the path-scoped `staffShell/staffShellTokens` pattern missed
  // the relative form. No participant module carries this name, so it can't
  // over-match.
  /staffShellTokens/,
  // Easy-login story 10: `features/participantAdmin/` is the STAFF roster screen
  // (COBRA, join URLs, sign-in credentials) despite its name. Matched as a path
  // SEGMENT, so it catches `@/features/participantAdmin/...` and
  // `../participantAdmin/...` but not `staffShell/participantAdminMocks` or the
  // `ParticipantAdminFlyout` component, which are different, shell-owned modules.
  /(^|\/)participantAdmin(\/|$)/,
]

/**
 * Extract every static `import ... from '<specifier>'`, SIDE-EFFECT-only
 * `import '<specifier>'`, dynamic `import('<specifier>')`, and
 * `require('<specifier>')` module specifier from a source file's text.
 * Deliberately specifier-only (not a full parse) so it never matches prose in
 * comments that merely *mentions* "COBRA"/"theme" (see e.g. `ShellLayout.tsx`'s
 * own header comment) without an actual import.
 */
export function extractImportSpecifiers(source: string): string[] {
  const specifiers: string[] = []
  const patterns = [
    /import\s+(?:type\s+)?[^'"]*?from\s+['"]([^'"]+)['"]/g,
    // Side-effect-only import (no `from`), e.g. `import '@/theme/cobraTheme'` —
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

export interface Violation {
  file: string
  specifier: string
}

export function findViolations(filesByPath: Record<string, string>): Violation[] {
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
