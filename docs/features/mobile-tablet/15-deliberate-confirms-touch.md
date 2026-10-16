# Story: Takedown, Freeze and EndEx confirms stay deliberate on touch

**Feature:** Phones and tablets  ·  **Epic:** E7  ·  **Phase:** 2  ·  **Status:** Not Started
**Requirements:** CTL-025 (takedown), CTL-023 (tiered pause: Freeze guarded), CTL-024 (break-fiction, Director-gated)  ·  **Design decisions:** none  ·  **Issue:** —

## Context
Fat-finger risk is the tablet's main hazard. Takedown (tombstone + incident category), Freeze world (participants notice) and EndEx are
already guarded by deliberate confirm steps (`TakedownAction` confirm popover, `PausePill` Freeze confirm with Back / Confirm freeze, `EndExerciseDialog`).
Touch must not weaken them or make them unusable. Staff world: COBRA.

## Acceptance Criteria
- [ ] Given Take down on a live-world row at 768 and 1180 wide, when tapped, then the confirm popover opens fully on-screen (no clipping at viewport edges), the category radio group has options of at least 44px, and nothing is taken down until Confirm take down is tapped (a single stray tap never completes it).
- [ ] Given the pause popover, when Freeze world is chosen, then the guarded confirm step appears and restates which holding page participants will get; Confirm freeze and Back are visually and spatially distinct (at least 8px apart, at least 44px tall) and the destructive button is not auto-focused.
- [ ] Given EndEx (and break-fiction where the Director-gated type-to-confirm exists), then touch flows keep the existing gate (role + typed confirmation + logging unchanged); the on-screen keyboard does not hide the typed-confirm field or its Confirm button.
- [ ] Given a double-tap, long-press or accidental drag on a confirm control, then the action fires at most once, long-press/context menu does not bypass the step, and iPadOS text-selection or zoom gestures do not trigger it.
- [ ] Given any of these dialogs, then Escape (hardware keyboard) cancels, a visible Cancel/Back exists for touch, focus is trapped and returned on close, and state is carried by text plus icon (not color-only, NFR-001).
- [ ] Given the existing role guards, then non-controller roles cannot reach these controls on a tablet (verified by role), and the server remains the authority.
- [ ] Soft delete (XC-010): takedown still tombstones and retains; no hard delete is introduced.
- [ ] User guide: tablet notes in `docs/guide/controller-guide.md` for Takedown and Freeze (`takedown` and `freeze-controls` shots are recaptured at tablet size in story 16).

## Out of Scope
Changing what the confirms do, adding hold-to-confirm gestures (parked as an option), new tiers, evaluator controls.

## Technical Notes
Files: `controller/liveWorld/TakedownAction.tsx`, `steering/PausePill.tsx`, `lifecycle/{EndExerciseDialog,ExerciseLifecycleControl}.tsx`. Keep their documented focus-trap and
Escape behavior; their module headers describe the contract. See `implementation.md` story 15.

## Dependencies
Stories 12, 13 (layout context).

## Tests
Existing `TakedownAction*`, `PausePill*`, `EndExerciseDialog*` tests stay green plus new assertions for spacing/focus; e2e at tablet sizes in story 16.
