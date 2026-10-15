# Story: Run sheet: mark an item fired without posting

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** inject queue (controller), PDF-07 context ("capture time, recipient, and remarks")  ·  **Decisions:** DF-36  ·  **Issue:** —
**Stack:** fullstack  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Should  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** Wave 3 session · **Branch:** `build/demo-feedback/23-mark-fired` → `feature/demo-feedback-w4-polish`

## Context

Controllers sometimes deliver an inject outside Pulse, or post it by hand from the persona composer, and then want
the run sheet to show it as done. Today an item can only become `fired` by publishing through the post funnel
(`InjectQueueService.FireAsync` :530); skip is the only other exit and reads wrong in the after-action review.

## Acceptance Criteria

- [ ] `POST /api/injects/{itemId:guid}/mark-fired` `{ expectedVersion }`, controller only (same filters as fire),
      allowed from `pending`, `held` or `failed`; any other status is 409 with the existing refusal shape. It sets the
      item `fired`, stamps `FiredByHumanId` and `FiredScenarioTime` (exercise clock), bumps the queue version, and
      **publishes nothing** (no post funnel, no burst runner). Child post rows that never published are set `skipped`.
- [ ] Allowed under Freeze and Pause injects (nothing reaches participants). Emits `inject.marked_fired`.
- [ ] Run sheet row: a "Mark fired" action (FontAwesome icon + text) on pending, held and failed rows, behind a confirm
      ("Mark as fired without posting? This can't be undone."). A marked item shows the status **"Marked fired"**
      (text, not color), derived as fired with no child carrying a post id; the status chip supports it.
- [ ] Read-only console (story 11): the action is absent for evaluators.
- [ ] Exercise-scoped: an item id from another exercise is 404.

## Out of Scope

Undo, remarks capture (#530), the export (posts only today).

## Technical Notes

Owns `Features/Injects/{InjectEndpoints,InjectQueueService}.cs` (one method + route inside `MapInjects`),
`controller/runSheet/{RunSheetRow,RunSheetStatusChip}.tsx`, `controller/services/injectService.ts`,
`useInjectQueue.ts`. Gate with `useCanControl()` (DF-14). Statuses in `InjectVocabulary.cs`. No migration.

## Dependencies

None.

## Tests

Backend: each allowed status marks fired with stamps and no post; fired/skipped/firing refused; version token
checked; nothing published (funnel spy); under Freeze allowed; isolation 404; telemetry. Frontend: action shown per
status, confirm, "Marked fired" label, evaluator sees none.
