# Story: Surface launcher (header brand-lockup, role-gated)

**Feature:** Staff navigation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress — built,
**not user-observable in production today** (see "Reviewer finding WR-002" below)
**Requirements:** COR-071  ·  **Design decisions:** none (navigation-model decision this feature
introduces — see feature.md "Design references"; not a filed `D#-xxx` amendment)  ·  **Issue:** —

## Context
Story 01 gives staff surfaces real paths and a registry. This story gives a human a way to *reach*
them without knowing a URL: a launcher menu, anchored to the one element every staff surface
already renders in the same place — the header's brand lockup (`StaffHeader.tsx`, the "PULSE" /
`{surfaceName}` block, currently static text at the far left of the 56px navy header).

The placement is deliberate, not incidental. Three options were considered and rejected:
- **A left nav rail** — the staff shell's contract is exactly three elements (header / toolstrip /
  work area, `SHELL-CONTRACT.md` §1); a rail would be a fourth, contested element the shell was
  never designed to carry.
- **A toolstrip tenant** — the toolstrip is reserved for **consult-on-demand** flyouts (D5-017: the
  toolbox, participant admin, the trainee monitor — things a controller checks in on, not a
  navigation primitive) and is explicitly **one dock, two zones** (D7-011); a surface switcher is
  neither continuous-watch nor consult-on-demand, it is wayfinding, and does not belong in either
  zone.
- **A new header element** — D7-010 already resolved a user-flagged conflict by folding the old
  separate exercise bar *into* the header rather than adding a new strip; adding another new
  element here would repeat exactly the mistake D7-010 fixed.

The lockup survives as the right home: it is present on every staff surface, it is currently inert,
and turning it into a button changes nothing about the header's structure or the shell's element
count.

## What was built
- `features/staffShell/components/SurfaceLauncher.tsx` — the disclosure menu. Reads
  `{registry, role}` either from explicit props or (the wired path today) from
  `useStaffNavigation()` (story 01's `staffNavigationContext.tsx`), filters via `staffRoutesForRole`
  (the same resolver `StaffRouteTree` uses for routing — no second allow/deny list), groups by
  `STAFF_ROUTE_GROUP_ORDER`, and renders a real MUI `<Menu>`/`<MenuItem>` disclosure with
  `aria-current` on the current surface (rendered `disabled`, excluded from the roving tab order).
  Degrades to the original static, non-interactive lockup (`<StaticLockup>`, identical markup and
  `data-testid`) when `entries.length <= 1` or `registry`/`role` are absent.
- `features/staffShell/components/StaffHeader.tsx` — integration: `StaffHeaderProps` gained
  `staffRoutes` / `role` / `currentPath`, forwarded verbatim into `<SurfaceLauncher>` in the header's
  first (brand-lockup) slot.

## Reviewer finding — the launcher never renders in production today (WR-002)
**This is the load-bearing fact for this story's status.** Every one of the three staff roles
(`controller` / `evaluator` / `planner`) maps to **exactly one** registry entry today
(`staffRouteRegistry.tsx`). `SurfaceLauncher`'s own degrade rule — `entries.length <= 1` → render
the static lockup — therefore **always wins** in the shipped app: `staffRoutesForRole(registry,
role)` returns a one-element array for every real session, so the interactive menu path in the
component above is currently **dead code from a user's point of view**, exercised only by tests
that inject a multi-entry stub registry.

Compounding this: none of the three `*Route.tsx` compositions (`ControllerConsoleRoute`,
`EvaluatorDashboardRoute`, `PlannerWorkspaceRoute`) pass `staffRoutes`/`role` as **explicit props**
to `StaffHeader` — `StaffHeader` reads them from `useStaffNavigation()` (story 01's context)
instead, which **is** wired end to end (`StaffRouteTree` → `StaffNavigationProvider` → every
surface it wraps → `StaffHeader` → `SurfaceLauncher`). So the mechanism is correctly wired; the
input to it (a role with more than one reachable surface) simply does not exist yet.

**The reviewer's judgment (Gate 2):** fine to merge as built — the wiring is correct, the degrade
is the deliberate, documented, ACd behavior ("do not render a launcher that goes nowhere"), and it
is indistinguishable on screen from a bug, which is exactly why this note has to live here and not
only in a source comment. **Not fine to mark Complete**, because every AC below describes a menu
that no real session can currently open. It becomes live — and first truly exercised outside a
test — the moment a role gains a second registered surface, which is expected with
`COR-074`/`COR-075` (exercise management, `exercise-lifecycle-admin`).

## Acceptance Criteria
- [x] Given any staff surface, when the caller activates the header's brand lockup (`PULSE` /
      surface name), then a menu opens listing the surfaces the registry (story 01) exposes for the
      caller's role, grouped by function (e.g. Conduct, Configure, Administer) rather than as one
      flat list. **Built and tested against an injected multi-entry registry; not reachable in
      production today — see "Reviewer finding WR-002" above.**
- [x] Given the launcher menu, when it renders, then it shows **only** surfaces the caller's role is
      registered for (story 01's per-surface `roles` field) — never a surface the role cannot reach,
      and never a disabled-but-visible entry that would leak the existence of a surface the caller
      cannot use. **Built and tested; same production-reachability caveat.**
- [x] Given the launcher menu open, when the caller selects an entry, then the router navigates to
      that surface's registered path (story 01) and the menu closes; the currently-active surface is
      marked in the menu (e.g. `aria-current`) so the caller can tell where they already are.
      **Built and tested; same production-reachability caveat.**
- [x] The launcher is the **only** new staff-chrome element this feature adds: it renders inside the
      existing header brand-lockup slot (`StaffHeader.tsx`), draws no second strip, and does not
      alter the toolstrip's two-zone contract (D7-011) or the header's other seven elements
      (identity badge, clocks, state pill, classification tag, presence, preview-as, sign-out).

### Cross-cutting
- [x] **Accessibility (NFR-001):** the launcher is a real disclosure menu — a `<button>` with
      `aria-haspopup="menu"` / `aria-expanded`, a `role="menu"` panel of `role="menuitem"` entries,
      arrow-key navigation, `Escape` to close and return focus to the trigger, and each grouped
      section carries an accessible group label. No group or entry is conveyed by icon/color alone.
      Built and tested (RTL, keyboard-only pass) against the injected registry — the a11y contract
      itself does not depend on the WR-002 reachability gap.

## Out of Scope
The registry itself (story 01); building any of the ~40 surfaces the launcher can eventually list
(most are later-phase — the launcher lists whatever the registry currently holds, which today is
just the three existing staff surfaces plus whatever `exercise-lifecycle-admin` registers);
cross-exercise switching (that is `ExerciseSwitcher`, a different control, addressed by story 04) —
the launcher switches **surface**, never **exercise**; wiring `staffRoutes`/`role` as explicit props
into the three `*Route.tsx` compositions (not needed — `useStaffNavigation()` already delivers them;
see "What was built").

## Technical Notes
Staff world (COBRA/Cadence). `SurfaceLauncher.tsx`, composed into `StaffHeader.tsx`'s existing
brand-lockup slot — a small, additive edit to a Complete story's component, not a rewrite; per the
story's own precedent, `staff-shell/01`'s "Out of Scope" line ("no switcher UX") predates this
feature and is being extended, not violated (a surface launcher is not the COR-005 exercise
switcher that line was scoping out). Reads the story-01 registry filtered by `useStaffNavigation()`
(context) with explicit `registry`/`role` props as an override, mirroring `StaffRouteTree`'s own
injection pattern. MUI 9 `sx`-only; FontAwesome for the disclosure chevron; a native MUI `<Menu>`/
`<MenuList>` is the sanctioned exception to "no bare MUI" on a staff surface (unlike
`Button`/`TextField`, which do have COBRA equivalents). See implementation.md (story 02).

## Dependencies
Story 01 (the registry this reads, and the `staffNavigationContext` it publishes through);
`staff-shell/01` (`StaffHeader.tsx`, Complete — the lockup slot this story makes interactive).

## Tests
Vitest + RTL, all in `SurfaceLauncher.test.tsx` unless noted. All run against an **injected**
multi-entry stub registry — see "Reviewer finding WR-002" for why that does not yet describe any
real session.

**AC1/AC2 — role sees only its permitted surfaces, grouped**
- `SurfaceLauncher — trigger renders as the brand lockup`: `is a real disclosure button with
  aria-haspopup/aria-expanded, closed by default (AC1)`
- `SurfaceLauncher — a role sees exactly its permitted surfaces, grouped (AC1/AC2)`: `lists only
  entries allowedRoles includes the caller for, in STAFF_ROUTE_GROUP_ORDER (not registry order)`,
  `a different role sees a completely different set — never a disabled-but-visible leak of a
  surface it cannot reach`

**AC3 — select navigates + closes; current surface marked and non-re-navigable**
- `SurfaceLauncher — selecting an entry navigates and closes the menu (AC3)`: `navigates to the
  selected entry's registered path`
- `SurfaceLauncher — the current surface is marked and is not a re-navigation destination (AC3)`:
  `the entry matching currentPath carries aria-current="page", is rendered disabled (unclickable —
  never a real pointer target), and never navigates`, `a non-current entry carries no aria-current
  attribute`

**AC4 — only chrome element, no new strip, no toolstrip/other-seven regression**
- `StaffHeader.test.tsx` → `StaffHeader — renders every required region (AC1)`: `renders the brand
  lockup, identity badge, dual clock pair, state pill, FOUO tag, presence, and preview button (AC4)`
  (regression guard: the other seven elements' DOM position/testid presence is unchanged by
  wiring the launcher into slot 1)

**Accessibility (NFR-001) — full keyboard operation**
- `SurfaceLauncher — full keyboard operation (NFR-001)`: `opens with Enter, moves with ArrowDown,
  activates the focused item with Enter, and navigates`, `Escape closes the menu and returns focus
  to the trigger`

**The degrade rule itself (what ships in production today)**
- `SurfaceLauncher — single-surface role degrades to the static lockup (AC: "do not render a
  launcher that goes nowhere")`: `a role that can reach only ONE registry entry renders the plain,
  non-interactive lockup`, `no registry/role supplied at all (every composition today) renders the
  plain lockup`, `registry without a matching role (role omitted) also degrades, never throwing` —
  this is the suite that proves WR-002's claim: with the REAL registry and REAL per-composition
  wiring (none of which passes explicit props), every role hits this path today.

### Existing tests touched
None. `StaffHeader.test.tsx`'s pre-existing assertions (identity badge, clocks, state pill, preview
button, sign-out) were not modified — the launcher is purely additive to slot 1, which is what
AC4 requires and what the "renders every required region" test already covered by testid presence.
