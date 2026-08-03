/**
 * features/staff/staffRouteRegistry.test.tsx
 * ---------------------------------------------------------------------------
 * The invariants the SHIPPED staff route registry must hold. These are the rules
 * a future engineer adding surface #4 will break by accident — unique paths,
 * `/staff/` prefix, no collision with the pre-auth `/staff/login` route, a
 * default surface per role, `isDefaultFor ⊆ allowedRoles` — so they are asserted
 * against the real table rather than documented and hoped for.
 *
 * `@/core/services/api` is mocked because importing the registry pulls in every
 * staff surface's module graph (services included); no network belongs in a
 * table-shape test, and a live axios sink is this repo's worker-teardown footgun.
 */
import { describe, it, expect, vi } from 'vitest'
import { isValidElement } from 'react'
import {
  STAFF_ROOT_PATH,
  STAFF_SURFACE_ROLES,
  STAFF_ROUTE_GROUP_LABELS,
  STAFF_ROUTE_GROUP_ORDER,
  STAFF_LOGIN_PATH,
  resolveDefaultStaffRoute,
  staffRoutesForRole,
} from '@/features/app-shell'
import { STAFF_ROUTE_REGISTRY } from './staffRouteRegistry'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

describe('STAFF_ROUTE_REGISTRY — shape', () => {
  it('declares at least the three shipped staff surfaces', () => {
    expect(STAFF_ROUTE_REGISTRY.length).toBeGreaterThanOrEqual(3)
  })

  it('gives every entry a renderable element, a label and an icon', () => {
    for (const entry of STAFF_ROUTE_REGISTRY) {
      expect(isValidElement(entry.element)).toBe(true)
      expect(entry.label.length).toBeGreaterThan(0)
      // FontAwesome only (never @mui/icons-material) — an IconDefinition always
      // carries an `iconName`.
      expect(typeof entry.icon.iconName).toBe('string')
    }
  })

  it('uses unique ids and unique paths', () => {
    const ids = STAFF_ROUTE_REGISTRY.map(entry => entry.id)
    const paths = STAFF_ROUTE_REGISTRY.map(entry => entry.path)

    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(paths).size).toBe(paths.length)
  })

  it('puts every path under /staff/ and never on the pre-auth /staff/login route', () => {
    for (const entry of STAFF_ROUTE_REGISTRY) {
      expect(entry.path.startsWith(`${STAFF_ROOT_PATH}/`)).toBe(true)
      // The root router matches /staff/login first, so such an entry is dead code.
      expect(entry.path).not.toBe(STAFF_LOGIN_PATH)
    }
  })

  it('assigns every entry to a known launcher group', () => {
    for (const entry of STAFF_ROUTE_REGISTRY) {
      expect(STAFF_ROUTE_GROUP_ORDER).toContain(entry.group)
      expect(STAFF_ROUTE_GROUP_LABELS[entry.group].length).toBeGreaterThan(0)
    }
  })

  it('names only real staff roles in allowedRoles', () => {
    for (const entry of STAFF_ROUTE_REGISTRY) {
      expect(entry.allowedRoles.length).toBeGreaterThan(0)
      for (const role of entry.allowedRoles) {
        expect(STAFF_SURFACE_ROLES).toContain(role)
      }
    }
  })
})

describe('STAFF_ROUTE_REGISTRY — default surface per role', () => {
  it.each([...STAFF_SURFACE_ROLES])('gives %s exactly one declared default surface', role => {
    const defaults = STAFF_ROUTE_REGISTRY.filter(
      entry => entry.isDefaultFor?.includes(role) === true,
    )

    // Zero → that role fails closed to /login on every entry (the WR-003 bug
    // class). Two → the home page depends on registry order.
    expect(defaults).toHaveLength(1)
  })

  it.each([...STAFF_SURFACE_ROLES])('resolves a default surface for %s', role => {
    expect(resolveDefaultStaffRoute(STAFF_ROUTE_REGISTRY, role)).toBeDefined()
  })

  it('never declares a default for a role the entry does not allow', () => {
    for (const entry of STAFF_ROUTE_REGISTRY) {
      for (const role of entry.isDefaultFor ?? []) {
        expect(entry.allowedRoles).toContain(role)
      }
    }
  })
})

describe('STAFF_ROUTE_REGISTRY — the shipped paths (stable deep links)', () => {
  it('maps the shipped surfaces to their agreed paths', () => {
    // Named literally: renaming a shipped path breaks every bookmark and every
    // link a controller has pasted into an exercise plan, so it should be a
    // deliberate edit here, not a silent side-effect.
    const byId = new Map(STAFF_ROUTE_REGISTRY.map(entry => [entry.id, entry.path]))

    expect(byId.get('controller-console')).toBe('/staff/console')
    expect(byId.get('evaluator-dashboard')).toBe('/staff/evaluate')
    expect(byId.get('planner-workspace')).toBe('/staff/plan')
    expect(byId.get('exercise-management')).toBe('/staff/exercises')
  })
})

describe('STAFF_ROUTE_REGISTRY — the exercise-management entry (COR-074/075/076)', () => {
  const entry = STAFF_ROUTE_REGISTRY.find(candidate => candidate.id === 'exercise-management')

  it('mirrors the SERVER gate exactly: planner and orgAdmin, nobody else', () => {
    // The server's `ExerciseAdminRoles.ExerciseAdministrators` admits planner OR
    // orgAdmin to both `/api/org/exercises` routes. Listing a role here the API
    // 403s would show that role a surface that cannot load; omitting one would
    // hide a surface its holder is entitled to. Asserted as an exact set.
    expect(entry).toBeDefined()
    expect([...(entry?.allowedRoles ?? [])].sort()).toEqual(['orgAdmin', 'planner'])
  })

  it('is the org-admin family home page, and does NOT displace the planner’s', () => {
    expect(entry?.isDefaultFor).toEqual(['orgAdmin'])
    expect(resolveDefaultStaffRoute(STAFF_ROUTE_REGISTRY, 'orgAdmin')?.id)
      .toBe('exercise-management')
    // The regression this pins: making the new surface the planner's default too
    // would silently move a shipped role's home page.
    expect(resolveDefaultStaffRoute(STAFF_ROUTE_REGISTRY, 'planner')?.id)
      .toBe('planner-workspace')
  })

  it('gives the planner a SECOND surface, which is what un-degrades the launcher', () => {
    // `SurfaceLauncher` degrades to the static lockup at `entries.length <= 1`.
    // Every role mapped to exactly one entry before this, so the launcher had
    // never rendered in production. The behavioural proof is in
    // `exerciseManagementLauncher.test.tsx`; this is the registry precondition.
    expect(staffRoutesForRole(STAFF_ROUTE_REGISTRY, 'planner').length).toBeGreaterThanOrEqual(2)
  })

  it('files itself under Administer, and is invisible to controller and evaluator', () => {
    expect(entry?.group).toBe('administer')
    for (const role of ['controller', 'evaluator'] as const) {
      expect(staffRoutesForRole(STAFF_ROUTE_REGISTRY, role).map(e => e.id))
        .not.toContain('exercise-management')
    }
  })
})
