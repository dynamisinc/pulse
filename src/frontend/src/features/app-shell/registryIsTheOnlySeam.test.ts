/**
 * features/app-shell/registryIsTheOnlySeam.test.ts
 * ---------------------------------------------------------------------------
 * "Adding a staff surface is ONE registry entry" — asserted, not just promised
 * (staff-navigation/01: *adding a registry entry requires no edit to
 * `RoleAwareEntry` or `routes.tsx`*). ~40 surfaces are planned; the moment one of
 * them is easier to bolt onto the routing glue than to declare in the registry,
 * the seam is gone and the glue starts accumulating per-surface special cases.
 *
 * The mechanical form of that promise: NO routing-glue module may name a
 * concrete staff surface — not its path, not its component, not its id. Every
 * one of those literals belongs to `@/features/staff/staffRouteRegistry`.
 *
 * Companion behavioural proof lives in `StaffRouteTree.test.tsx` ("a surface the
 * glue has never heard of routes anyway"), which appends a synthetic entry to a
 * registry and deep-links it without touching a line of this feature.
 *
 * Reads real source text via `import.meta.glob` (eager, `?raw`) — same posture
 * as `staffShell/twoWorldsSeparation.test.ts` (no `node:fs`: the app program's
 * `types` is `["vite/client"]` only).
 */
import { describe, it, expect } from 'vitest'

/** Literals that would mean a concrete surface had leaked into the glue. */
const SURFACE_LITERALS = [
  // Shipped paths.
  '/staff/console',
  '/staff/evaluate',
  '/staff/plan',
  '/staff/exercises',
  // Shipped route compositions.
  'ControllerConsoleRoute',
  'EvaluatorDashboardRoute',
  'PlannerWorkspaceRoute',
  'ExerciseManagementRoute',
  // Shipped registry ids.
  'controller-console',
  'evaluator-dashboard',
  'planner-workspace',
  'exercise-management',
  // The registry module itself: the glue consumes an INJECTED registry, so even
  // importing the concrete table here would couple the two.
  'staffRouteRegistry',
  'STAFF_ROUTE_REGISTRY',
]

/** Strips comments so a module that DOCUMENTS the shipped paths does not trip. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

const GLUE_FILES: Record<string, string> = {
  ...import.meta.glob('./RoleAwareEntry.tsx', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('./StaffRouteTree.tsx', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('./staffRouting.ts', { eager: true, query: '?raw', import: 'default' }),
  ...import.meta.glob('./routes.tsx', { eager: true, query: '?raw', import: 'default' }),
}

describe('the staff route registry is the only place a surface is named', () => {
  it('scans all four routing-glue modules (cannot vacuously pass)', () => {
    expect(Object.keys(GLUE_FILES).sort()).toEqual([
      './RoleAwareEntry.tsx',
      './StaffRouteTree.tsx',
      './routes.tsx',
      './staffRouting.ts',
    ])
  })

  it('the detector actually bites: it FINDS those literals in the registry itself', () => {
    // The registry is where every one of these literals is supposed to live, so
    // if the scan finds none there, the scan is broken — not the codebase.
    const registrySources = Object.values(
      import.meta.glob('../staff/staffRouteRegistry.tsx', {
        eager: true,
        query: '?raw',
        import: 'default',
      }),
    ) as string[]
    expect(registrySources).toHaveLength(1)

    const registrySource = stripComments(registrySources[0] ?? '')
    for (const literal of ['/staff/console', 'ControllerConsoleRoute', 'controller-console']) {
      expect(registrySource).toContain(literal)
    }
  })

  it('names no concrete staff surface in any routing-glue module', () => {
    const violations: string[] = []

    for (const [file, source] of Object.entries(GLUE_FILES)) {
      const code = stripComments(source)
      for (const literal of SURFACE_LITERALS) {
        if (code.includes(literal)) violations.push(`  ${file} names "${literal}"`)
      }
    }

    if (violations.length > 0) {
      throw new Error(
        'A concrete staff surface leaked into the routing glue. Adding a staff surface must stay '
        + 'ONE entry in @/features/staff/staffRouteRegistry — the glue only ever sees the injected '
        + `registry:\n${violations.join('\n')}`,
      )
    }

    expect(violations).toEqual([])
  })
})
