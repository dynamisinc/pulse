# Story: Console keyboard shortcuts and touch alternatives

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** In Review
**Requirements:** NFR-001 (controller console fully keyboard-operable)  ·  **Design decisions:** D5-024  ·  **Issue:** —

## Context
Controllers on an iPad use either a hardware keyboard (Magic Keyboard) or touch only. Every console action must work both
ways. Today the console binds Cmd/Ctrl+K (command palette, `ControllerConsole.tsx`; palette in `console/CommandPalette.tsx`), arrow-key
radios in confirms, and queue/composer keys. Staff world: COBRA.

## Acceptance Criteria
- [x] Given an inventory of every console keyboard shortcut (documented in the PR and `controller-guide.md`), when the story is done, then each has a visible, labelled touch control with a hit area of at least 44px on coarse pointers.
- [x] Given an iPad hardware keyboard, when Cmd+K is pressed, then the command palette toggles (as on desktop), `preventDefault` still suppresses the browser/iPadOS default, and no shortcut collides with a reserved Safari/iPadOS chord; any collision is documented with an alternative. (Collision clause: pending device check, MT-D7 / story 16.)
- [x] Given touch only, when the controller needs the palette, then a visible button (the "Personas" toolstrip tool) opens it and its list items are at least 44px, scrollable, and select with a single tap.
- [x] Given the review queue, escalation dial and persona composer, then every action is reachable without hover, right-click, or a key chord, and tapping never triggers a destructive action in one step (see story 15).
- [x] Given a shortcut hint is displayed, then it shows the platform-correct modifier (Cmd on Apple, Ctrl otherwise) and is hidden or replaced by a tap hint when no keyboard is detected (coarse pointer only).
- [x] Accessibility: focus is never lost to the page when a pane switches; the on-screen keyboard does not cover the composer's text field (visual-viewport aware).
- [x] User guide: keyboard and touch shortcut table in `docs/guide/controller-guide.md`.

## Out of Scope
New shortcuts, remapping, handwriting/Scribble support, gesture-based actions (swipe), evaluator shortcuts.

## Technical Notes
Files: `controller/console/CommandPalette.tsx`, `components/{PersonaComposer,PersonaPicker}.tsx`, `steering/EscalationDial.tsx`, `engine/components/ReviewQueue.tsx`.
The shortcut strip and key listener sit in `ControllerConsole.tsx`, owned by story 12: send one-line change requests there or sequence after 12. Use
`(pointer: coarse)` rather than viewport width to decide touch affordances. See `implementation.md` story 14.

## Dependencies
Stories 12, 13.

## Tests
Unit tests for the platform modifier label; existing palette/queue tests stay green; touch/keyboard e2e in story 16.

## Implementation notes (story 14)
- **Inventory** is the table in `docs/guide/controller-guide.md` ("Keyboard and touch shortcuts") and TABLET-AMENDMENT section 4.
  The one missing touch control was the palette's close (Esc); added as a labelled 44px button, shown on a coarse pointer only so the desktop Tab order is unchanged.
- **44px / 8px** under `(pointer: coarse)` via `controller/consoleTouch.ts` (min-width/min-height on the control, no hit-slop). Covers ReviewQueue (card actions, select toggle, Batch approve), RunSheet (every `RunSheetButton`, row and header gaps, Mark fired dialog), Live world (Reply as, N new, Mark all read, filter clear, Retry, Pin), composer buttons (CSS module), edit composer, picker rows/chips/Pin, palette and dock close, dial track, noise levels.
- **Hints:** `core/hooks/platformModifier.ts` (pure, tested incl. iPadOS `MacIntel` + `maxTouchPoints > 1`) and `controller/shortcutHints.tsx`: one keycap; tap hint "Tap PERSONAS or press <chord>" on a coarse pointer; compose-send hint hidden on coarse.
- **Cmd+K on iPadOS (reasoning only, no device):** the handler accepts `metaKey || ctrlKey` and calls `preventDefault` before the modal check, so the chord is always swallowed. Cmd+K is not a reserved Safari/iPadOS chord (Safari's Cmd+L, Cmd+T, Cmd+W, Cmd+R are; iPadOS shortcut overlay Cmd+Space is system). Ctrl+K is not reserved either. Confirm on a real device under MT-D7.
- **Keyboard inset:** on a coarse pointer only, the persona dock lifts by `useKeyboardOverlap` (overlap of its containing block with the visual viewport, not the window) and the palette backdrop pads up by `useVisualViewportInset`, its panel capped at `calc(100% - 16px)`. **Needs the on-device check (MT-D7 / story 16).**
- **Focus:** story 12 selects the tab of a focused pane on a band change; verified by a rotation test, no gap found. Tapping a tab moves focus to the tab.
- **No hover-only info:** the escalation dial's phase tooltip is printed under the label on a coarse pointer.
- **Desktop-visible micro-changes at base level:** ReviewQueue select toggle is `inline-flex` centred; EscalationDial header Stack gets `flexWrap: wrap`; PersonaPicker Pin gets `justifyContent: center`; the persona dock close is now 44px on coarse itself (story 13's outside-in rule in `StaffShellFrame` was removed).
- **No compose-send hint was added** (no AC asks for new desktop UI); `platformChordLabel` remains for the strip and the PERSONAS tooltip.

## AC to test mapping
| AC | Tests |
|---|---|
| Inventory, 44px / 8px | the `.touch` suites: `ReviewQueue.touch`, `RunSheet.touch`, `LiveWorldColumn.touch`, `PersonaPicker.touch`, `PersonaComposer.touch` (CSS), dial and noise touch blocks |
| Cmd+K preventDefault and toggle | `ControllerConsoleRoute.tablet.test.tsx` (collision clause: pending device check) |
| PERSONAS to palette, single tap | route tablet test; `consoleTouch.keyboard.test.tsx` (palette rows, close) |
| Hints, platform modifier | `platformModifier.test.ts`, `shortcutHints.test.tsx` |
| No hover-only / chord-only | dial touch block (phase description), `.touch` suites |
| Focus and keyboard | route tablet test (rotation focus); `consoleTouch.keyboard.test.tsx` and `useKeyboardOverlap.test.tsx` (dock lift, palette inset) |
| Guide table | `controller-guide.md` |

## Deferred
- Emoji picker cells in the composer are under 8px apart on a coarse pointer (story 16 or a follow-up).
