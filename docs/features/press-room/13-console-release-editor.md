# Story: Console `release` kind editor — publish as any org

**Feature:** Press Room  ·  **Epic:** E5 (with E7)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRS-020, PRS-002 (PDF attach), PRS-013 (via F17 publish options)  ·  **Design decisions:** D4-002, C-1 (this editor is **not** the approval surface)  ·  **Issue:** —
**Stack:** frontend  ·  **World:** staff (COBRA)  ·  **Wave:** 5  ·  **Effort:** M

## Context
Controllers publish releases as any simulated organization persona — a utility's tone-deaf statement, a neighboring county's conflicting guidance. The foundation's authoring shell (F17) supplies the list,
status, schedule, publish, retract, preview and "attach to inject"; E5 supplies only the `release` editor through `registerContentKindEditor('release', …)`. This is the **staff** counterpart of the participant composer, not a copy of it.

## Acceptance Criteria
- [ ] **Registered editor.** Given the F17 shell, when a `release` item is created or edited, then `ReleaseEditor` renders in the editor slot; a missing registration would show F17's "No editor for this kind" row (verified by an unregistered-kind test).
- [ ] **Publish as any org (PRS-020).** Given the editor, then a COBRA select lists **every** org persona in the exercise (not only granted ones), setting `orgPersonaId` and the outlet; the item is created with `origin: controller` (or `inject` when attached) and the controller as acting human.
- [ ] **Release fields.** Given the editor, then headline, rich body (sanitized server-side), contact block, dateline and a PDF attach (via story 02's upload, staff rule) with inline preview exist, using `@/theme/styledComponents`; validation messages come from the server descriptor (story 01).
- [ ] **Preview as participant (COR-041).** Given any state, then "Preview" shows the release page exactly as participants see it (story 09's `ReleasePage` in the participant subtree inside the staff frame); staff chrome never restyles it.
- [ ] **Attach to inject.** Given a saved release, then F17's "Add to inject queue" works for `release` (content inject, F16) and the run-sheet row shows org, headline and Preview.
- [ ] **Pending-approval visibility.** Given a participant release pending approval, then the list shows "Pending approval" with text + icon; publishing it from here is allowed (staff authority, Q-E5-6) and warns that it bypasses the org's gate, recording the audit row.
- [ ] **Staff only, keyboard-first.** Editor is keyboard-operable with the console's shortcut hints, FontAwesome icons, read-only roles see no mutating controls; axe clean (NFR-001).
- [ ] **Two worlds.** No participant skin or composer components leak into the editor chrome; the participant sheet (07) is not imported.

## Out of Scope
The participant composer; approval review (10 — controllers approve through the participant view, C-1); outlet admin; retract/restore (F17); bulk publish.

## Technical Notes
Files: `features/controller/content/editors/release/**`. Registration call is orchestrator-wired into the staff registry. Runs on F17 mocks until F07 is live.

## Dependencies
Stories 01, 02; foundation F07, F17 (and F16 for the attach control). Can run with 08, 09, 10, 11, 12, 14.

## Tests
RTL for the editor within a stub shell; org-list test (all personas); unregistered-kind test; two-worlds lint.
