# Story: Console layout at tablet sizes (panes/tabs)

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** COR-018, NFR-001  ·  **Design decisions:** pending TABLET-AMENDMENT sign-off ([`D5-controller-console/TABLET-AMENDMENT.md`](../../design/D5-controller-console/TABLET-AMENDMENT.md), proposed D5-021…026)  ·  **Issue:** —

## Context
Controllers must be able to run the console from an iPad: 1024x768 and 1180x820 in landscape, and 768x1024 and 820x1180 in portrait.
Today `ControllerConsole.tsx` is a two-column LIVE WORLD | RUN SHEET split only at >=1280px (`SLOT_SPLIT_MIN_WIDTH_PX`), stacked below
that, plus a permanent 336px `ReviewQueue` column (`REVIEW_QUEUE_WIDTH_PX`, D5-017 continuous-watch). At tablet widths the stack and the fixed
column squeeze the work area. Staff world: COBRA (`@/theme/styledComponents`), dense-on-purpose, never confusable with a participant view.

## Acceptance Criteria
- [ ] Given widths 1180 and 1024 (landscape), when the console renders, then a documented tablet band shows a pane layout where no region is narrower than its minimum (no clipped controls, `expectNoHorizontalScroll`), and the review-queue stays continuously visible or one tap away with an unmissable count (D5-017 intent).
- [ ] Given widths 820 and 768 (portrait), when the console renders, then Live world, Run sheet and Review queue are tabs (or panes) with a tab bar whose tabs are at least 44px tall, and each tab shows a never-color-only badge (count plus label) for items needing attention (reviews, countdown under 60s).
- [ ] Given the engine control bar (kill switch, degrade indicator, demand meter, swamped toggle), then it stays reachable at every tablet size without scrolling the pane content away, and the kill switch is never hidden behind a tab.
- [ ] Given rotation (landscape <-> portrait) mid-session, then the active tab/pane, scroll position, an open composer/persona dock and any pending review edit are preserved.
- [ ] Given the existing role guards (`canControl`), then an evaluator or planner on a tablet sees exactly what they see on desktop (no new controls, no removed guard); verified by role.
- [ ] Given a keyboard (hardware) on the tablet, then tab order across panes is logical and tabs follow the ARIA tabs pattern (arrow keys), NFR-001.
- [ ] Two-worlds: only COBRA components and `CobraStyles` spacing; FontAwesome icons; MUI 9 `sx`-only; no participant skin.
- [ ] User guide: tablet layout paragraph in `docs/guide/controller-guide.md` (screenshots by story 16).

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
