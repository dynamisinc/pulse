# app-shell — role-aware global nav

**Epic E1 · Phase 1 · story `app-shell/01` · Tier-1 · frontend**
Requirements: **COR-004** (participant routed to their exercise, no picker),
**COR-005** (staff reach the console/evaluator + the cross-exercise switcher),
XC-001/XC-002 (isolation), NFR-001 (a11y / focus).

This feature is the **routing glue** that replaces the five flat, URL-typed routes
(`/`, `/evaluator`, `/console`, `/shell`, `*`) with a single **role-aware entry**. It
routes purely on the **resolved role/scope** — never on a client-supplied path or
`exerciseId`.

## World

Routing glue is **world-neutral at the root**; world-specific mounting happens **only at
the hand-off inside `RoleAwareEntry`**:

- **Participant/PIO** → the injected participant surface, wrapped in the composed
  `ParticipantLandingGuard` (exercise-isolation/04). **No COBRA ancestor**, no picker, no
  staff surface reachable.
- **Staff (controller/evaluator/planner)** → the matching injected staff surface, mounted
  inside a **COBRA hand-off** (`ThemeProvider(cobraTheme)`) next to the `ExerciseSwitcher`
  (exercise-isolation/05). Staff-only.
- **Expired / unsupported role** → fail closed to the login entry (`/login`).
- **Unresolved** → the root providers fail closed to `null`; `RootFailClosedBoundary`
  additionally redirects to `/login` if a hook throws.

## Files

| File | Role |
|------|------|
| `RoleAwareEntry.tsx` | The role-aware decision + guard/switcher composition + focus management + fail-closed boundary. Surfaces, the guard, and the switcher are **injected as props** (IoC) — see below. |
| `routes.tsx` | `createRoleAwareRoutes(config)` → `RouteObject[]` the orchestrator splices into `App.tsx`. Establishes the world-neutral `ExerciseContextProvider > SessionProvider > RoleAwareEntry` stack, plus the two real, pre-auth login routes (`/login` → `ParticipantSignInPage`, `/staff/login` → `StaffSignInPage`; feature: login, story 04). |
| `constants.ts` | `LOGIN_PATH` + `STAFF_LOGIN_PATH` (shared, cycle-free). |
| `index.ts` | Public barrel. |

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
