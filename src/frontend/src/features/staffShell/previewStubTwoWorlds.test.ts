/**
 * features/staffShell/previewStubTwoWorlds.test.ts
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant), updated by demo-polish C6 to the REAL-channel
 * composition -- the mechanical two-worlds gate for the one place a participant
 * channel is mounted inside the staff frame (SHELL-CONTRACT.md §4 hard gate; D7-009).
 * (The file keeps its historical name; its subject used to be the `PortalStub` mock.)
 *
 * The preview is split into two files on purpose, so each half can be gated for what
 * it must NOT contain:
 *
 *  - `components/PreviewChannelHost.tsx` -- the PARTICIPANT half. It mounts the real
 *    `SocialChannel` and its providers, and it must import NO COBRA/Cadence token and
 *    NO MUI: it is the thing inside the staff frame that must not pick the frame up.
 *    (`twoWorldsSeparation.test.ts` also scans it with the participant roots, for the
 *    COBRA/token half of this; this adds the no-MUI half that is specific to it.)
 *  - `components/PreviewAsParticipant.tsx` -- the STAFF half: the labelled strip, Exit and
 *    the neutral mat. It must import NO participant surface (no `social`, no
 *    `participant-shell`, no brand token, no CSS module): the participant world reaches it
 *    through exactly one sibling import, the host -- the only other sibling is the stage's own
 *    (staff-world) error boundary.
 *
 * Uses Vite's `import.meta.glob` (eager, `?raw`) to read the REAL source text,
 * mirroring `twoWorldsSeparation.test.ts`'s own approach -- this fails the moment a
 * file actually imports across the line, not a re-implemented fixture (WAVE0-REVIEW
 * precedent 17).
 */
import { describe, expect, it } from 'vitest'

const FORBIDDEN_IN_PARTICIPANT_HOST: RegExp[] = [
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

/**
 * What the staff strip must not reach for: the participant surfaces, their brand
 * providers, their stylesheets and their CSS-variable vocabulary.
 */
const FORBIDDEN_IN_STAFF_STRIP: RegExp[] = [
  /^@\/features\/social(\/|$)/,
  /^@\/features\/participant-shell(\/|$)/,
  /^@\/features\/(portal|news|press|weather)(\/|$)/,
  /brandTokens/,
  /BrandThemeProvider/,
  /SocialBrandScope/,
  /\.module\.css$/,
]

/** Participant-world CSS custom properties: never named by the staff strip's source text. */
const PARTICIPANT_TOKEN_PATTERNS: RegExp[] = [
  /--pc-/,
  /--pulse-ac\b/,
  /--pulse-brand-/,
  /--pulse-chrome-/,
  /--pulse-alert-/,
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

/** The source minus block and line comments, so prose that NAMES a token is not a use of it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
}

const hostFiles = import.meta.glob('./components/PreviewChannelHost.tsx', {
  eager: true, query: '?raw', import: 'default',
})
const stripFiles = import.meta.glob('./components/PreviewAsParticipant.tsx', {
  eager: true, query: '?raw', import: 'default',
})
const boundaryFiles = import.meta.glob('./components/PreviewErrorBoundary.tsx', {
  eager: true, query: '?raw', import: 'default',
})

describe('PreviewChannelHost (the participant half) -- no COBRA/Cadence token, no MUI (D7-009)', () => {
  it('scans the real PreviewChannelHost.tsx source (this test cannot vacuously pass)', () => {
    expect(Object.keys(hostFiles)).toHaveLength(1)
  })

  it('finds NO import of @/theme/*, cobraTheme, styledComponents, CobraStyles, staffShellTokens or @mui/*', () => {
    const violations: Array<{ file: string; specifier: string }> = []

    for (const [file, source] of Object.entries(hostFiles)) {
      for (const specifier of extractImportSpecifiers(source as string)) {
        if (FORBIDDEN_IN_PARTICIPANT_HOST.some(pattern => pattern.test(specifier))) {
          violations.push({ file, specifier })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations.map(v => `  ${v.file} imports "${v.specifier}"`).join('\n')
      throw new Error(
        `PreviewChannelHost.tsx (the participant-world half of the preview) imports staff-world chrome — this breaks the two-worlds hard gate (D7-009, SHELL-CONTRACT.md §4):\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })

  it('mounts the REAL channel and the providers it needs, not a stand-in (C6 AC1)', () => {
    const source = Object.values(hostFiles).join('\n')
    const imports = extractImportSpecifiers(source)

    expect(imports).toContain('@/features/social')
    expect(imports).toContain('@/features/social/layout/SocialNavigationProvider')
    expect(imports).toContain('@/features/participant-shell/BrandThemeProvider')
    expect(imports).toContain('@/features/participant-shell/mountContract')
    // The retired mock must not come back.
    expect(imports.some(specifier => /PortalStub/.test(specifier))).toBe(false)
  })
})

describe('PreviewAsParticipant (the staff strip) -- carries no participant token (D7-009)', () => {
  it('scans the real PreviewAsParticipant.tsx source (this test cannot vacuously pass)', () => {
    expect(Object.keys(stripFiles)).toHaveLength(1)
  })

  it('imports no participant surface, brand provider, brand token or CSS module', () => {
    const violations: Array<{ file: string; specifier: string }> = []

    for (const [file, source] of Object.entries(stripFiles)) {
      for (const specifier of extractImportSpecifiers(source as string)) {
        if (FORBIDDEN_IN_STAFF_STRIP.some(pattern => pattern.test(specifier))) {
          violations.push({ file, specifier })
        }
      }
    }

    if (violations.length > 0) {
      const detail = violations.map(v => `  ${v.file} imports "${v.specifier}"`).join('\n')
      throw new Error(
        `PreviewAsParticipant.tsx (the staff strip) imports participant-world code — the participant world must reach it ONLY through PreviewChannelHost (D7-009, SHELL-CONTRACT.md §4):\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })

  it('names no participant CSS custom property in its code', () => {
    const offenders: string[] = []
    for (const [file, source] of Object.entries(stripFiles)) {
      const code = stripComments(source as string)
      for (const pattern of PARTICIPANT_TOKEN_PATTERNS) {
        if (pattern.test(code)) offenders.push(`${file} uses ${pattern}`)
      }
    }
    expect(offenders).toEqual([])
  })

  it('reaches the participant world through exactly one sibling: PreviewChannelHost', () => {
    const source = Object.values(stripFiles).join('\n')
    const siblings = extractImportSpecifiers(source).filter(specifier => specifier.startsWith('./'))

    // The host is the participant half; the error boundary is staff chrome around it (W-3).
    expect(siblings.sort()).toEqual(['./PreviewChannelHost', './PreviewErrorBoundary'])
  })

  it('the stage\'s error boundary is staff chrome: it imports no participant surface either', () => {
    const boundary = Object.values(boundaryFiles).join('\n')

    expect(boundary).not.toBe('')
    const hits = extractImportSpecifiers(boundary).filter(specifier =>
      FORBIDDEN_IN_STAFF_STRIP.some(pattern => pattern.test(specifier)))
    expect(hits).toEqual([])
  })
})

describe('the gates catch a violation (they are not vacuous)', () => {
  it('flags a COBRA, MUI or staff-token import in the participant host', () => {
    const bad = [
      "import { Box } from '@mui/material'",
      "import { staffShellTokens } from '../staffShellTokens'",
      "import { CobraPrimaryButton } from '@/theme/styledComponents'",
    ].join('\n')
    const hits = extractImportSpecifiers(bad).filter(specifier =>
      FORBIDDEN_IN_PARTICIPANT_HOST.some(pattern => pattern.test(specifier)))
    expect(hits).toHaveLength(3)
  })

  it('flags a participant import or token in the strip, but not prose that merely names one', () => {
    const bad = [
      "import { SocialChannel } from '@/features/social'",
      "import s from './x.module.css'",
      "const c = 'var(--pc-bg)'",
    ].join('\n')
    const hits = extractImportSpecifiers(bad).filter(specifier =>
      FORBIDDEN_IN_STAFF_STRIP.some(pattern => pattern.test(specifier)))
    expect(hits).toHaveLength(2)
    const usesToken = (code: string) =>
      PARTICIPANT_TOKEN_PATTERNS.some(pattern => pattern.test(stripComments(code)))
    expect(usesToken(bad)).toBe(true)

    const prose = [
      '/* mentions --pc-bg and @/features/social */',
      '// also --pulse-ac',
      'const x = 1',
    ].join('\n')
    expect(usesToken(prose)).toBe(false)
  })
})
