# Story: Read-only console for evaluators

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-013 (UI half only)  ·  **Decisions:** DF-14  ·  **Issue:** #507
**Stack:** frontend  ·  **World:** staff  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 3  ·  **Effort:** M

## Context

"Read-only version so Feds and other leads can watch without affecting control." The backend already lets an evaluator
read everything the console reads; the app just never routes an evaluator there, and no console control checks the
role. This story admits evaluators to `/staff/console` (orchestrator seam S-3) and removes every write control for them.
Server-side enforcement is #61 / #377, after the demo.

## Acceptance Criteria

- [ ] A `useCanControl()` hook in `controller/access/` returns `useOptionalSession()?.role === 'controller'`
      (never `useControllerIdentity().role`). Every write control in the console is **absent, not disabled**, when it
      returns false: the persona composer; run sheet Add, Import, Fire next, row Fire/Retry/Release/Hold/Skip/Unskip/
      Delete and editor Edit/Save (the editor opens in `view` mode); Live world Take down and Pin for everyone; Pause
      pill actions and the Escalation dial; the engine control bar's write toggles; review-queue approve/reject/batch;
      the white-noise level buttons (the current level and rate stay visible as text); StartEx/EndEx.
- [ ] **Export posts stays available** to evaluators.
- [ ] A COBRA "View only" chip shows in the console title row for non-controllers.
- [ ] With the S-3 registry change, an evaluator who opens `/staff/console` gets the console (their default route stays
      `/staff/evaluate`), and their surface launcher lists it. A controller sees no change at all (snapshot of the
      controller console's controls is unchanged).

### Cross-cutting
- [ ] **Two worlds:** COBRA only.
- [ ] **Honesty:** the story's PR description says plainly that API writes are not yet role-enforced for evaluators.

## Out of Scope

Server-side enforcement (#61, #377). A separate evaluator console layout.

## Tests

A table-driven test that renders the console as controller and as evaluator and asserts each listed control is present
for one and absent for the other; Export present for both; the View only chip; registry rules test with the new role.

**Built (`src/frontend/src/features/controller/access/readOnlyConsole.test.tsx`).** The real `ControllerConsoleRoute`
under a real `SessionProvider`, only the session resolver replaced (as in `ControllerConsoleRoute.c6.test.tsx`), with a
run sheet seeded into every state the row actions depend on (pending, held, skipped, failed):

- **Table (28 controls x 2 roles):** the PERSONAS tool, the "Post as a persona" strip, Reply as…, Take down, Pin for
  everyone, the Pause pill, the Escalation dial, the noise level buttons, the kill switch, "Simulate degraded (dev)",
  the swamped-mode toggle, Batch approve, batch selection, Approve/Veto/Edit/Re-roll, StartEx/EndEx, Fire next, Add,
  Import from Excel, row Fire/Retry/Release/Hold/Skip/Unskip/Delete/Move up/Move down and row Edit: each present for a
  controller, absent (zero in the DOM) for an evaluator.
- Export posts enabled for both roles; "View only" in the title row for the evaluator and never for the controller; the
  evaluator keeps the run sheet rows (every row "View"), the live world, the review cards and the noise level and rate
  as text; the editor opens in `view` mode with no Save or Add post.
- **Keyboard:** for an evaluator the run sheet's N/F/H/S/A, the review queue's A/V/R/B/E, the live world's R and
  Ctrl/⌘+K change and open nothing, E opens the item read-only, and the Keyboard help lists only ↑/↓ and E; a controller
  still gets the palette from Ctrl+K.
- **Controller unchanged:** the controller render's full control inventory (role, test id, accessible name, document
  order; 153 controls) equals the list recorded on `feature/demo-feedback-w3` @ e5b8d76c before any gating.
- **Registry:** seam S-3's existing `staffRouteRegistry.test.tsx` cases already assert the evaluator is admitted to
  `/staff/console`, keeps `/staff/evaluate` as default and has the console in its launcher; not extended.
- `TakedownAction.test.tsx`'s CTL-033 cases now drive the session gate instead of the identity mock; the 40 existing
  console suites that mount no session fix the gate to "controller" with one `vi.mock` line each.
- **Gate-1 fold-in (same file unless noted):** the engine mode is shown to both roles (kill switch or
  `engine-mode-readout`), and an evaluator's readout is a `role="status"` span built from the server settings
  ("ENGINE · LIVE (SUGGEST)" on the mock snapshot) (H-1); the pause tier is a `pause-readout` status span; the ENGINE
  flyout shows an evaluator no autonomy / tier-policy group and no provider lever, but the read-only note and the
  current default and tier policy as text, with the controller's levers as the control case (M-1, M-2); while
  degraded, Restore is present for a controller and absent for an evaluator, the indicator stays for both (M-2); the
  review queue's hint does not tell an evaluator to press A or V (L-1); the chip's reason is visually hidden text in the
  chip and the chip has no `title` (L-2); the noise level reads "Level: Off" (L-3); Space (batch select) and
  Ctrl/⌘+Enter in the read-only editor change nothing, with a controller's Space then B as the control case (L-4).
- **Polling (M-3, `access/useReadOnlyRefresh.test.tsx`, fake timers):** an evaluator's console re-reads the pause tier
  and the engine settings every 15 s, stops on unmount, and a controller's console never polls.
