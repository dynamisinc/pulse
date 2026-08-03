/**
 * features/app-shell/staffRouting.test.ts
 * ---------------------------------------------------------------------------
 * The staff route registry's PURE contract: role gating, default-surface
 * resolution, the descendant-path conversion, and the drift guard that keeps
 * `STAFF_SURFACE_ROLES` equal to the core role vocabulary.
 *
 * Fixtures here are deliberately synthetic (not the shipped registry) so these
 * cases test the RESOLVERS rather than today's three surfaces; the shipped
 * table has its own invariant suite in
 * `features/staff/staffRouteRegistry.test.tsx`.
 */
import { describe, it, expect } from 'vitest'
import { faGear } from '@fortawesome/free-solid-svg-icons'
import { STAFF_ROLES } from '@/core/auth'
import {
  STAFF_SURFACE_ROLES,
  isStaffSurfaceRole,
  isStaffRouteAllowed,
  staffRoutesForRole,
  resolveDefaultStaffRoute,
  toDescendantRoutePath,
  type StaffRouteEntry,
  type StaffRouteRegistry,
} from './staffRouting'

function entry(overrides: Partial<StaffRouteEntry> & Pick<StaffRouteEntry, 'id'>): StaffRouteEntry {
  return {
    path: `/staff/${overrides.id}`,
    label: overrides.id,
    icon: faGear,
    element: null,
    allowedRoles: ['controller'],
    group: 'conduct',
    ...overrides,
  }
}

describe('STAFF_SURFACE_ROLES — drift guard against the core role vocabulary', () => {
  it('is exactly the core STAFF_ROLES set PLUS orgAdmin, and nothing else', () => {
    // Two drifts, both silent, both closed by this one assertion:
    //
    //  - a FOURTH core staff role added to `core/auth/roles.ts` and not here
    //    would silently lose every staff surface (RoleAwareEntry would treat it
    //    as unsupported and redirect to /login) — the original reason this
    //    guard exists;
    //  - `orgAdmin` dropped from here would put every org-admin session back on
    //    the fail-closed login redirect COR-076 exists to end, with nothing
    //    else going red.
    //
    // The sets are UNEQUAL by exactly one member, on purpose: `STAFF_ROLES` is
    // the XC-002 authorization family (roles that operate inside one exercise);
    // this list is "may index the staff route registry". See
    // `staffRouting.ts`'s `StaffSurfaceRole` for why widening `STAFF_ROLES`
    // instead would have moved an authorization boundary to buy a route.
    expect([...STAFF_SURFACE_ROLES].sort()).toEqual([...STAFF_ROLES, 'orgAdmin'].sort())
    expect(STAFF_ROLES).not.toContain('orgAdmin')
  })

  it('narrows staff-surface roles (incl. orgAdmin) and rejects participant roles', () => {
    expect(isStaffSurfaceRole('controller')).toBe(true)
    expect(isStaffSurfaceRole('evaluator')).toBe(true)
    expect(isStaffSurfaceRole('planner')).toBe(true)
    // COR-076: admitted to the ROUTE TREE — not folded into `STAFF_ROLES`.
    expect(isStaffSurfaceRole('orgAdmin')).toBe(true)
    // XC-002: a participant role can never reach a staff surface. This half of
    // the predicate must never change.
    expect(isStaffSurfaceRole('participant')).toBe(false)
    expect(isStaffSurfaceRole('pio')).toBe(false)
  })
})

describe('role gating — allowedRoles is the single source of truth', () => {
  const registry: StaffRouteRegistry = [
    entry({ id: 'console', allowedRoles: ['controller'] }),
    entry({ id: 'plan', allowedRoles: ['planner'] }),
    entry({ id: 'timeline', allowedRoles: ['controller', 'evaluator'] }),
  ]

  it('admits only the roles an entry names', () => {
    const console_ = registry[0]
    if (console_ === undefined) throw new Error('fixture')
    expect(isStaffRouteAllowed(console_, 'controller')).toBe(true)
    expect(isStaffRouteAllowed(console_, 'planner')).toBe(false)
  })

  it('lists a role only the surfaces it may open, in registry order', () => {
    expect(staffRoutesForRole(registry, 'controller').map(r => r.id)).toEqual([
      'console',
      'timeline',
    ])
    expect(staffRoutesForRole(registry, 'planner').map(r => r.id)).toEqual(['plan'])
    expect(staffRoutesForRole(registry, 'evaluator').map(r => r.id)).toEqual(['timeline'])
  })
})

describe('resolveDefaultStaffRoute', () => {
  it('prefers the entry that declares itself the default for that role', () => {
    const registry: StaffRouteRegistry = [
      entry({ id: 'inject-queue', allowedRoles: ['controller'] }),
      entry({ id: 'console', allowedRoles: ['controller'], isDefaultFor: ['controller'] }),
    ]

    // Registry ORDER must not decide the home page — the declaration does.
    expect(resolveDefaultStaffRoute(registry, 'controller')?.id).toBe('console')
  })

  it('ignores an isDefaultFor that is not also in allowedRoles (declaration bug)', () => {
    const registry: StaffRouteRegistry = [
      entry({ id: 'plan', allowedRoles: ['planner'], isDefaultFor: ['controller'] }),
      entry({ id: 'console', allowedRoles: ['controller'] }),
    ]

    // A controller must never be sent to a surface it is not allowed to open —
    // that would redirect-loop against the tree, which only registers allowed
    // routes.
    expect(resolveDefaultStaffRoute(registry, 'controller')?.id).toBe('console')
  })

  it('falls back to the first surface the role may open when nothing declares a default', () => {
    const registry: StaffRouteRegistry = [
      entry({ id: 'plan', allowedRoles: ['planner'] }),
      entry({ id: 'timeline', allowedRoles: ['controller', 'evaluator'] }),
    ]

    expect(resolveDefaultStaffRoute(registry, 'evaluator')?.id).toBe('timeline')
  })

  it('returns undefined when the role has no surface at all (caller fails closed)', () => {
    const registry: StaffRouteRegistry = [entry({ id: 'console', allowedRoles: ['controller'] })]

    expect(resolveDefaultStaffRoute(registry, 'planner')).toBeUndefined()
    expect(resolveDefaultStaffRoute([], 'controller')).toBeUndefined()
  })
})

describe('toDescendantRoutePath', () => {
  it('strips the leading slash so a descendant <Routes> under the `/` base matches', () => {
    expect(toDescendantRoutePath('/staff/console')).toBe('staff/console')
  })

  it('leaves an already-relative path alone', () => {
    expect(toDescendantRoutePath('staff/console')).toBe('staff/console')
  })
})
