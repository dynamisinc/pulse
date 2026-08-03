# Story: Staff route tree & surface registry

**Feature:** Staff navigation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress — built, Gate-2 raised a non-blocking divergence (WR-005)
**Requirements:** COR-070  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Today the entire staff side of Pulse is **one route**. `src/frontend/src/features/app-shell/routes.tsx`
maps everything except `/login` and `/staff/login` to a single `*` catch-all that mounts
`RoleAwareEntry`, which in turn renders **exactly one hardcoded `ReactNode`** per staff role from a
`Partial<Record<StaffSurfaceRole, ReactNode>>` prop wired in `App.tsx` (`controller` →
`ControllerConsoleRoute`, `evaluator` → `EvaluatorDashboardRoute`, `planner` → `PlannerWorkspaceRoute`).
There is no path segment, so there is nothing to bookmark, share, reload into, or navigate
back/forward through — a controller and a planner both sit at whatever URL the browser happens to
show, and the app does not care what it says.

This was fine when each staff role had exactly one surface. It stops being fine now: roughly 40
staff surfaces are planned across E1 (persona/cast library, readiness dashboard, org
administration), E4/E5/E6 (news/press/weather staff composers), E7 (the controller console's own
sub-surfaces), E8 (the engine review cockpit), and E10 (the evaluation timeline/replay). Each one
today would mean editing `RoleAwareEntry`'s per-role surface or inventing an ad-hoc internal switch
inside an existing surface — there is no shared extensibility seam. This story builds that seam: a
**staff surface registry** (the single source of truth for "what staff surfaces exist, at what
path, for which roles") and the **real route tree** the router and the launcher (story 02) both
read from it.

## What was built
- `features/app-shell/staffRouting.ts` — world-neutral **shape**: `StaffRouteEntry`/
  `StaffRouteRegistry` types, `StaffSurfaceRole`, `isStaffSurfaceRole`, `staffRoutesForRole`,
  `resolveDefaultStaffRoute`, `toDescendantRoutePath`. No COBRA, no surface imports, no
  `react-router` imports — pure resolvers over a table.
- `features/staff/staffRouteRegistry.tsx` — the **concrete table**, the one place a staff surface
  is declared. Ships three entries today: `/staff/plan` (planner, default), `/staff/console`
  (controller, default), `/staff/evaluate` (evaluator, default).
- `features/app-shell/StaffRouteTree.tsx` — the nested, descendant `<Routes>` mounted by
  `RoleAwareEntry` only after the role has resolved to staff. Registers one `<Route>` per entry the
  caller's role is allowed to open; everything else (unknown path, bare `/staff`, or a path
  authorized for a different role) redirects (`replace`) to the role's default surface — never to
  `/login`.
- `features/app-shell/RouteFocusScope.tsx` — extracted, world-neutral focus-on-mount wrapper, keyed
  per route (`staff:{entry.id}`) so moving between staff surfaces re-focuses, same as the
  participant world's single scope.
- `features/app-shell/staffNavigationContext.tsx` — **added after the initial cut**, once it became
  clear `StaffHeader`'s launcher (story 02) cannot import the concrete registry without closing an
  import cycle (registry → a surface's route file → `StaffHeader` → `SurfaceLauncher` → registry).
  `StaffRouteTree` now wraps its `<Routes>` in `StaffNavigationProvider`, publishing
  `{registry, role}` to any chrome mounted inside a surface via `useStaffNavigation()`. This is
  infrastructure story 02 consumes; see that story for the launcher itself.
- `RoleAwareEntry.tsx` / `routes.tsx` edited to inject the registry (`staffRoutes` prop replaces
  the old `staffSurfaces` per-role map) and mount `StaffRouteTree` under the staff branch, per a
  splat (`path="*"`) — the pre-existing descendant-`<Routes>` requirement.

## Acceptance Criteria
- [x] Given the staff surface registry, when a new staff surface is added, then it is a single
      registry entry (path, label, icon, group, allowed roles, ~~lazy-loaded component~~) — no route
      table is hand-edited and `RoleAwareEntry`'s decision logic is not touched. **Partial — see
      "Divergence: eager, not lazy (WR-005)" below.** The rest of the AC (one entry, no other edit)
      is built and proved; the parenthetical `lazy-loaded component` is not.
- [x] Given a staff role with one or more registered surfaces, when the caller navigates to a
      registered path, then the router renders that surface directly — reload, deep link, and
      browser back/forward all work exactly like an ordinary route (unlike today's path-less
      catch-all).
- [x] Given a staff role visiting a path registered for a **different** role's surface (e.g. a
      controller session requesting a planner-only path), when the route resolves, then access is
      denied and the caller is redirected to a surface they are actually assigned — the same
      fail-closed posture `RoleAwareEntry` already applies at the role level, now applied per route.
- [x] Given the existing `controller` / `evaluator` / `planner` surfaces (`ControllerConsoleRoute`,
      `EvaluatorDashboardRoute`, `PlannerWorkspaceRoute`), when this story lands, then each becomes a
      registry entry with a real path — this story does **not** change what any of the three
      surfaces render, only how they are reached.
- [x] Given a participant session, when they request any path, then behavior is **byte-for-byte
      unchanged**: the participant catch-all (COR-004) still resolves to exactly one landing
      surface with no route table exposed — this story adds structure only under the staff branch
      of `RoleAwareEntry`.

### Cross-cutting
- [x] **Isolation (XC-001/XC-002):** no staff route is reachable from a participant-scoped session;
      the registry's per-surface `roles` field is enforced client-side fail-closed, consistent with
      the existing precedent that `RoleAwareEntry`'s gate is the client half of a defense-in-depth
      pair with API-side authorization (no API-side staff-route authorization exists yet — nothing
      in this story's scope changes that; see "Out of Scope").
- [x] **Accessibility (NFR-001):** a route change moves focus to the newly-rendered surface's
      landmark — the same `RouteFocusScope` contract `RoleAwareEntry` already implements for the
      top-level role branch does not regress when a route change happens *within* the staff branch
      (now keyed by route id, not role — see "Existing tests touched").

## Divergence: eager, not lazy (WR-005) — OPEN ITEM
The AC and this story's own Technical Notes call for `React.lazy` per registry entry so a growing
registry does not bloat the initial staff bundle. As built, `StaffRouteEntry.element` is a plain,
eagerly-imported `ReactNode` (`staffRouteRegistry.tsx` imports `ControllerConsoleRoute` /
`EvaluatorDashboardRoute` / `PlannerWorkspaceRoute` directly, at module scope).

**Reviewer finding (Gate 2, WR-005):** at three entries this is invisible. The reviewer flags that
`element: ReactNode` makes a later move to lazy loading a **breaking** change to the registry's
shape (every entry's `element` field would need to become a thunk/lazy-component at once), rather
than an additive one — and recommends making that shape change **now, while there are only three
entries to touch**, because at the ~40 planned surfaces every staff surface and its full COBRA
dependency tree would otherwise sit in the root bundle, on the participant path too (the registry
module is imported by `App.tsx`'s composition root regardless of which world resolves).

**Recommended shape (not yet built):** `element: () => ReactNode` (a thunk) or a dedicated `lazy:
() => Promise<{ default: ComponentType }>` field resolved by `StaffRouteTree` via `React.lazy` +
`<Suspense>`. Left as an explicit open item for the next builder touching this registry — do not
tick the struck-through AC clause until it lands, and do not let a fourth entry land eager without
raising this again.

## Out of Scope
The launcher UI that lets a human navigate the registry (story 02); deep-linking a surface's
*internal* sections (story 03 — this story is surface-level routes only); the exercise-context
refresh bug (story 04); registering the OrgAdmin surface itself (that surface is
`exercise-lifecycle-admin/03`'s content — this story only makes the registry able to hold it);
building any of the ~40 planned surfaces this unblocks — this story is the seam, not the surfaces;
a server-side authorization check per staff route (today's fail-closed gate is client-side only,
same precedent as the pre-existing role gate — no regression, no improvement).

## Technical Notes
Staff world (COBRA) for the registry table (`features/staff/staffRouteRegistry.tsx`); the resolver
shape (`features/app-shell/staffRouting.ts`) and the route tree/focus scope
(`StaffRouteTree.tsx`/`RouteFocusScope.tsx`) are world-neutral routing glue, importing no theme and
no concrete surface. `App.tsx` is the one place the registry is handed to `createRoleAwareRoutes()`
(orchestrator-owned integration seam, per `implementation.md`). React Router 7
(`createBrowserRouter`, nested `RouteObject[]`, descendant `<Routes>` under the root splat). See
implementation.md (story 01) for the wave placement and the WR-005 open item's follow-up home.

## Dependencies
`app-shell/01` (`RoleAwareEntry`, `routes.tsx` — Complete); the three existing staff surfaces
(`ControllerConsoleRoute`, `EvaluatorDashboardRoute`, `PlannerWorkspaceRoute` in `App.tsx`). Blocks
story 02 (the launcher reads this registry) and any future surface that wants a real path.

## Tests
Vitest + RTL. Every test below exists and was run green in this wave.

**AC1 — one registry entry, no other edit (minus the struck-through lazy clause)**
- `staffRouteRegistry.test.tsx` → `STAFF_ROUTE_REGISTRY — shape`: `declares at least the three
  shipped staff surfaces (AC1)`, `gives every entry a renderable element, a label and an icon
  (AC1)`, `uses unique ids and unique paths (AC1)`, `puts every path under /staff/ and never on the
  pre-auth /staff/login route (AC1)`, `assigns every entry to a known launcher group (AC1)`, `names
  only real staff roles in allowedRoles (AC1)`
- `staffRouteRegistry.test.tsx` → `STAFF_ROUTE_REGISTRY — default surface per role`: `never declares
  a default for a role the entry does not allow (AC1)`
- `registryIsTheOnlySeam.test.ts` → `the staff route registry is the only place a surface is named`:
  `scans all four routing-glue modules (cannot vacuously pass) (AC1)`, `the detector actually
  bites: it FINDS those literals in the registry itself (AC1)`, `names no concrete staff surface in
  any routing-glue module (AC1)`

**AC2 — direct render, reload/deep-link/back-forward**
- `StaffRouteTree.test.tsx` → `StaffRouteTree — deep links`: `renders the requested surface directly
  when the role may open it (AC2)`, `renders a shared surface for each role that is allowed on it
  (AC2)`
- `RoleAwareEntry.staffRouting.test.tsx` → `staff deep links`: `mounting at /staff/evaluate with an
  evaluator session renders the dashboard directly (AC2)`, `mounting at /staff/plan with a planner
  session renders the planner workspace directly (AC2)`
- `App.integration.test.tsx`: `renders the evaluator inside the real staff frame with both
  toolstrip zones populated (AC2)`, `renders the exercise-settings surface inside the real staff
  frame (AC2)`

**AC3 — wrong-role path redirects, never renders the foreign surface**
- `StaffRouteTree.test.tsx` → `StaffRouteTree — role gating (allowedRoles is the only gate)`: `does
  NOT render a surface the role is not allowed to open (AC3)`, `sends a planner off the controller
  console to their own default surface (AC3)`
- `StaffRouteTree.test.tsx` → `StaffRouteTree — unknown paths fall back to the role default, never
  to /login (AC3)`
- `RoleAwareEntry.staffRouting.test.tsx` → `staff role gating — allowedRoles decides, not the URL`:
  `a controller at /staff/plan does NOT get the planner surface (AC3)`, `an evaluator at
  /staff/console does NOT get the console surface (AC3)`
- `RoleAwareEntry.staffRouting.test.tsx` → `staff unknown paths land on the role default, not
  /login`: `a bare /staff lands on the role default surface (AC3)`

**AC4 — the three existing surfaces become registry entries, unchanged rendering**
- `staffRouteRegistry.test.tsx` → `STAFF_ROUTE_REGISTRY — the shipped paths (stable deep links)`:
  `maps the three shipped surfaces to their agreed paths (AC4)`
- `App.integration.test.tsx` → `App route table — the staff route registry handed to
  createRoleAwareRoutes`: `hands over the REAL staff route registry, not an ad-hoc table (AC4)`,
  `gives every staff role a default surface to land on — including planner (AC4)`, `mounts a
  surface for each of the three staff roles RoleAwareEntry can route (AC4)`

**AC5 — participant path byte-for-byte unchanged (COR-004)**
- `participantLocationBlindness.test.ts` → `COR-004 — the participant render path is location-blind
  by construction`: `scans the real source of both participant-path modules (cannot vacuously pass)
  (AC5)`, `the detector actually bites: it FINDS location reads in StaffRouteTree.tsx (AC5)`, `finds
  NO location-reading API in any module on the participant render path (AC5)`
- `RoleAwareEntry.staffRouting.test.tsx` → `fail closed — unchanged by staff routing`: `an EXPIRED
  staff session deep-linking to a staff surface still goes to /login (AC5)`, `an EXPIRED participant
  session at a staff path still goes to /login (AC5)`, `an unsupported role (orgAdmin) at a staff
  path goes to /login, never a staff surface (AC5)`, `a staff role with NO reachable surface goes to
  /login with no COBRA chrome mounted (AC5)`

**Isolation (XC-001/XC-002)**
- Same `RoleAwareEntry.staffRouting.test.tsx` sections as AC3/AC5 above (role gating + fail-closed)
  double as the isolation proof — a route redirect never renders the foreign surface even
  transiently.

**Accessibility (NFR-001) — focus management, now route-keyed**
- `StaffRouteTree.test.tsx` → `StaffRouteTree — focus management (NFR-001)`: `moves focus to the
  mounted surface, keyed by ROUTE id`, `labels the focus scope with the surface label, so the
  landing is announced`

**Supporting infrastructure (staffNavigationContext — consumed by story 02)**
- `staffLauncherWiring.test.tsx` → `staff launcher wiring (anti-dead-wiring guard)`: `delivers the
  registry and role to chrome rendered inside a staff surface`, `delivers the scope on every
  registered surface, not just the default one`, `reports UNWIRED outside a staff route tree, so the
  probe can actually fail`

### Existing tests touched (called out deliberately — an edited routing test is a red flag)
`RoleAwareEntry.test.tsx` and `routes.test.tsx` were both edited, not just extended, because the
`RoleAwareEntryProps` shape itself changed:
- `staffSurfaces: Partial<Record<StaffSurfaceRole, ReactNode>>` → `staffRoutes: StaffRouteRegistry`.
  Every existing fixture in both files was rewritten from a per-role `ReactNode` map to a stub
  registry array (`STUB_STAFF_ROUTES` / inline entries) — a mechanical consequence of injecting the
  registry instead of a per-role map, not a behavior change to what a stub asserts.
- `renderEntry()`'s mount point moved from `<Route path="/" element={<RoleAwareEntry .../>} />` to
  `<Route path="*" .../>`, because the staff branch is now a **descendant** `<Routes>`
  (`StaffRouteTree`), which react-router only matches under a splat parent — mirroring exactly how
  `routes.tsx` mounts it in the real app.
- `'mounts the staff surface UNDER the COBRA theme (two-worlds)'` and `'fails closed for a staff
  role with no built surface'` were rewritten to pass a one-entry / zero-entry stub registry instead
  of a `{ controller: ... }` / `{}` map — same assertion, new fixture shape.
- **The one assertion whose expected VALUE changed, not just its fixture:** `'moves focus to the
  newly-rendered staff surface (NFR-001)'` used to assert
  `data-app-shell-focus-scope="staff:controller"` (keyed by ROLE). It now asserts
  `data-app-shell-focus-scope="staff:controller-console"` (keyed by the registry entry's `id`) —
  because the focus scope moved from `RoleAwareEntry`'s single role-level scope to a per-route scope
  inside `StaffRouteTree` (so navigating BETWEEN staff surfaces re-focuses, which a role-keyed scope
  could never do). This is a deliberate behavior widening, not a weakening: the old case (arriving at
  the one staff surface a role has) is still covered, plus the new case (moving between two).
