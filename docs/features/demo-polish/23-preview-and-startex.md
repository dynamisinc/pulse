# Story: Preview-as-participant shows the real feed, and StartEx/EndEx (Could)

**Feature:** Demo polish  ·  **Epic:** E1 / E7  ·  **Phase:** 1  ·  **Status:** Not Started
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
- [ ] **Real channel in the preview.** `PreviewAsParticipant` mounts the participant `SocialChannel` (inside
      `BrandThemeProvider` and `ShellContextProvider` with `variant: 'preview'`, scenario time from the chosen
      moment) instead of `PortalStub`. It mounts under F1's **`MemorySocialNavigationProvider`**: in-memory
      location, no browser-history writes. So a thread, profile or hashtag link inside the preview never
      navigates the staff page, and an unknown path stays inside the preview (depends on F1's
      navigation-adapter AC); the staff label strip, moment picker and Exit control are unchanged.
- [ ] **Read-only.** In the `preview` variant the composer, follow, like/repost and compose-modal controls are
      absent (`affordancesAvailable` false) — no write can be issued from the preview; the feed it shows is the
      exercise's real feed.
- [ ] **Two-worlds guards stay true.** `previewStubTwoWorlds.test.ts` / `twoWorldsSeparation.test.ts` are
      updated to the new composition and pass: the participant subtree has no COBRA ancestor; the staff strip
      has no participant tokens.
- [ ] **StartEx / EndEx control.** The console shows **Start exercise** when the lifecycle state allows `live`
      and **End exercise** when it allows `completed`, calling `POST /api/staff/exercise-lifecycle/transition {
      to }`; End requires a type-to-confirm ("END"); the header state pill reflects the new state; errors are
      visible; the control is absent for non-controller roles; keyboard-operable and text-labelled (never
      color-only).

## Out of Scope
Pause/resume (already built), time jumps, practice mode, the portal/news/weather previews, wiring beyond the
console route, EndEx page content.

## Technical Notes
- Files: implementation.md §4.1 row C6 — `staffShell/components/{PreviewAsParticipant,PortalStub}.tsx` (+
  tests), new `controller/lifecycle/**` (control + `useExerciseLifecycle` over `GET
  /api/staff/exercise-lifecycle` and the transition route). The orchestrator mounts the preview toggle and the
  control in `ControllerConsoleRoute.tsx` (today the route mounts no preview: "not wired here"). Reuse
  `usePreview`, `previewContext.ts`, `mountContract.ts` (`ShellContextProvider`, `affordancesAvailable`).
- Under mock data the lifecycle hook simulates the transition. This is the first story to cut under Cut line 2
  pressure.

## Dependencies
F1 (the channel to mount); lifecycle API exists. Runs alone.

## Tests
- Preview composition renders the channel under `preview`, no write affordances, two-worlds tests; lifecycle
  control: allowed-transitions gating, type-to-confirm, success/error, absent for non-controllers.
