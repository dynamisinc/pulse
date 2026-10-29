# Story: Back-pocket injects (PDF-13)

**Feature:** Post-demo customer feedback  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** CTL-010/011 (extends the inject queue; no new requirement ID yet)  ·  **Design decisions:** PDF-D8 (Tom, 10/21)  ·  **Issue:** #681
**Stack:** fullstack  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must (December release)  ·  **Effort:** M

## Context
10/20 demo ask: injects pre-loaded into the exercise that may or may not be used. They are held in reserve, fired at the
controller's discretion, and are not on the scheduled timeline. Source: Tom's demo notes.

**How it fits today's model** (`inject-queue` 06/07, `demo-feedback` 10 and 23). Run-sheet items have statuses `pending`,
`held`, `firing`, `fired`, `skipped`, `failed`, are ordered, and are fired by a controller or a burst runner. `held` already
means a controller paused an item that was on the sheet, and the standalone scheduler (inject-queue `03`) is not built. A
back-pocket item differs in intent: it is never expected to fire, so it must not count toward pending, progress or overdue, and
must not be swept by a time-jump batch disposition (CTL-015). Reusing `held` would blur two meanings, so model it as a
**reserve flag/lane** on the item (`IsReserve`), with the same fire/edit/skip actions and statuses (PDF-D8, decided by Tom 10/21: a reserve flag, not `held`).

## Acceptance Criteria
- [ ] Given an exercise, when a controller adds an item to the run sheet or imports one (`demo-feedback/10`) and marks it
      Reserve, then it appears in a separate "Reserve" section of the console, outside the ordered timeline, with its status.
- [ ] Given a Reserve item, when the exercise clock advances or a scheduler or time-jump runs, then it never fires
      automatically and is excluded from time-jump batch disposition and from pending/overdue counts.
- [ ] Given a Reserve item, when a controller chooses Fire (confirm required), then it publishes through the same post funnel
      as any inject with the firing controller recorded and moves to `fired`; Edit-then-fire and Skip work as for other items.
- [ ] Given the run-sheet import, when a row carries a reserve marker (column or value to be decided), then it imports as
      Reserve; without the marker it behaves as today.
- [ ] Given the exercise ends, when the report/export is produced, then fired reserve items are labelled "Reserve (fired)" and
      unused ones "Reserve (unused)", so the after-action review shows what was held back.
- [ ] A controller can move an item between the timeline and Reserve before it fires, logged as `inject.reserve_changed`;
      evaluators in the read-only console (`demo-feedback/11`) see the Reserve section but no actions.
- [ ] **Isolation:** reserve items are exercise-scoped; another exercise's item id is a 404. **Telemetry (XC-004):** firing from
      Reserve emits the usual inject event with `fromReserve: true`.

## Out of Scope
Engine-suggested reserve items (E8); conditional triggers ("fire if participants do X"); drag-and-drop polish; Cadence-sourced
injects (CTL-012).

## Technical Notes
Staff world, COBRA components only. Likely one new column (migration) on the inject item, a vocabulary entry, a console
section and an import-column mapping. Interacts with `demo-feedback/23` (mark as fired): Mark fired from Reserve is allowed.
Decided (Tom, 10/21): an unused reserve item stays `pending` (status untouched) and shows as "Reserve (unused)" in the report.

## Dependencies
inject-queue `06`/`07`, `demo-feedback/10` (run sheet import), `demo-feedback/23`. Part of the December release.
