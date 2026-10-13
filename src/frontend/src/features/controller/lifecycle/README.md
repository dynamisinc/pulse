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
  `controller` (`useOptionalSession()`; staff routes sit under the `SessionProvider` hoisted in `app-shell/routes.tsx`;
  `role` prop overrides, for tests). With no session it fails closed — renders nothing — instead of crashing the
  console. Not `useControllerIdentity().role`: that is a hard-coded mock, so gating on it would be a no-op. This only
  hides a control: the server's transition route admits **any** assigned staff session (backend follow-up).
- **Keyboard**: native buttons; while a request is in flight the focusable controls (Start, and the End dialog's field,
  Cancel and confirm) are `aria-disabled` / read-only — never `disabled`, which would drop focus to `<body>` mid-request;
  after a success removes the button that held focus, focus moves to the control's group.
- **With the staff preview open**, the console (and so this control) is unmounted; nothing here is lost, because the
  state is the server's (or, under mock data, the exercise scope's). See `features/staffShell/README.md`.
- No client telemetry: the server records one lifecycle-transition event per applied transition.

## Mock data

Under `USE_MOCK_DATA` (`npm run dev`, the backend-less UAT) nothing is requested: the lifecycle is derived
from the mock exercise scope's `status` (`lifecycleMock.ts`, the backend's table copied), a transition
moves that status through `setMockExerciseStatus` (`core/exerciseContext`), and the same scope refresh
makes the pill follow. The mock exercise starts `live`, so a demo shows **End exercise**; call
`setMockExerciseStatus('staged')` to see Start.

## Files

| File | Role |
|---|---|
| `ExerciseLifecycleControl.tsx` | The control (role gate + body). The only component export the route uses. |
| `EndExerciseDialog.tsx` | The type-to-confirm dialog. |
| `useExerciseLifecycle.ts` | State + `transition(to)`; cache write, scope refresh, one-in-flight guard. |
| `lifecycleService.ts` | `fetchLifecycle`, `postTransition`, the fail-closed parser, error mapping. |
| `lifecycleMock.ts` | The simulated state machine for mock data. |
| `lifecycle.testUtils.tsx` | Test-only render harness. |
