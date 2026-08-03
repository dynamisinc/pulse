# app-shell — role-aware global nav

**Epic E1 · Phase 1 · story `app-shell/01` · Tier-1 · frontend**
Requirements: **COR-004** (participant routed to their exercise, no picker),
**COR-005** (staff reach the console/evaluator + the cross-exercise switcher),
XC-001/XC-002 (isolation), NFR-001 (a11y / focus).

This feature is the **routing glue** that replaces the five flat, URL-typed routes
(`/`, `/evaluator`, `/console`, `/shell`, `*`) with a single **role-aware entry**. The
**world** is decided purely by the **resolved role/scope** — never by a client-supplied
path or `exerciseId`. Only *after* that decision, and only on the **staff** branch, does
the URL mean anything.

## The two-layer decision (why the catch-all is not a flat route table)

```
`*` catch-all (routes.tsx)          ← ONE route; the URL has not been consulted yet
  > ExerciseContextProvider > SessionProvider
    > RoleAwareEntry                ← layer 1: resolved ROLE decides the world
      ├─ participant / pio  →  participant surface — LOCATION-BLIND (COR-004)
      └─ staff              →  COBRA hand-off > ExerciseSwitcher > StaffRouteTree
                                  ← layer 2: the URL picks the staff surface
```

Flattening `/staff/*` into siblings of `*` would let the URL decide the world, and a
participant typing `/staff/console` would match a staff route. **The single catch-all is
the COR-004 guarantee.** Staff URLs (`/staff/plan`, `/staff/console`, `/staff/evaluate`, …)
are matched one level deeper, by a descendant `<Routes>` that only ever mounts for a
resolved staff role.

## World

Routing glue is **world-neutral at the root**; world-specific mounting happens **only at
the hand-off inside `RoleAwareEntry`**:

- **Participant/PIO** → the injected participant surface, wrapped in the composed
  `ParticipantLandingGuard` (exercise-isolation/04). **No COBRA ancestor**, no picker, no
  staff surface reachable, and **no URL read of any kind** — enforced structurally by
  `participantLocationBlindness.test.ts`.
- **Staff (controller/evaluator/planner)** → the nested `StaffRouteTree` over the injected
  **staff route registry**, mounted inside a **COBRA hand-off**
  (`ThemeProvider(cobraTheme)`) next to the `ExerciseSwitcher` (exercise-isolation/05).
  Staff-only. An unknown or role-unauthorized staff path redirects to that role's
  **default surface** (never to `/login` — a signed-in controller who mistypes lands on
  their console).
- **Expired / unsupported role / staff role with no reachable surface** → fail closed to
  the login entry (`/login`).
- **Unresolved** → the root providers fail closed to `null`; `RootFailClosedBoundary`
  additionally redirects to `/login` if a hook throws.

## Files

| File | Role |
|------|------|
| `RoleAwareEntry.tsx` | Layer 1: the role-aware world decision + guard/switcher composition + fail-closed boundary. Imports **no** location API, so the participant branch cannot read the URL. The registry, the guard, and the switcher are **injected as props** (IoC) — see below. |
| `StaffRouteTree.tsx` | Layer 2: the nested staff `<Routes>`. The **only** module here that reads the location. Registers one route per registry entry the role is allowed to open; everything else redirects to the role's default surface. |
| `staffRouting.ts` | The registry **contract**: `StaffRouteEntry` / `StaffRouteRegistry` / `StaffRouteGroup` / `StaffSurfaceRole`, the group ordering + labels, and the pure resolvers (`staffRoutesForRole`, `resolveDefaultStaffRoute`, `isStaffSurfaceRole`, `toDescendantRoutePath`). No surfaces, no router, no theme. |
| `RouteFocusScope.tsx` | Shared programmatic focus target (NFR-001). Used once for the participant world and once per staff route. |
| `routes.tsx` | `createRoleAwareRoutes(config)` → `RouteObject[]` the orchestrator splices into `App.tsx`. Establishes the world-neutral `ExerciseContextProvider > SessionProvider > RoleAwareEntry` stack, plus the two real, pre-auth login routes (`/login` → `ParticipantSignInPage`, `/staff/login` → `StaffSignInPage`; feature: login, story 04). The catch-all **must stay a splat** — the staff tree is a descendant `<Routes>`. |
| `constants.ts` | `LOGIN_PATH` + `STAFF_LOGIN_PATH` (shared, cycle-free). |
| `index.ts` | Public barrel. |

## Adding a staff surface

Build the surface's route composition in **its own feature**, export it, then add **one
entry** to `STAFF_ROUTE_REGISTRY` in
[`@/features/staff/staffRouteRegistry`](../staff/staffRouteRegistry.tsx). Nothing in this
feature is edited — `registryIsTheOnlySeam.test.ts` fails if a concrete surface path, id
or component name ever appears in a routing-glue module, and `StaffRouteTree.test.tsx`
proves a surface the glue has never heard of routes anyway.

`allowedRoles` is the **single** gate: it drives routing today and launcher visibility
later. Do not add a second visibility check anywhere — it will drift.

## Guard tests (each verified to fail when its guard is removed)

| Test | Guards |
|------|--------|
| `RoleAwareEntry.staffRouting.test.tsx` | COR-004 (participant location-blindness across 8 typed paths, incl. no canonicalising redirect), staff deep links, `allowedRoles` gating, unknown-path → role default, expired/unsupported → `/login`. |
| `participantLocationBlindness.test.ts` | The structural half of COR-004: no module on the participant render path imports a location API. Self-proving — the same scan must find location reads in `StaffRouteTree.tsx`. |
| `registryIsTheOnlySeam.test.ts` | No concrete surface literal in any routing-glue module. |
| `StaffRouteTree.test.tsx` | Deep links, gating, the unknown-path fallback, per-route focus, and the "one entry is the whole edit" behaviour. |
| `staffRouting.test.ts` | The pure resolvers + the `STAFF_SURFACE_ROLES` ≡ core `STAFF_ROLES` drift guard. |

## Inversion of control (why surfaces + guard + switcher are props)

All concrete, cross-world wiring is **injected** and supplied by the composition root
(`App.tsx`):

- The **surfaces** live in `App.tsx` today (participant is inline `BrandThemeProvider →
  ShellLayout → channel`; `EvaluatorDashboardRoute` is defined/exported by `App.tsx`).
- The **guard** (`ParticipantLandingGuard`, exercise-isolation/04) and **switcher**
  (`ExerciseSwitcher`, exercise-isolation/05) ship on sibling branches and are **not
  resolvable on this branch**.

`RoleAwareEntry` therefore imports **none** of them; it takes them as props and owns the
security-relevant **composition** — wrap the participant surface in the guard, mount the
switcher + COBRA hand-off around the staff surface — plus focus and fail-closed. The
orchestrator supplies the concrete pieces (including the two contract-first imports) in the
`App.tsx` integration seam, where they resolve once iso/04 + iso/05 merge alongside.

This IoC is also what keeps the **isolated build/test green**: a static
`import … from '@/features/staff'` (a module that does not yet exist) fails Vite's
`import-analysis` at transform time — before `vi.mock` can intercept — so the suite could not
run in isolation. Injecting the seams sidesteps that and moves the contract-first imports to
the one place that must know the concrete surfaces anyway: `App.tsx`.
