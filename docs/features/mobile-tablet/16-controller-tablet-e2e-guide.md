# Story: Controller tablet e2e and guide screenshots

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001, docs-as-done (Brief C5)  ·  **Design decisions:** none  ·  **Issue:** #524

## Context
Closes B3: browser tests at the four console tablet viewports (1024x768, 768x1024, 1180x820, 820x1180) against mock seams, and tablet shots
for the controller guide. Staff world.

## Acceptance Criteria
- [x] Given a controller at each of the four viewports, when the console loads, then there is no horizontal scroll, the pane/tab layout from story 12 is present, and the toolstrip tools meet 44px touch targets. _(36 tests in `e2e/controller-tablet.spec.ts`; arrangement per band, sticky band, 44px tools asserted at all four viewports.)_
- [x] Given a controller on touch, when they open the palette, switch panes, open a review item, take down a post (confirm) and open the pause popover (Freeze confirm), then each flow completes with the deliberate step and nothing fires on a single stray tap (stories 14 and 15). _(Palette via PERSONAS, pane tabs, a review item (Edit then Cancel), Take down and the Pause/Freeze confirm, at 1024x768 and 1180x820. The stray tap is dispatched a few frames after the opening tap (asserted under the 400ms delay, confirm `aria-disabled=true`, which is the real proof), and the deliberate tap waits past the real 400ms delay. Not exercised on touch: EndEx and the kill switch re-arm (unchanged by this story; covered by story 15 unit tests).)_
- [x] Given rotation from landscape to portrait mid-flow, then pane/tab selection and an open composer survive. _(1024x768 to 768x1024 with the Run sheet tab selected and a typed persona draft: both survive. Not asserted across 1280 (story 12 known limit).)_
- [x] Given an evaluator and a planner session at 1180x820, then each sees only what their role guard allows (no controller controls for an evaluator); the evaluator dashboard remains mock/canned and is not asserted beyond reachability. _(Evaluator: view-only console, no kill switch, Pause, End exercise, Take down or PERSONAS; evaluator dashboard reachable. Planner: "Not allowed" (the console route guard), no controller controls.)_
- [x] Given `capture.mjs`, then `console-overview-tablet`, `takedown-tablet` and `freeze-controls-tablet` shots exist at 1180x820 (and portrait 820x1180 for the overview), with the 1440 originals untouched and hidden dev scaffolding still hidden. _(Four PNGs captured at 1180x820 / 820x1180 with touch emulation and each opened and checked. The 1440 originals are untouched (`git status` shows no change to them) and the dev scaffolding CSS is unchanged.)_
- [x] Given `docs/guide/controller-guide.md`, then it has a "Using the console on a tablet" section (orientations, panes/tabs, shortcut table, deliberate confirms) with the new images and alt text. _(Added under `## Using a tablet`: overview images in the layout subsection and a new "Deliberate confirms on touch" subsection with the two confirm shots; it links to the per-control notes rather than repeating them. The heading in the AC is the existing `## Using a tablet`.)_
- [x] Mock-only: no shot or spec contains real data. _(Mock data only (Coastal Surge); the spec and shots read the guide-shots mock seams.)_

## Out of Scope
Evaluator tablet (B4), real-device iPad testing (a manual checklist item in the PR), CI wiring, WebKit matrix.

## Technical Notes
`e2e/controller-tablet.spec.ts` via story 01's `loginAs` and viewports; `capture.mjs` edit comes after story 08 (single file). Cite
`implementation.md` story 16.

## Dependencies
Stories 08 (capture.mjs), 12, 13, 14, 15.

## Tests
The spec (3x consecutive green); open every new PNG.

## Implementation notes (story 16)
- **Spec:** `src/frontend/e2e/controller-tablet.spec.ts`. Viewports are per-describe `test.use({ viewport, hasTouch: true, isMobile: false })`.
  `playwright.config.ts` gained a `controller-tablet` project (`testMatch` this spec); the three existing projects `testIgnore` it, so no existing spec runs more often.
- **Run:** `GUIDE_SHOTS_PORT=5241 npx playwright test e2e/controller-tablet.spec.ts --project=controller-tablet`. Three consecutive runs: 36/36 green each time.
- **Stray-tap technique:** the arming delay is real, so the stray tap is clicked from the page a few animation frames after the opening click and the spec asserts the confirm was still `aria-disabled="true"` and under the 400ms delay had passed.
- **Screenshots:** `TABLET_LANDSCAPE` (1180x820) and `TABLET_PORTRAIT_TALL` (820x1180) in `tools/guide-screenshots/viewports.mjs` (`mobile: true`); shots `console-overview-tablet`, `console-overview-tablet-portrait`, `takedown-tablet`, `freeze-controls-tablet`.
- No product code changed. No `data-testid` was added.

### Geometry findings (measured by the spec)
| Check | 1024x768 | 1180x820 | Result |
|---|---|---|---|
| Take down confirm vs trigger | dialog (338,203) 292x357; trigger (537,565) 94x44 | dialog (33,235) 292x357; trigger (32,597) 94x44 | no overlap; dialog opens above the trigger (flipped), fully on screen |
| Pause popover vs pill | popover (708,113) 300x411; pill (863,65) 105x44 | popover (841,113) 300x411; pill (841,65) 105x44 | no overlap |
| Command band at 1180 | | DEV: 121px, End exercise y=127 (second row). Production-equivalent (dev button hidden): 62px, kill y=64, End y=65 (one row) | one row in production; the wrap is a dev-only artifact (W-001) |
| ENGINE / USAGE flyouts | | | start at or below the band bottom, inside the viewport, never over the kill switch (all four viewports) |

All geometry numbers are production-equivalent: the spec hides the dev-only `engine-degraded-simulate` button (as `capture.mjs` does), since it widens the band on the dev server only. The tablet screenshots are captured the same way.

Observation (issue #626): at 1180x820 the Pause popover (x 841 to 1141) extends 17px past the work area into the toolstrip column (starts at x=1124), covering the top of the toolstrip labels while open. It does not cover the pill or the command band. PR #627 right-aligns the popover; a `test.fixme` in the spec (`pause popover at 1180x820`) asserts its right edge is at or left of the toolstrip once #627 merges, and should then be un-fixme'd.

Follow-up (product, NFR-001): the Pause popover's Cancel link looks low-contrast on the dark navy background (visible in `freeze-controls-tablet.png`).

## Manual iPad checklist
Chromium (touch emulation, coarse pointer) cannot show these. Check on a real iPad in Safari before calling B3 done (MT-D7):
- [ ] Command+K versus iPadOS chords: the palette toggles with a Magic Keyboard and Safari does not take the chord; Ctrl+K as the fallback.
- [ ] The keyboard lift of the dock and the palette: with the on-screen keyboard up, the persona composer text field and **Post** stay visible, and the palette panel stays on screen (`useKeyboardOverlap`, `useVisualViewportInset`).
- [ ] iOS focus return after dialogs: focus returns to the trigger after the Take down step, the Pause popover, the End exercise dialog and the palette close.
- [ ] WebKit in general: layout bands at the four sizes, sticky command band, `visibility`-hidden panes and rotation, touch hit areas, and the 400ms arming delay with a real double-tap, long-press and drag.
- [ ] Real-device geometry of the Take down popover and Pause popover at 768 and 1180 (the numbers above are Chromium).
