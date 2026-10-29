# Story: Staff authoring and publish seam (console)

**Feature:** Channels foundation  ·  **Epic:** E7 (console) with E4/E5/E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-020, NWS-013, NWS-022 (review queue for engine drafts), PRS-020, WX-012, PRT-004 (feature/pin), PRT-031, COR-041, XC-006  ·  **Design decisions:** D5 (console conventions), D4-002, D4-011  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 4  ·  **Effort:** L

## Context
Controllers need one place to author, schedule, publish, correct and retract channel content, and to attach it to the inject queue. This story builds the **shell** of that surface;
channels plug in kind-specific editors (the article editor, the warning product form) through `registerContentKindEditor(kind, component, { ownsDeliveryOptions? })`, so E4/E6 stories stay editor-only.
The Wire Room's participant composer (E5, D4-001) is a **participant** surface and is not this one.

## Acceptance Criteria
- [ ] **List.** Given the exercise's content, when a controller opens "Channel content" (a surface in the staff registry, launcher-gated by role), then it lists items from `GET /api/content-items` filterable by channel, outlet, status, kind and "mine", with status shown by **text + icon + color** (never color-only), polling for live sync.
- [ ] **Editor slot.** Given a kind with a registered editor, when "New" or "Edit" is chosen, then the shell renders the kind's editor with save-draft (autosave status shown ambiently), `version` conflict handling (409 → reload prompt), and server validation messages; a kind with no editor shows a disabled "No editor for this kind" row, not a crash.
- [ ] **Publish controls.** Given a draft, then Publish now, Schedule (scenario time, shown as a scenario/wall pair like Cadence), Unschedule, Retract, Restore and Revise (update / correction / quiet rewrite, each labelled for what participants will see) are available per status; every destructive or irreversible action is **one explicit confirmation** (type-to-confirm for retract of a published item) and nothing publishes on a draft save.
- [ ] **Publish options.** The publish dialog exposes "Raise alert" (severity + headline, defaulting to the content headline verbatim, D4-010; pre-filled from the kind's `DefaultAlertMapping` **as a suggestion only**) and "Post from @{outlet handle}" with a live link-card preview and an editable text, unchecked by default (D4-004); the options chosen at **Schedule** are persisted with the schedule (FC-7a), and for a kind registered with `ownsDeliveryOptions: true` (weather) the generic block is hidden and the kind's own `delivery` payload is used instead (weather FU-6), so two sets of controls never conflict.
- [ ] **Preview as participant.** Given any item, then "Preview" renders the participant DTO from `/preview` inside the participant subtree within the staff frame (COR-041); staff chrome never restyles it and the participant skin never leaks into the staff frame.
- [ ] **Attach to inject.** Given a draft or scheduled item, then "Add to inject queue" creates a `content` inject (story 16) with an optional planned minute and assignee; the run-sheet console row for a `content` item shows channel, outlet, headline and a Preview link.
- [ ] **Engine drafts.** Given `origin: engine` drafts, then they appear flagged "Engine draft" and can only be published by a controller action (NWS-022); the engine review queue (ADP-040) is the primary path and this list merely mirrors it.
- [ ] **Feature/pin and background.** A controller can set a featured rank (PRT-004) and the background-vs-scenario tag (PRT-031) from the row/editor; neither is ever visible to participants (XC-002).
- [ ] **Staff world only.** All controls use `@/theme/styledComponents` (COBRA), FontAwesome icons, keyboard-operable with visible shortcuts hints per the console's conventions; no participant skin or default MUI look in the staff chrome; axe clean (NFR-001).
- [ ] **Read-only console.** A read-only/observer staff role sees the list and preview but no mutating controls (affordances absent, COR-015 parity).

## Out of Scope
Kind-specific editors (E4 article editor/templates NWS-021, E6 warning form + weather timeline UI, E5 org-side review gate); outlet admin beyond a basic list/enable toggle; bulk operations; E8 draft generation.

## Technical Notes
Files: `features/controller/content/**`; the run-sheet row renderer touch for `content` kind in `features/controller/runSheet/**` is owned by this story for that one component. The staff route registry entry is orchestrator-owned. Reuse the console's list/confirm patterns, `useStaffSession`, and the preview renderer used for participant preview (COR-041). Runs on mock fixtures until 07/16 land.

## Dependencies
07 (API), 14 (preview rendering), 02 mocks; 16 for the live attach control. Can run with 15, 16, 18, 19.
