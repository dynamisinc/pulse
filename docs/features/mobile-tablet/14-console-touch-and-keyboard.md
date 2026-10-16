# Story: Console keyboard shortcuts and touch alternatives

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** NFR-001 (controller console fully keyboard-operable)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Controllers on an iPad use either a hardware keyboard (Magic Keyboard) or touch only. Every console action must work both
ways. Today the console binds Cmd/Ctrl+K (command palette, `ControllerConsole.tsx`; palette in `console/CommandPalette.tsx`), arrow-key
radios in confirms, and queue/composer keys. Staff world: COBRA.

## Acceptance Criteria
- [ ] Given an inventory of every console keyboard shortcut (documented in the PR and `controller-guide.md`), when the story is done, then each has a visible, labelled touch control with a hit area of at least 44px on coarse pointers.
- [ ] Given an iPad hardware keyboard, when Cmd+K is pressed, then the command palette toggles (as on desktop), `preventDefault` still suppresses the browser/iPadOS default, and no shortcut collides with a reserved Safari/iPadOS chord; any collision is documented with an alternative.
- [ ] Given touch only, when the controller needs the palette, then a visible button (the "Personas" toolstrip tool) opens it and its list items are at least 44px, scrollable, and select with a single tap.
- [ ] Given the review queue, escalation dial and persona composer, then every action is reachable without hover, right-click, or a key chord, and tapping never triggers a destructive action in one step (see story 15).
- [ ] Given a shortcut hint is displayed, then it shows the platform-correct modifier (Cmd on Apple, Ctrl otherwise) and is hidden or replaced by a tap hint when no keyboard is detected (coarse pointer only).
- [ ] Accessibility: focus is never lost to the page when a pane switches; the on-screen keyboard does not cover the composer's text field (visual-viewport aware).
- [ ] User guide: keyboard and touch shortcut table in `docs/guide/controller-guide.md`.

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
