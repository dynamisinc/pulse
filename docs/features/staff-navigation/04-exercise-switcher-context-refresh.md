# Story: Exercise-switcher context refresh + the dead participant-admin footer link

**Feature:** Staff navigation  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Blocked — CRITICAL
defect found at Gate 2 (CR-001), fix in progress by another agent right now. Do not merge until
re-verified.
**Requirements:** COR-073  ·  **Design decisions:** none  ·  **Issue:** —

## Blockers
**CR-001 (Critical, Gate 2):** the header badge does not update after a switch, in the exact
composition the app actually ships (see "Root-cause: the nested-provider defect" below). A fix is
being authored **right now, in this working tree, by another agent** — do not treat anything below
as verified until that lands and the suite is re-run against the real nested composition. **AC1 is
deliberately left unticked** pending that re-verification; do not flip it to `[x]` from this
document alone.

## Context
Two small, already-documented staff-navigation bugs, grouped into one story because both are
"a staff control claims to navigate/refresh and silently doesn't."

**Bug 1 — the switch happens, the header doesn't know.** `ExerciseSwitcher`
(`src/frontend/src/features/staff/components/ExerciseSwitcher.tsx`) POSTs
`/api/staff/active-exercise` and the mutation succeeds — the server-side scope really does change,
and every React-Query-backed staff query re-scopes correctly (the mutation invalidates the cache in
full). But `ExerciseContextProvider` (`core/exerciseContext/exerciseContext.tsx`) resolves its scope
**once on mount** and (before this story) had no refetch/invalidate hook, by design (documented in
that module's own header as a deliberate fail-closed trade-off against React Query's stale-serving
semantics). So `StaffHeader`'s exercise-name badge — and anything else reading
`useExerciseContext()` directly rather than through React Query — kept showing the **pre-switch**
exercise name until something remounted the provider tree. `ExerciseSwitcher.tsx`'s own module
header names this exact gap and tracked it as "a follow-up story"; this is that story.

**Bug 2 — a raw `href` where a route belongs.** `ParticipantAdminFlyout.tsx` used to render its
footer link as `<CobraLinkButton href="/staff/participant-admin" ...>` — a plain anchor. `/staff/
participant-admin` is not a route anything in `routes.tsx`/`RoleAwareEntry`/the story-01 registry
recognizes, so this anchor was a dead control masquerading as navigation — exactly the kind of
"focusable dead control" `StaffHeader.tsx`'s own module header calls out as unacceptable under
NFR-001.

## What was built (mechanism, for Bug 1)
- `core/exerciseContext/exerciseContext.tsx` gained `useExerciseScopeRefresh()`: a zero-argument,
  server-authoritative re-resolution function. It takes **no arguments** (the server decides, the
  caller cannot assert a new exercise); it is an **atomic commit** (the provider never returns to
  `loading` mid-refresh, so children are never unmounted — no lost focus, no blown-away open
  flyouts); and it stays **fail-closed** (a failed refresh transitions the provider to `error`,
  which renders nothing — see "WR-007" below — rather than continuing to serve the pre-refresh
  scope). A monotonic attempt token ensures only the newest in-flight refresh may ever commit.
- `features/staff/hooks/useSetActiveExercise.ts` calls it in the documented order — **cancel →
  re-resolve → commit → reset**:
  1. `queryClient.cancelQueries()` — abort anything issued under the prior scope before it can land
     as new-exercise data mislabeled with the old scope;
  2. `refreshExerciseScope()` — ask the server what the scope now is; the provider commits it in one
     state update;
  3. `queryClient.resetQueries()` — only now discard every cached query and refetch, so no frame is
     ever painted with prior-exercise data under the new scope.
  A failed step 2 removes the (now-foreign) cache and surfaces a `StaffAssignmentError` rather than
  silently keeping stale data reachable.
- `ExerciseSwitcher.tsx`'s local `justSwitchedTo` state was **kept, not removed**, but is no longer
  the mechanism — it is a provisional, server-sourced echo of the switch response, dropped the
  moment the provider's own `scope.exerciseId` changes (a `useEffect` keyed on it). See "Mock/live
  divergence" below for why it is still doing real work in `USE_MOCK_DATA` mode.
- `ParticipantAdminFlyout.tsx`'s footer link was **removed outright**, not converted to a
  client-side `Link`: `/staff/participant-admin` has no registry entry (`identity-auth-roles/08` is
  Not Started), so there is deliberately nothing focusable there today — matching the AC's sanctioned
  "absent, not a dead control" alternative, and the house pattern already used elsewhere in this
  component for role-gated quick actions. The module header leaves an explicit note to restore it
  as a `<Link>`/`useNavigate` control, never a raw `href`, the moment a registry entry exists.

## Root-cause: the nested-provider defect (CR-001)
`App.tsx` hoists **one** `ExerciseContextProvider` above `RoleAwareEntry` (`ExerciseContextProvider
> SessionProvider > RoleAwareEntry`). `RoleAwareEntry`'s staff branch renders the injected
`staffSwitcher` (`ExerciseSwitcherSlot` → `ExerciseSwitcher`) as a **sibling** of `StaffRouteTree`,
both under that same outer provider. But every one of the three staff route compositions
(`ControllerConsoleRoute`, `EvaluatorDashboardRoute`, `PlannerWorkspaceRoute` — the elements
`StaffRouteTree` mounts per registry entry) **also mounts its own `<ExerciseContextProvider>`**
around its own content, including `StaffHeader`. `App.tsx`'s own module header calls this "a
deliberate, benign re-resolve of the same host/auth-resolved scope."

The consequence: `ExerciseSwitcher` calls `useSetActiveExercise()` → `useExerciseScopeRefresh()`,
which resolves against the **OUTER** provider's context value (the one `ExerciseSwitcher` is
actually mounted under). `StaffHeader`'s badge calls `useExerciseContext()` against the **INNER**
provider mounted by the surface composition it is rendered inside. These are two **separate**
instances of the provider's internal `useState` — refreshing one has no effect on the other. So:

1. The switch happens (the server really re-scopes the session).
2. The OUTER provider re-resolves and commits — but nothing reads it, because nothing staff-facing
   is mounted directly under the outer provider except the switcher itself.
3. `resetQueries()` still runs (it is not gated on which provider committed), so every staff
   surface's React-Query-backed data **does** re-fetch under the new server scope.
4. The INNER provider — the one `StaffHeader`'s badge actually reads — never refreshes, so the
   badge keeps showing the **pre-switch** exercise name while the surface underneath it is already
   rendering **new**-exercise data.

That is a **worse** failure than the pre-story bug this story set out to fix: not "stale everywhere"
but "the badge lies about which exercise the visible data belongs to" — precisely the mixed-frame
confusion `useSetActiveExercise.ts`'s own module header says the ordering guarantee exists to
prevent, defeated by a provider topology the ordering guarantee has no visibility into.

**Why the fixture-based tests missed it:** every test asserting this behavior
(`exerciseContextRefresh.test.tsx`, `useSetActiveExercise.contextRefresh.test.tsx`) mounts the
switcher and the consumer (a probe standing in for `StaffHeader`) as **siblings under a single
shared `<ExerciseContextProvider>`** — which is not the shape the app actually ships. A
single-provider fixture proves the refresh mechanism works when there is one provider to refresh;
it cannot prove anything about what happens when there are two. **This must never again be accepted
as proof for this AC** — the fixture has to nest a provider inside another, matching
`ControllerConsoleRoute`/`EvaluatorDashboardRoute`/`PlannerWorkspaceRoute`'s real shape, before this
AC can be ticked.

## Reviewer finding — WR-007: a failed re-resolve blanks the app with no recovery
`ExerciseContextProvider` renders `null` whenever `state.kind !== 'ready'` — by design, for the
mount-time fail-closed contract (COR-001: never serve a default/unscoped/stale scope). Extended
unchanged to the refresh path, a **failed refresh** now also renders `null`: the entire staff
console (or, at the outer provider, the whole staff world) goes blank, with no retry button, no
message, no way back short of a manual reload. The reviewer's finding: fail-closed is the right
call *safety-wise*, but a silent blank screen is not an acceptable **recovery** experience for a
staff member mid-conduct. **Also being fixed alongside CR-001** — track the resolution here, and do
not tick the corresponding AC below until a recovery affordance (at minimum a visible message, ideally
a manual retry) exists.

## Mock/live divergence — the mock switch does not move the mock badge
**A known high-yield bug class in this repo** (mock and live paths silently diverging while every
test — which runs the mock — stays green). Concretely here: `setActiveExercise`'s mock adapter
(`features/staff/services/staffAssignmentsService.ts`, `activeExerciseMockAdapter`) is **stateless**
— it validates the requested `exerciseId` against a fixed `MOCK_ASSIGNMENTS` list and echoes back a
200, but writes nothing anywhere. `resolveExerciseContext`'s mock adapter
(`core/exerciseContext/exerciseContextResolver.ts`, `mockAdapter`) is **equally stateless** — it
always resolves to the same fixed `MOCK_EXERCISE_CONTEXT` (`ex-mock-0001` / "Coastal Surge") no
matter what was just switched to. The two mock modules share no fake session, so **even with the
CR-001 provider-topology defect fixed**, a switch in `USE_MOCK_DATA` mode (dev, and UAT today) will
re-resolve to the exact same canned exercise it started at — the header badge (and everything else
reading the refreshed scope) will not visibly move, even though the mechanism is correct against a
real backend. `ExerciseSwitcher.tsx`'s own module header already flags this explicitly and is why
`justSwitchedTo`'s local echo is not pure legacy cruft: in mock mode it is *the only place* a switch
is visibly reflected at all.

**Whether this warrants its own follow-up story:** recorded here as an open question, not decided.
A real backend makes this moot; a mock/UAT demo of "the badge visibly updates" does not work until
either (a) a real backend is used, or (b) the two mock adapters are given a shared, mutable fake
session (a small addition — a module-level "current mock exercise" variable both adapters read/
write). Left for the next builder or the person triaging demo needs to decide; do not build (b)
speculatively as part of this story's CR-001 fix.

## Acceptance Criteria
- [ ] Given a staff member switches active exercise via `ExerciseSwitcher`, when the switch mutation
      succeeds, then every mounted `useExerciseContext()` consumer — including `StaffHeader`'s
      exercise-name badge — reflects the new exercise **without** a full page reload and without
      relying on the switch mutation's own local `justSwitchedTo` state (today's workaround, scoped
      to `ExerciseSwitcher` alone). **NOT verified — this is CR-001. The refresh mechanism itself is
      built and proved against a single-provider fixture; the real, nested two-provider composition
      is what currently fails this AC. Leave unticked until the fix lands and is re-tested against
      the real nesting (see "Root-cause" above).**
- [x] Given the fail-closed design intent of `ExerciseContextProvider` (no default/unscoped/stale
      scope ever silently served), when this story adds a refresh path, then it does **not**
      reintroduce React-Query-style stale-serving semantics — a failed refresh still fails closed,
      it does not keep serving the old scope indefinitely as if refresh had never been attempted.
      Built and proved (see Tests). **Recovery UX for that failure is WR-007, tracked separately and
      not yet built — the fail-closed *safety* property is what this AC checks, not recoverability.**
- [x] `ParticipantAdminFlyout.tsx`'s footer link ("Open full participant admin →") uses client-side
      navigation (React Router, not a raw `href`) to a real registered path — either the
      story-01 registry's slot for the full participant-admin surface (`identity-auth-roles/08`,
      Not Started) or, until that surface exists, is visibly and honestly disabled/absent rather
      than linking to nowhere (matching the house pattern of "absent, not a dead control," already
      used elsewhere in this same component for role-gated quick actions). **Built: the "absent"
      branch — the link is removed outright, not converted to a disabled control, until a registry
      entry exists.**
- [x] Both fixes are staff-world only and touch no participant-facing behavior; neither introduces a
      new telemetry event (this is chrome/plumbing, not a participant/persona action, XC-004).

### Cross-cutting
- [x] **Accessibility (NFR-001):** the corrected footer link remains a real, keyboard-reachable
      control with an accurate accessible name — never a button whose activation silently does
      nothing or reloads the page unexpectedly. (Satisfied trivially by the "absent" resolution: an
      absent control cannot be a dead one.)

## Out of Scope
Building the full participant-admin surface itself (`identity-auth-roles/08`); any change to
`ExerciseSwitcher`'s own UI/assignment-listing behavior (Complete, out of scope beyond the refresh
mechanism); the conduct-time static-badge suppression (`console-shell/03`, a separate, already-
tracked follow-up on the same switcher story); collapsing the outer/inner `ExerciseContextProvider`
duplication architecturally (the CR-001 fix in progress may choose to bridge the two, remove the
inner mounts, or something else — that design decision belongs to the fix in progress, not
pre-decided by this write-up); building a shared mock fake-session between the two mock adapters
(see "Mock/live divergence" — explicitly left as an open question, not this story's job to decide).

## Technical Notes
Staff world (COBRA). The refresh mechanism lives on `ExerciseContextProvider`
(`core/exerciseContext/exerciseContext.tsx`) and is consumed by `useSetActiveExercise`
(`features/staff/hooks/useSetActiveExercise.ts`); the footer-link fix is contained inside
`ParticipantAdminFlyout.tsx`. **The defect is topological, not logical** — the refresh function
itself is correct; it is refreshing the wrong (or rather, an insufficiently-shared) provider
instance. Whoever finishes the CR-001 fix should read `App.tsx`'s module header ("Each staff route
composition mounts its OWN `ExerciseContextProvider`") before choosing an approach — the "deliberate,
benign re-resolve" framing there was written for a *mount-time* re-resolve of a scope that never
changes mid-session; it does not hold once the scope IS expected to change mid-session (exactly
what this story adds). See implementation.md (story 04).

## Dependencies
`exercise-isolation/05` (`ExerciseSwitcher`, Complete — the mutation this story hooks into);
`core/exerciseContext` (Complete Wave-0 seam — the provider this story extends); `staff-shell/03`
(`ParticipantAdminFlyout`, Complete — the footer link this story fixes); `staff-navigation/01` (the
registry the corrected footer link should eventually resolve into, once
`identity-auth-roles/08` exists).

## Tests
Vitest + RTL. The AC1 mechanism tests below are real and green — **against a single-provider
fixture only**; see "Root-cause" for why that does not yet prove AC1 for the shipped app.

**Refresh mechanism (single-provider fixture — proves the mechanism, NOT the real nesting)**
- `exerciseContextRefresh.test.tsx` → `useExerciseScopeRefresh — the switch actually re-scopes the
  UI (COR-073)`: `re-renders a useExerciseContext() consumer under the NEW exercise, with no remount`,
  `never unmounts children mid-refresh (no window with the tree gone)`, `is SERVER-authoritative:
  takes no arguments, and commits the server answer`
- `exerciseContextRefresh.test.tsx` → `useExerciseScopeRefresh — a failed refresh FAILS CLOSED`:
  `renders nothing rather than continuing to serve the pre-refresh scope` (proves the second AC —
  fail-closed safety, not WR-007 recoverability)
- `exerciseContextRefresh.test.tsx` → `useExerciseScopeRefresh — only the latest attempt may commit`:
  `a superseded refresh cannot resurrect the older scope`
- `exerciseContextRefresh.test.tsx` → `participant paths are unaffected (COR-004, XC-002)`: `resolves
  exactly once on a participant mount — the refresh path adds no extra fetches`, `grants no
  exercise-selection capability — the module still exports none (COR-004)`, `cannot be steered: even
  if a participant surface called it, the server decides`
- `useSetActiveExercise.contextRefresh.test.tsx` → `useSetActiveExercise — a switch re-scopes every
  useExerciseContext() consumer (COR-073)`: `shows the NEW exercise name after the switch, with no
  reload and no remount`, `never paints a mixed frame: no new data under the old scope, no old data
  under the new`, `runs the transition in the documented order: cancel → re-resolve → reset`,
  `resolves the mutation only AFTER the new scope is committed (success means re-scoped)`
- `useSetActiveExercise.contextRefresh.test.tsx` → `useSetActiveExercise — a failed post-switch
  re-resolve fails closed`: `does not keep serving the pre-switch exercise`

**STILL NEEDED before AC1 can be ticked (not yet written):**
- An integration test mounting the REAL nested shape — an outer `ExerciseContextProvider` (as
  `App.tsx` hoists it) wrapping `RoleAwareEntry`'s staff branch, with `ExerciseSwitcher` mounted as
  a sibling of a staff route composition that mounts its OWN inner `ExerciseContextProvider` around
  a `StaffHeader` probe — asserting the badge updates after a switch in THAT shape. This is the test
  that would have caught CR-001; write it as part of (or immediately after) the fix.

**Bug 2 — the dead footer link**
- `ParticipantAdminFlyout.test.tsx` → `ParticipantAdminFlyout — flyout content, closed by default
  (AC1)`: `renders no dead footer link — no raw href to an unbuilt surface (AC3, NFR-001)`

### Existing tests touched
None identified as rewritten — `exerciseContextRefresh.test.tsx` and
`useSetActiveExercise.contextRefresh.test.tsx` are new files; `ParticipantAdminFlyout.test.tsx`'s
footer-link case was rewritten from "renders a link to X" to "renders no dead footer link" as a
direct consequence of the "absent, not disabled" resolution — flagged here per the house convention
of calling out any edited assertion on a previously-shipped surface, even one this story owns
outright.
