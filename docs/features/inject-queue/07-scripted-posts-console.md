# Story: Scripted posts — console run sheet (demo slice)

**Feature:** Inject queue & conduct timeline  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-010 (lite), CTL-011, CTL-014 (lite), CTL-023 (injects tier), CTL-034, COR-001, XC-002, NFR-001  ·  **Design decisions:** IQ-1…IQ-10 (implementation.md § Demo slice)  ·  **Issue:** #453
**Story ID:** IQ-F  ·  **Stack:** frontend  ·  **Priority:** Must (Oct 20 demo)  ·  **Effort:** M
**Home stories:** [`01`](01-conduct-timeline.md), [`02`](02-fire-hold-skip-edit.md), [`04`](04-timed-bursts.md) (slices). **Replaces** demo-polish [`C3`](../demo-polish/19-run-sheet.md) (#438) and keeps its mount seam (`RunSheetPanel` in C4's `runSheetSlot`).

## Context
**As** a controller (and the presenter), **I want** the server-side inject queue ([story 06](06-scripted-posts-server-queue.md))
in the console:
- my items and everyone's;
- writing a scripted post live;
- firing on cue with one key, holding and skipping;
- firing a paced pile-on;
- seeing another controller's changes within seconds;

**so that** the demo's scripted beats (opening, misinformation pile-on) run the MSEL-style workflow this customer
knows from Looking Glass. **World: staff (COBRA)**, dense and keyboard-first; it must never be confusable with a
participant view.

## Acceptance Criteria
- [ ] **The list.** `RunSheetPanel` (self-contained, no props; the frozen C3 seam name) lists the exercise's items in
      order. Each row shows:
      - title;
      - persona(s): the avatar/name of the first post plus "+N" for a burst;
      - assignee;
      - T+N (`plannedMinute`);
      - a status chip as **text + icon** (pending · held · firing *n/m* · fired · skipped · failed), never colour-only
        (NFR-001).
      Fired rows show the fired scenario time (staff may also see wall-clock). A failed row shows the server's reason.
- [ ] **Mine / All.** A filter switches between items assigned to me and all items (plus a status filter: open /
      fired / all). "Mine" is a filter, not a lock (IQ-3). The choice is remembered per exercise in `localStorage`, with
      try/catch, and defaults to All.
- [ ] **Author live.** An **Add** / **Edit** form (inline panel, not a blocking modal) sets:
      - title, notes, T+N and assignee (from `GET /api/injects/assignees`);
      - per post: persona (the existing staff persona picker data), text with a 280 counter, media via C1's
        `MediaLibraryPicker` (≤ 4 images or 1 video, alt required), reply to (an earlier scripted post or a pasted post
        id) and an optional engagement baseline;
      - **Burst** mode: add/remove/reorder 2..20 posts and set the window (30..600 s, default 90).
      Server validation messages appear on the field or form. A 409 version conflict says "Changed by someone else.
      Reloaded." and shows the fresh item. Fired, firing and skipped items open read-only.
- [ ] **Fire on cue.**
      - **Fire** posts the selected item; **Fire next** fires the first `pending` item in the current filter (held items
        are passed over).
      - **Hold / Release**, **Skip / Unskip**, **Retry** (failed) and **Delete** (pending/held/skipped, with a confirm)
        call story 06's endpoints.
      - Fire has **no confirmation dialog** (CTL-034) and is disabled while in flight, so a double press fires once.
      - A 409 from a concurrent fire shows "Already fired by {name}". Under FREEZE the Fire buttons are disabled with the
        reason "World frozen".
- [ ] **Keyboard (NFR-001).**
      - Shortcuts: `↑/↓` select, `F` fire, `N` fire next, `H` hold/release, `S` skip/unskip, `E` edit, `A` add.
      - Shortcuts are ignored while typing in a field.
      - A visible "Keyboard" help lists them.
      - Every action is also a reachable button with an accessible name.
      - Status changes announce through a polite live region.
- [ ] **Live sync (IQ-6).** The panel polls `GET /api/injects` every ~3 s while mounted and visible, and immediately
      after its own mutation. A fire, hold, skip or edit by another controller shows in this console within ~3 s. Burst
      progress (*n/m*) advances live.
- [ ] **PAUSE INJECTS is live.** In `PausePill`, the "Pause injects" option is enabled (its "No inject queue yet"
      disabled reason is removed) and sets the existing `injects` tier through the existing pause-tier action. While
      it is active the panel shows "Injects paused: bursts are suspended; manual fire still works" (IQ-5).
- [ ] **Staff world only.**
      - Uses `@/theme/styledComponents` (COBRA) + `consoleChrome`/staff tokens, FontAwesome icons and MUI 9 `sx`-only.
      - No participant components (`PostCard` etc.) and no participant skin.
      - No `exerciseId` in any request (the server scopes).
      - No telemetry emitted by the console for queue actions (the server emits `inject_action`; no double count).
- [ ] **Mock parity.** With `USE_MOCK_DATA` on, a mock adapter behind the same service interface supports the full
      flow: list, author, fire (including burst pacing on a fake timer), hold, skip, 409 conflict, injects-pause. Tests
      and `npm run dev` work without the backend.

## Out of Scope
- A timeline rail with a "now" marker (story 01 proper).
- Scheduling/auto-fire (03).
- Multi-select batch actions.
- JSON/spreadsheet import (S1 seeds through the API).
- Drag-and-drop reorder (up/down buttons are enough).
- The console layout and mount (C4 + orchestrator).

## Technical Notes
- **Files.** New `src/frontend/src/features/controller/runSheet/**`: `RunSheetPanel`, `RunSheetRow`,
  `InjectItemEditor`, `useInjectQueue` (React Query, `refetchInterval: 3000`), `injectService` (live) +
  `injectMock`, and `types.ts` mirroring story 06's DTOs.
  - It also edits `components/steering/PausePill.tsx` (the injects option only).
  - **Collision note:** C4 must **not** remove the injects option. Its "relabel or hide PAUSE INJECTS" item is
    withdrawn by this slice.
- **Mount.** C4 adds `runSheetSlot` to `ControllerConsole` and the orchestrator mounts `<RunSheetPanel/>` in
  `ControllerConsoleRoute.tsx`, both unchanged from the frozen seam (§4.2 of demo-polish implementation.md). If C4 has
  merged when this PR is ready, this PR may add that one mount line with the demo-polish orchestrator's agreement.
- Reuse:
  - `useControllerIdentity` (my id for "Mine");
  - `useStaffPersonas`;
  - C1's `MediaLibraryPicker` (import it, don't fork it; code against the frozen props in demo-polish §1.11 if C1
    hasn't merged);
  - `usePauseState` / `livePauseTierActions`;
  - `scenarioTime` formatting helpers.

## Dependencies
- [Story 06](06-scripted-posts-server-queue.md): the wire contract is in implementation.md § Demo slice; build
  against the mock until 06 deploys.
- C1's picker for media.
- C4's slot for the mount.
- Live check once 06 is deployed to UAT. The frontend freeze is Mon 10/19; target merge Wed 10/14.

## Tests
- **RTL:**
  - rows render status as text + icon;
  - Mine/All filtering;
  - Fire / Fire next skip held items;
  - double press fires once;
  - 409 messages (concurrent fire, version conflict);
  - FREEZE disables Fire with its reason;
  - the burst editor enforces 2..20 posts and the window range;
  - keyboard shortcuts are ignored while typing;
  - a live-region announcement on a status change.
- **Hook:** polling picks up another controller's change (mock mutation between polls → row updates).
- **PausePill:** the injects option is enabled and sets the `injects` tier.
- **Guards:** a no-participant-imports guard, and requests carry no `exerciseId`.
