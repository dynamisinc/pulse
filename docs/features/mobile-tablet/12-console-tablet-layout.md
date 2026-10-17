# Story: Console layout at tablet sizes (panes/tabs)

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** COR-018, NFR-001  ·  **Design decisions:** D5-021 (bands), D5-022 (layout table), D5-023 (command band), D5-026 (steering disclosure, More menu), from [`D5-controller-console/TABLET-AMENDMENT.md`](../../design/D5-controller-console/TABLET-AMENDMENT.md), signed by Tom (merged 2026-10-17, #594)  ·  **Issue:** —

## Context
Controllers must be able to run the console from an iPad: 1024x768 and 1180x820 in landscape, and 768x1024 and 820x1180 in portrait.
Today `ControllerConsole.tsx` is a two-column LIVE WORLD | RUN SHEET split only at >=1280px (`SLOT_SPLIT_MIN_WIDTH_PX`), stacked below
that, plus a permanent 336px `ReviewQueue` column (`REVIEW_QUEUE_WIDTH_PX`, D5-017 continuous-watch). At tablet widths the stack and the fixed
column squeeze the work area. Staff world: COBRA (`@/theme/styledComponents`), dense-on-purpose, never confusable with a participant view.

## Acceptance Criteria
- [x] Given widths 1180 and 1024 (landscape), when the console renders, then a documented tablet band shows a pane layout where no region is narrower than its minimum (no clipped controls, `expectNoHorizontalScroll`), and the review-queue stays continuously visible or one tap away with an unmissable count (D5-017 intent). Verified in unit tests (grid templates, visibility) and by a Playwright look at 1180x820 and 1024x768: no horizontal scroll or clipped region inside the console. Caveat: the staff shell header is about 1190px wide at its intrinsic size, so the page itself scrolls sideways below that; fixed by story 13 (#621) (its `minmax(0,1fr)` fix); the formal `expectNoHorizontalScroll` e2e is story 16.
- [x] Given widths 820 and 768 (portrait), when the console renders, then Live world, Run sheet and Review queue are tabs (or panes) with a tab bar whose tabs are at least 44px tall, and each tab shows a never-color-only badge (count plus label) for items needing attention (reviews, countdown under 60s). Verified at 768x1024 and 820x1180 (the 820x1180 stacked variant gives Live world / Run sheet tabs above a docked Review queue). Badges: "N new", "N due" (items still pending), "N · M under 60s".
- [x] Given the engine control bar (kill switch, degrade indicator, demand meter, swamped toggle), then it stays reachable at every tablet size without scrolling the pane content away, and the kill switch is never hidden behind a tab. Command band is sticky under the header and holds the engine control bar (kill switch first), Pause and End exercise at the far right; never in a tab, flyouts are positioned over the pane area only. It may wrap to two rows **in portrait**. At 1180 the band currently wraps too (the engine control bar alone is about 980px, so End exercise lands on a second row); raised with Tom, pending (options: accept, or condense the engine bar in a later story).
- [x] Given rotation (landscape <-> portrait) mid-session, then the active tab/pane, scroll position, an open composer/persona dock and any pending review edit are preserved. Panes stay mounted (hidden with `visibility`, not unmounted); a typed value, scroll offset, the active tab and the open persona dock are asserted across a tab switch and a rotation. Not separately tested: a pending Review edit (the queue is never unmounted, so it is kept by the same mechanism). The jsdom assertions use a raw DOM input and a scrollTop value; real scroll, layout and React-owned control survival across a rotation is story 16's Playwright work.
- [x] Given the existing role guards (`canControl`), then an evaluator or planner on a tablet sees exactly what they see on desktop (no new controls, no removed guard); verified by role. Tested for a controller, an evaluator and a planner at 1180x820. Existing guards are unchanged.
- [x] Given a keyboard (hardware) on the tablet, then tab order across panes is logical and tabs follow the ARIA tabs pattern (arrow keys), NFR-001. Tabs follow the ARIA tabs pattern (roving tabindex, arrows, Home, End, `aria-selected`). Tab order across panes follows DOM order: command band, title row, steering row, tabs, panes.
- [x] Two-worlds: only COBRA components and `CobraStyles` spacing; FontAwesome icons; MUI 9 `sx`-only; no participant skin. COBRA buttons, `CobraStyles` spacing, FontAwesome, `sx`-only. The pane tab bar and disclosure row are plain styled buttons (COBRA has no tab or disclosure component), using staff-shell tokens.
- [x] User guide: tablet layout paragraph in `docs/guide/controller-guide.md` (screenshots by story 16). Tablet layout section added under the console tour in `docs/guide/controller-guide.md`; screenshots are story 16's.

## Out of Scope
Phone layouts for the console, evaluator tablet (B4 deferred), new console features, changes to desktop >=1280 behavior, touch drag-and-drop reordering.

## Technical Notes
Single owner of `features/controller/components/ControllerConsole.tsx` (811 lines): do not split work across builders; new
`console/ConsolePaneTabs.tsx` and `consoleLayout.ts` hold the logic so the file does not grow further. The hand-built shortcut strip lives here: leave
shortcut behavior to story 14. `staffRouteRegistry.tsx` and `App.tsx` stay untouched. See `implementation.md` story 12.

## Dependencies
Story 01 (e2e kit). Coordinate frame width with story 13.

## Tests
Unit tests for `consoleLayout` breakpoint selection and tab state preservation; `ControllerConsole*.test.tsx` stay green; e2e in story 16.

## Known limits (story 12)
- **Crossing 1280 remounts.** Rotations WITHIN the tablet bands keep every pane, flyout and half-typed edit. Crossing 1280 (for example an iPad Pro at 1366 rotating to 1024) swaps the desktop work area for the tablet frame, so panes and flyouts remount and a half-typed edit is lost (persona drafts survive through their store). Note for story 16: do not assert persistence across the 1280 boundary.
- **Hidden panes and live regions.** Panes are hidden with `visibility: hidden`, so `role=status` live regions inside a hidden pane (RunSheetPanel, LiveWorldColumn) are not announced while their tab is hidden. Mirroring critical failures into a frame-level live region is a follow-up.
- **Live world reads nothing while hidden (CR-001).** `PaneShowingContext` stops the mark-read dwell while the tab is hidden and restarts it when shown.
