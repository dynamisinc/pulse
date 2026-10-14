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
