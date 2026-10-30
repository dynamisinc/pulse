# controller/lifecycle — StartEx / EndEx control (staff, COBRA)

Demo-polish story 23 (**C6**, #442), lifecycle half. Puts **Start exercise** and **End exercise** on the
controller console and drives the exercise's COR-032 lifecycle through the staff endpoints that already
exist:

- `GET  /api/staff/exercise-lifecycle` -> `{ exerciseId, state, storedStatus, allowedTransitions[], behaviour }`
- `POST /api/staff/exercise-lifecycle/transition` body `{ to }` -> the same body for the new state
  (400 bad `to` · 401 · 403 not assigned · 404 · 409 the machine refuses; 400/409 bodies are a plain string)

**World: STAFF.** COBRA components, dense, keyboard-first, FontAwesome only, MUI 9 `sx`-only. Nothing
participant-styled is imported (`lifecycle.worlds.test.ts` enforces it, both directions).

## What the console mounts

```tsx
import { ExerciseLifecycleControl } from '@/features/controller/lifecycle'

<ControllerConsole lifecycleSlot={<ExerciseLifecycleControl />} ... />
```

The control is self-contained; it needs the console's providers (`ExerciseContextProvider`, React Query).
`ControllerConsole` renders `lifecycleSlot` in its title row, between the title and the call sign.

## Behaviour

- **Start exercise** for a **staged** exercise (`state === 'staged'` and `live` is in `allowedTransitions`); **End
  exercise** while `completed` is (a live or paused one). A paused exercise also reaches `live`, but that is a
  *resume* — the world-steering tier control's job — so it is never offered as "Start exercise". The server's table
  decides what is reachable. Nothing to press at build / completed / archived: the control renders nothing.
- **Readiness summary at Start** (exercise-build-golive story 04): while Start is offered, `StagedReadinessSummary`
  shows "Readiness: all blocking items done" or "Readiness: N blocking items open — starting is still allowed", icon
  plus words, from `useReadiness()` (imported by direct path from `features/planner/hooks/useReadiness`). Informational
  only: **Start is never gated on it** (the server does not gate StartEx either). It is mounted only for a staged
  exercise, so no readiness request is made otherwise, and shows nothing while readiness loads or fails.
- **Stage (planner)**: `LifecycleTarget` now includes `staged`, used by the planner's `StageExerciseControl`. The server
  can refuse a stage with `409 { error: 'readiness-blocking', message, blocking[] }`; `lifecycleService` parses it
  (fail closed) into a `LifecycleError` with `kind: 'readiness-blocking'` and `blocking` items, and the hook exposes
  them as `transitionBlocking`. Any other 409 keeps its plain-string handling.
- Start runs at once. End opens a **type-to-confirm** dialog: the confirm button stays disabled until the
  field reads `END` (exact, after trimming). The dialog is a modal MUI `Dialog` (`aria-modal`), so the
  console's Ctrl/Cmd+K is inert while it is open.
- On success the response replaces the cached lifecycle (the buttons change at once) and the exercise
  scope is re-resolved (`useExerciseScopeRefresh`) — the header **state pill** reads `status` from that
  scope, so it follows (LIVE -> ENDEX) with no remount.
- Errors are **text**: an icon, a bold lead-in and the reason (the server's own sentence for a 409 / 400
  when it is short, one-line and not markup; otherwise a fixed sentence per status). A failed End is shown
  inside the dialog, which stays open with `END` still typed. A 409 means the console's view was stale, so it also
  re-reads the lifecycle **and** re-resolves the exercise scope (the pill stops showing the old state).
- **Absent for non-controllers**: nothing renders and no request is made unless the **signed-in session's** role is
  `controller` (`useOptionalSession()`; staff routes sit under the `SessionProvider` hoisted in `app-shell/routes.tsx`).
  The control takes **no props** — there is no way to tell it "you are a controller"; tests pick the session
  (`lifecycle.sessionKit.testUtils`). With no session it fails closed — renders nothing — instead of crashing the
  console. Not `useControllerIdentity().role`: that is a hard-coded mock, so gating on it would be a no-op. This only
  hides a control: the server's transition route admits **any** assigned staff session (backend follow-up, #481), so the
  403 sentence says "Only staff assigned to this exercise can change its state."
- **An outcome already reached is a success, not an error.** After a failure that leaves the state unknown (no status,
  408, 5xx, or a 409) the hook re-reads the server. If the exercise is *already at the target* — our request was applied
  and only its answer lost, or another controller got there first — the error is cleared, the End dialog closes, focus
  goes to the control's group, and the polite status region announces it ("The exercise had already ended. The state is
  now ENDEX."). Any other state: the reason stands and an open End dialog is never torn down underneath the controller.
- **The server's exercise must be the one shown.** The lifecycle answer's `exerciseId` echo must match the console's
  exercise (a second tab may have switched the session's active exercise); if not, nothing is offered, the console says
  so, and the scope is re-resolved. The End dialog also **names the exercise** it believes it is ending. The check
  guards a **success** too: a transition's 200 answer that names another exercise (the session was switched between
  the read and the click, so the change landed there) is not announced, does not close the End dialog, and returns
  `false`; the answer is parked under the shown exercise's key so the control drops into the same "different exercise"
  state, the scope is re-resolved, and the reason is shown as text (applied to the session's exercise, not confirmed
  for the one on screen).
- **The status text does not linger**: the result is cleared from the live region after ~5 s, so it can never stay up
  as a stale claim ("the state is now LIVE") after a later freeze.
- **Start is not undone by EndEx.** There is no "un-start"; **Pause** (the world-steering tier control) is the
  mitigation for a premature start, so Start needs no confirm dialog.
- **Keyboard**: native buttons; while a request is in flight the focusable controls (Start, and the End dialog's field,
  Cancel and confirm) are `aria-disabled` / read-only — never `disabled`, which would drop focus to `<body>` mid-request;
  after a success removes the button that held focus, focus moves to the control's group.
- **With the staff preview open**, the console (and so this control) is unmounted; nothing here is lost, because the
  state is the server's (or, under mock data, the exercise scope's). See `features/staffShell/README.md`.
- No client telemetry: the server records one lifecycle-transition event per applied transition.

## Mock data

Under `USE_MOCK_DATA` nothing is requested: the lifecycle is derived from the mock exercise scope's `status`
(`lifecycleMock.ts`, the backend's table copied), a transition moves that status through `setMockExerciseStatus`, and
the same scope refresh makes the pill follow. **But the control never renders in `npm run dev` or the backend-less
UAT**: the mock session is a *participant* (`resolveSession`'s canned persona), and the control is controller-only on
the session's role, so it is absent there — `RoleAwareEntry` would not even route that session to the staff console.
The simulated machine is exercised by the tests, which swap in a staff session (`lifecycle.sessionKit.testUtils`) and
pre-set the status with `setMockExerciseStatus('staged')` / `('live')`.

`setMockExerciseStatus` / `resetMockExerciseStatus` live in `core/exerciseContext/exerciseContextResolver.ts` and are
**not** exported from the `core/exerciseContext` barrel (import them by path, from tests and `lifecycleMock.ts`); both
are no-ops unless `USE_MOCK_DATA` is on.

## Files

| File | Role |
|---|---|
| `ExerciseLifecycleControl.tsx` | The control (role gate + body). The only component export the route uses. |
| `EndExerciseDialog.tsx` | The type-to-confirm dialog. |
| `useExerciseLifecycle.ts` | State + `transition(to)`; cache write, scope refresh, one-in-flight guard. |
| `lifecycleService.ts` | `fetchLifecycle`, `postTransition`, the fail-closed parser, error mapping. |
| `lifecycleMock.ts` | The simulated state machine for mock data. |
| `lifecycle.testUtils.tsx` | Test-only render harness. |
| `lifecycle.sessionKit.testUtils.ts` | Test-only staff-session stand-in (the mock resolver's session is a participant). |
