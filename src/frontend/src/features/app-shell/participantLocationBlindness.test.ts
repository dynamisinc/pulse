/**
 * features/app-shell/participantLocationBlindness.test.ts
 * ---------------------------------------------------------------------------
 * COR-004, enforced STRUCTURALLY rather than behaviourally.
 *
 * Staff surfaces are now real, deep-linkable URLs. Participants must stay
 * exactly as they were: no UI concept of exercise selection, and NO routing on a
 * typed path — a participant typing `/staff/console` lands on their participant
 * surface. `RoleAwareEntry.staffRouting.test.tsx` proves that behaviourally; this
 * file proves the property that makes it impossible to regress by accident:
 *
 *   every module on the PARTICIPANT render path imports no location-reading API
 *   at all, so that branch physically cannot see the URL.
 *
 * The participant render path inside this feature is `RoleAwareEntry.tsx` (the
 * branch itself) and `RouteFocusScope.tsx` (the only component it wraps the
 * participant surface in). Everything URL-aware lives in `StaffRouteTree.tsx`,
 * which is rendered only after the resolved role has been narrowed to staff.
 *
 * NON-VACUITY. The detector is proven to bite before it is trusted: the same
 * scan MUST find location reads in `StaffRouteTree.tsx`. A regex that stopped
 * matching (renamed API, changed source layout) fails that case instead of
 * silently passing every file.
 *
 * Reads the REAL source text via Vite's `import.meta.glob` (eager, `?raw`) —
 * `node:fs` is deliberately avoided, matching `staffShell/twoWorldsSeparation
 * .test.ts`: the app program's `types` is `["vite/client"]` only.
 */
import { describe, it, expect } from 'vitest'

/**
 * Location-reading APIs. `Navigate` is deliberately NOT here: rendering a
 * redirect is a decision already made by the resolved role, not a URL read.
 */
const LOCATION_READ_APIS = [
  'useLocation',
  'useParams',
  'useSearchParams',
  'useMatch',
  'useMatches',
  'useRoutes',
  'matchPath',
  'useResolvedPath',
  'Routes',
  'Route',
  'Outlet',
]

const LOCATION_READ_PATTERN = new RegExp(
  `\\b(${LOCATION_READ_APIS.join('|')})\\b|window\\.location|location\\.pathname`,
)

/** Strips comments so a file that merely DOCUMENTS the ban does not trip it. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const participantPathFiles: Record<string, string> = {
  ...import.meta.glob('./RoleAwareEntry.tsx', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('./RouteFocusScope.tsx', { eager: true, query: '?raw', import: 'default' }),
}

const staffTreeFiles: Record<string, string> = import.meta.glob('./StaffRouteTree.tsx', {
  eager: true,
  query: '?raw',
  import: 'default',
})

describe('COR-004 — the participant render path is location-blind by construction', () => {
  it('scans the real source of both participant-path modules (cannot vacuously pass)', () => {
    expect(Object.keys(participantPathFiles).sort()).toEqual([
      './RoleAwareEntry.tsx',
      './RouteFocusScope.tsx',
    ])
  })

  it('the detector actually bites: it FINDS location reads in StaffRouteTree.tsx', () => {
    const staffSources = Object.values(staffTreeFiles)
    expect(staffSources).toHaveLength(1)

    for (const source of staffSources) {
      expect(LOCATION_READ_PATTERN.test(stripComments(source))).toBe(true)
    }
  })

  it('finds NO location-reading API in any module on the participant render path', () => {
    const violations = Object.entries(participantPathFiles)
      .map(([file, source]) => ({ file, match: LOCATION_READ_PATTERN.exec(stripComments(source)) }))
      .filter((candidate): candidate is { file: string, match: RegExpExecArray } =>
        candidate.match !== null)

    if (violations.length > 0) {
      const detail = violations.map(v => `  ${v.file} reads "${v.match[0]}"`).join('\n')
      throw new Error(
        'The participant render path reads the browser location. Participants must NOT route on a '
        + `typed path (COR-004) — move the URL read into StaffRouteTree.tsx:\n${detail}`,
      )
    }

    expect(violations).toEqual([])
  })
})
