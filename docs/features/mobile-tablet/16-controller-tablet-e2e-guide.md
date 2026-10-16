# Story: Controller tablet e2e and guide screenshots

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-001, docs-as-done (Brief C5)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Closes B3: browser tests at the four console tablet viewports (1024x768, 768x1024, 1180x820, 820x1180) against mock seams, and tablet shots
for the controller guide. Staff world.

## Acceptance Criteria
- [ ] Given a controller at each of the four viewports, when the console loads, then there is no horizontal scroll, the pane/tab layout from story 12 is present, and the toolstrip tools meet 44px touch targets.
- [ ] Given a controller on touch, when they open the palette, switch panes, open a review item, take down a post (confirm) and open the pause popover (Freeze confirm), then each flow completes with the deliberate step and nothing fires on a single stray tap (stories 14 and 15).
- [ ] Given rotation from landscape to portrait mid-flow, then pane/tab selection and an open composer survive.
- [ ] Given an evaluator and a planner session at 1180x820, then each sees only what their role guard allows (no controller controls for an evaluator); the evaluator dashboard remains mock/canned and is not asserted beyond reachability.
- [ ] Given `capture.mjs`, then `console-overview-tablet`, `takedown-tablet` and `freeze-controls-tablet` shots exist at 1180x820 (and portrait 820x1180 for the overview), with the 1440 originals untouched and hidden dev scaffolding still hidden.
- [ ] Given `docs/guide/controller-guide.md`, then it has a "Using the console on a tablet" section (orientations, panes/tabs, shortcut table, deliberate confirms) with the new images and alt text.
- [ ] Mock-only: no shot or spec contains real data.

## Out of Scope
Evaluator tablet (B4), real-device iPad testing (a manual checklist item in the PR), CI wiring, WebKit matrix.

## Technical Notes
`e2e/controller-tablet.spec.ts` via story 01's `loginAs` and viewports; `capture.mjs` edit comes after story 08 (single file). Cite
`implementation.md` story 16.

## Dependencies
Stories 08 (capture.mjs), 12, 13, 14, 15.

## Tests
The spec (3x consecutive green); open every new PNG.
