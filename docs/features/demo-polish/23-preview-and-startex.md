# Story: Preview-as-participant shows the real feed, and StartEx/EndEx (Could)

**Feature:** Demo polish  ·  **Epic:** E1 / E7  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** COR-041, COR-054, COR-032, NFR-001  ·  **Design decisions:** D7-007 (preview), D1-011  ·  **Issue:** #442
**Story ID:** C6  ·  **Stack:** frontend  ·  **Priority:** Could  ·  **Effort:** S  ·  **Wave:** 3 slot (cut first if time is short)
**Home stories:** [`staff-shell/04`](../staff-shell/04-preview-as-participant.md), [`exercise-configuration/03`](../exercise-configuration/03-exercise-lifecycle.md).

## Context
**As** a presenter, **I want** the console's "preview as participant" to show the real social feed and a
StartEx/EndEx button on the console, **so that** I can show the participant view from staff chrome and start and
end the exercise on stage. Today the preview stage renders `PortalStub`, and the lifecycle transition endpoint
(`POST /api/staff/exercise-lifecycle/transition`) exists but nothing calls it. **World: staff chrome around a
participant render** — the preview is the *one* place the participant channel is mounted inside staff chrome, so
it keeps the labelled "PREVIEW AS PARTICIPANT — READ-ONLY" strip and a neutral mat; the participant subtree gets
**no COBRA theme** and the staff frame gets no participant skin.

## Acceptance Criteria
- [x] **Real channel in the preview.** `PreviewAsParticipant` mounts the participant `SocialChannel` (inside
      `BrandThemeProvider` and `ShellContextProvider` with `variant: 'preview'`, scenario time from the chosen
      moment) instead of `PortalStub`. It mounts under F1's **`MemorySocialNavigationProvider`**: in-memory
      location, no browser-history writes. So a thread, profile or hashtag link inside the preview never
      navigates the staff page, and an unknown path stays inside the preview (depends on F1's
      navigation-adapter AC); the staff label strip and Exit control are unchanged.
      **[Amended by the orchestrator after Gate-1: the original "moment picker … unchanged" is SUPERSEDED — the
      picker is NOT rendered. See Amendments, W-4.]**
      *Tests:* [`PreviewAsParticipant.channel.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewAsParticipant.channel.test.tsx)
      (the real feed in the frame; thread / profile / Explore stay inside the preview and never move the router,
      `window.location` or history), [`PreviewChannelHost.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewChannelHost.test.tsx)
      (variant, scenario time, in-memory navigation, brand), [`PreviewAsParticipant.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewAsParticipant.test.tsx)
      (strip, Exit, no picker).
- [x] **Read-only.** In the `preview` variant the composer, follow, like/repost and compose-modal controls are
      absent (`affordancesAvailable` false) — no write can be issued from the preview; the feed it shows is the
      exercise's real feed. **[Amended after Gate-1: enforced by three independent layers — the variant, a
      read-only session scope, and a mute of PARTICIPANT-kind telemetry only. See Amendments, CR-001.]**
      *Tests:* [`PreviewAsParticipant.channel.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewAsParticipant.channel.test.tsx)
      (`expectNoWriteControls` on Home, a thread and a profile: no composer, Post, Follow, like / repost / reply
      buttons, no Notifications entry or store, no `localStorage` write; no POST / PUT / PATCH / DELETE; no telemetry),
      [`PreviewChannelHost.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewChannelHost.test.tsx),
      [`mockSink.mute.test.ts`](../../../src/frontend/src/core/telemetry/mockSink.mute.test.ts) (participant-only mute),
      [`session.readOnlyScope.test.tsx`](../../../src/frontend/src/core/auth/session.readOnlyScope.test.tsx).
- [x] **Two-worlds guards stay true.** `previewStubTwoWorlds.test.ts` / `twoWorldsSeparation.test.ts` are
      updated to the new composition and pass: the participant subtree has no COBRA ancestor; the staff strip
      has no participant tokens.
      *Tests:* [`previewStubTwoWorlds.test.ts`](../../../src/frontend/src/features/staffShell/previewStubTwoWorlds.test.ts)
      (the participant host imports no COBRA / MUI; the staff strip no participant token),
      [`twoWorldsSeparation.test.ts`](../../../src/frontend/src/features/staffShell/twoWorldsSeparation.test.ts) (the host is scanned with the
      participant roots), and the runtime check (no `Mui` element in the participant subtree) in
      [`PreviewAsParticipant.channel.test.tsx`](../../../src/frontend/src/features/staffShell/components/PreviewAsParticipant.channel.test.tsx).
- [x] **StartEx / EndEx control.** The console shows **Start exercise** when the lifecycle state allows `live`
      and **End exercise** when it allows `completed`, calling `POST /api/staff/exercise-lifecycle/transition {
      to }`; End requires a type-to-confirm ("END"); the header state pill reflects the new state; errors are
      visible; the control is absent for non-controller roles; keyboard-operable and text-labelled (never
      color-only). **[Amended after Gate-1: Start is offered for a STAGED exercise only (W-1); "non-controller"
      is judged on the signed-in SESSION's role (W-2). See Amendments.]**
      *Tests:* [`ExerciseLifecycleControl.test.tsx`](../../../src/frontend/src/features/controller/lifecycle/ExerciseLifecycleControl.test.tsx)
      (mock data: allowed-transitions gating, type-to-confirm, the pill following, keyboard, absent for non-controller
      sessions), [`ExerciseLifecycleControl.live.test.tsx`](../../../src/frontend/src/features/controller/lifecycle/ExerciseLifecycleControl.live.test.tsx)
      (the live endpoints: request shapes, every error as text, uncertain failures re-read, an outcome already reached
      is a success), and [`ControllerConsoleRoute.c6.test.tsx`](../../../src/frontend/src/features/controller/ControllerConsoleRoute.c6.test.tsx)
      (mounted in the real route: Start / End move the pill — also while WORLD FROZEN —, Ctrl+K inert while the End
      dialog is open, preview toggle and Exit).

## Out of Scope
Pause/resume (already built), time jumps, practice mode, the portal/news/weather previews, wiring beyond the
console route, EndEx page content.

## Technical Notes
- Files: implementation.md §4.1 row C6 — `staffShell/components/{PreviewAsParticipant,PortalStub}.tsx` (+
  tests), new `controller/lifecycle/**` (control + `useExerciseLifecycle` over `GET
  /api/staff/exercise-lifecycle` and the transition route). The orchestrator mounts the preview toggle and the
  control in `ControllerConsoleRoute.tsx` (today the route mounts no preview: "not wired here" — the
  orchestrator also updates that header comment, which says the session is not in the stack; the preview needs the
  `SessionProvider` that `app-shell/routes.tsx` hoists above the staff tree). Reuse
  `usePreview`, `previewContext.ts`, `mountContract.ts` (`ShellContextProvider`, `affordancesAvailable`).
- Under mock data the lifecycle hook simulates the transition. This is the first story to cut under Cut line 2
  pressure.

## Dependencies
F1 (the channel to mount); lifecycle API exists. Runs alone.

## Tests
- Preview composition renders the channel under `preview`, no write affordances, two-worlds tests; lifecycle
  control: allowed-transitions gating, type-to-confirm, success/error, absent for non-controllers.

## Amendments (amended by the orchestrator after Gate-1)
Gate-1 on C6 (the code-review gate) was not clean. These amendments supersede the ACs above where they differ.

- **CR-001 (Critical) — the telemetry mute is participant-only.** The preview mutes telemetry so the real channel
  does not report `view` events about a participant who does not exist (and a staff session's `participant` events
  are refused by the server anyway). The first cut muted EVERYTHING process-wide, which would silently drop a
  staff audit record emitted while a preview is open — e.g. C5's takedown emits its only record client-side, in
  the request's `.then`. The mute now drops events whose `actor.kind === 'participant'` and nothing else; `persona`,
  `engine` and `system` (incl. `steering_action`) events are buffered and POSTed as usual. Every read-path emitter
  under `features/social` (feed, thread, profile, hashtag, explore, search) states `participant`. A mute's release
  carries a generation token, so a release taken before `resetTelemetryBuffer()` cannot decrement a newer hold.
- **W-1 — Start is for STAGED only.** `paused` also allows `live`, but that is a resume (the world-steering tier
  control), not a start: the control offers **Start exercise** when the state is `staged` and `live` is allowed.
- **W-2 — the controller-only gate reads the real session.** `useControllerIdentity().role` is hard-coded
  `'controller'`, so gating on it was a no-op. The control gates on the signed-in session's role (staff routes sit
  under the hoisted `SessionProvider`); with no session it renders nothing. **Backend follow-up (orchestrator
  files it; not changed here):** `POST /api/staff/exercise-lifecycle/transition` is gated by
  `EngineCockpitStaffAuthorizationFilter`, which admits ANY staff session assigned to the exercise — an assigned
  evaluator or planner can call it directly. "Controller only" is enforced in the client until the server enforces it.
- **W-3 — a render error in the channel stays in the preview.** The participant frame sits in a local error
  boundary: a throw shows "Participant preview unavailable", keeps the strip and Exit, and never reaches the app's
  fail-closed boundary (which redirects to `/login`). The preview's telemetry hold is released with the subtree.
- **W-4 — the moment picker is NOT rendered (AC1 amended).** The real Social channel dates every post from the
  global scenario clock (`useScenarioTime`), not from the shell mount's `scenarioNow`, and the old `PortalStub`
  alert/headline copy is gone, so choosing STARTEX / ADVISORY / BURST / NOW changed nothing the audience could see;
  a picker that changes nothing is worse on stage than none. The moment model and `PreviewProvider` stay for a
  channel (or an "as of" feed view) that can honour a moment; the stage mounts the channel at the default moment,
  `now`. The participant-facing moment copy in `previewContext.ts` is trimmed.
- **W-5 — the console unmounts while the preview is up (decided; accepted).** The preview REPLACES the work area
  (the same swap `EvaluatorDashboardRoute` uses), so React state the console held is gone on Exit.
  - *Survives:* the active persona (`ActivePersonaProvider` sits above the swap); persona-composer drafts and the
    reply they were written for (module draft store; the composer restores the reply when it remounts — the dock has
    to be reopened); the review queue's items and the engine / swamped-mode / pause state (module stores); the
    toolstrip. An engine draft's countdown is deadline-based on the scenario clock, so one that expires while the
    preview is open resolves (default: Hold) the moment the console returns — nothing auto-sends meanwhile.
  - *Lost:* an open inline edit in a console panel (a run-sheet item edit, a review-queue draft edit), whether the
    persona dock was open, and panel scroll positions.
  - The alternative — keep the console mounted but `hidden`/`inert` — was rejected for the demo: it would need ⌘K and
    the other global key handlers gated while hidden, which is a `ControllerConsole` change.
- **Decision (c) — the media viewer covers the staff chrome (accepted).** The lightbox is portalled to `<body>`, so
  while it is open it covers the staff header and the preview strip until Esc. Accepted for the demo; noted in the
  `staffShell` README.
- **Suggestions folded in:** on a 409 the control also re-resolves the exercise scope (the pill stops showing the
  old state); the End dialog's focus-holding controls use `aria-disabled` / read-only while pending, never
  `disabled`; Exit returns focus to the header preview toggle; unused participant-facing moment copy is trimmed
  from `previewContext.ts`; the mock lifecycle's legacy-status mapping is an exhaustive `Record` over
  `core/exerciseContext`'s `ExerciseStatus` vocabulary (no other module canonicalizes statuses).

## Amendments (Wave 4 Gate-2 lens A fold)
Gate-2 on C6 and the console seam came back clean (0 Critical); the Warnings and Suggestions were folded in on the umbrella.

- **W-1 — an uncertain failure that landed anyway is a success.** When a transition fails with no status, a 408, a
  409 or a 5xx, the control re-reads the lifecycle; if the exercise is now at the state that was asked for (and it
  is the same exercise), the control reports success (`alreadyDone`), clears the error and says so in the polite
  status region ("The exercise had already ended. The state is now ENDEX."). An open End dialog is never torn down
  by the control going quiet, and focus never falls to `<body>`.
- **W-2 — the header pill reads ENDEX after End, even while a pause tier is active (display rule, not a reset).**
  The pause-tier override on the state pill applies only while the exercise is `live` / `paused` / `active`. After
  EndEx the pill shows ENDEX whichever tier the module store still holds. Chosen over resetting the tier on End
  because a reset would add a second server write from the lifecycle control, couple two steering features, and
  miss an EndEx performed from another console.
- **W-3 — one `main`, and the preview is a named region.** The staged preview is a
  `<section aria-label="Participant preview (read-only)">`; the staff work area stops being a `main` landmark while a
  preview is staged (`StaffShellFrame` via `useOptionalPreview`), so the channel's own `main` is the page's only one;
  the preview's error fallback supplies a `main` of its own. Done from the staff side; `SocialChannel` is untouched.
- **Suggestions folded in:** the read-only test also covers Notifications (the F7 seam); the mock status setters are
  out of the `core/exerciseContext` barrel and are a no-op unless `USE_MOCK_DATA`; the End dialog names the exercise
  it will end, and `parseLifecycle` keeps `exerciseId` — an answer for a different exercise than the one shown
  refreshes the scope and offers nothing; the Start comment says EndEx does not undo Start (Pause is the
  mitigation); the control takes no `role` prop (it is hidden, not configured); the 403 copy reads "staff assigned to
  this exercise" until backend follow-up #481; the `lifecycle-status` message clears after about 5 s; the
  `lifecycleSlot` element is a module constant.
