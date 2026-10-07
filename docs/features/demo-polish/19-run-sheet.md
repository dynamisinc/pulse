# Story: Run sheet

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-010 (lite), CTL-011 (lite), CTL-013 (lite), CTL-001, COR-018, NFR-001  ·  **Design decisions:** none (file schema `pulse.runsheet.v1`, implementation.md §1.9)  ·  **Issue:** —
**Story ID:** C3  ·  **Stack:** frontend  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** 3
**Home stories:** [`inject-queue/02`](../inject-queue/02-fire-hold-skip-edit.md), [`/03`](../inject-queue/03-standalone-scheduler.md) (lite — manual fire only; no scheduler).

## Context
**As** a controller (and the presenter), **I want** a list of staged posts I can fire with one key press, **so
that** the misinformation beat is scripted — "the impersonator posts a brown-tap-water photo, citizen personas
pile on" — and doubles as the demo script (demo beat 3). This is the MSEL-style workflow the audience knows, but
**browser-side only**: beats live in the controller's browser storage with JSON import/export (plan §2). It
posts through the existing `POST /api/posts`, so it needs **no backend**.
**World: staff (COBRA)**, dense and keyboard-first.

## Acceptance Criteria
- [ ] **Author beats.** In the console, a controller can add, edit, duplicate, delete and reorder beats: persona
      (picker), text (280-char counter), media from the exercise library (via C1's `MediaLibraryPicker`; ≤ 4
      images or 1 video, alt required), intended scenario minute (shown as "T+14m" — informational and a sort
      hint only, **no scheduler**), optional "reply to" (another beat or an existing post id), optional
      engagement baseline, title and notes.
- [ ] **Persisted per exercise.** The sheet is kept in `localStorage` under `pulse.runsheet.v1:{exerciseId}` and
      survives reload; switching exercise shows only that exercise's sheet (no cross-exercise bleed); storage
      failure shows a visible warning instead of silently losing edits.
- [ ] **JSON import/export (`pulse.runsheet.v1`).** Export downloads the definition file exactly per
      implementation.md §1.9 (no status); import validates with `zod`, **rejects the whole file with a readable
      message** on the first violation (wrong `schema`, duplicate ids/orders, text > 280, > 4 media, bad
      baseline) and never partially applies; `import(export(x))` deep-equals `x`; media ids missing from the
      library produce a non-blocking warning on the affected beats.
- [ ] **Fire / Fire next / Skip.** Each beat shows a status chip as **text + icon** (pending · fired · skipped ·
      failed). **Fire** resolves the persona handle against `GET /api/personas` (an unknown handle blocks with a
      message), posts via `publishPost` with `origin: 'controller-as-persona'`, the controller's acting human
      and `scenarioTime = scenarioNow()`, disables while in flight (a double-press cannot fire twice), records
      `firedPostId` and the fired scenario time; **Fire next** fires the first pending beat; **Skip** marks
      skipped (undo-able). A server failure sets `failed` with the error and a Retry — never a false "fired".
- [ ] **Reply beats.** A beat whose `replyTo` is another beat is disabled with the reason "Fire the parent
      first" until the parent is `fired`, then posts with `parentPostId = parent.firedPostId`; a
      `replyTo.postId` posts against that existing post.
- [ ] **Keyboard (NFR-001).** `↑/↓` select, `F` fire selected, `N` fire next pending, `S` skip, `E` edit;
      shortcuts are ignored while typing in a field; a visible "Keyboard" help lists them; every action is also
      a reachable button.
- [ ] **Staff world only.** `@/theme/styledComponents` + `staffShellTokens`; no participant skin or `PostCard`;
      the panel is self-contained (`RunSheetPanel`, no props) so the orchestrator mounts it through C4's
      `runSheetSlot`.

## Out of Scope
Timed/automatic firing, bundles and bursts (CTL-014), hold state and edit-then-fire audit, a server-side sheet,
multi-controller sync (each browser has its own sheet), Cadence-sourced items, the engine, undo of a fired post
(use takedown), exporting fire status.

## Technical Notes
- Files: implementation.md §4.1 row C3 — `controller/runSheet/**` (new: store, schema (zod), `RunSheetPanel`,
  beat editor, export/import, fire service). Imports `MediaLibraryPicker` from `controller/media` (**C1 must
  merge first**; code against the frozen props in §1.11 until then). Reuse `publishPost`, `usePersonas`,
  `useControllerIdentity` (acting human), `useExerciseContext`, `scenarioNow`.
- This is exactly the file S1 produces (`pulse.runsheet.v1`) — keep the schema in one module that S1's docs can
  reference. No telemetry beyond the post's own event.

## Dependencies
F0 (`publishPost`, `core/media`, mocks); **C1** (picker, serial edge); Wave 3 runs with C2, C4, PE-FE. Works
against mocks; **live check** once BP (+B2 for reply beats) are deployed.

## Tests
- Schema: valid/invalid matrix and round-trip; storage keyed per exercise (switch exercise → different sheet);
  storage-failure warning.
- Fire: success records `firedPostId`; double-press fires once; failure → `failed` + Retry; reply-parent gating;
  unknown persona blocks; request carries `controller-as-persona`, acting human,
  `parentPostId`/`engagementBaseline`/`media`, no `exerciseId`.
- Keyboard handling (ignored while typing), statuses are text, no participant imports; scenario time (`T+Nm`,
  fired time) rendering.
