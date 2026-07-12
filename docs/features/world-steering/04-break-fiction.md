# Story: Break Fiction — Director-gated safety broadcast

**Feature:** World steering  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-024  ·  **Design decisions:** D5-014/1.2, D5-007  ·  **Issue:** #27

## Context
The house lights. A Director-level action publishes an unmissable, visually **alien** overlay to every
session in the exercise on every channel — "REAL-WORLD EVENT — EXERCISE SUSPENDED" (configurable:
safety stop, ENDEX, real emergency instructions). The D5 review **renamed** it **"Break Fiction"** and
**constrained** it: it replaces participant screens **inside the exercise only** (nothing leaves the
platform), is **Director-gated**, requires **type-to-confirm ("BROADCAST")**, lives in a visually
distinct **guarded/latched** group, and **every use is logged** to the exercise record.

> **Amendment (D5-014/1.2, D5-007).** Before: "Real-World Broadcast" (scope ambiguous). After:
> "Break Fiction" — in-exercise only, Director-gated (locked for Controller role), type-to-confirm,
> guarded/latched, logged; the confirm dialog states destination + that use is logged.

## Acceptance Criteria
- [ ] Given the **Director** role, when they invoke Break Fiction from its guarded/latched group and
      type the confirm word **"BROADCAST"**, then an alien, non-dismissable overlay replaces every
      **in-exercise** participant session's screen on every channel with the configured message.
- [ ] The **Controller** role cannot invoke it (the control is locked/absent for Controller) — it is
      Director-gated.
- [ ] The overlay is deliberately unlike any simulation chrome or compliance banner (visually alien —
      "the house lights"), cannot be dismissed by participants while active, and clears only by a
      Director action.
- [ ] The action affects **only** sessions within this exercise — nothing is sent off-platform; the
      confirm dialog states the destination and that the use is logged.
- [ ] **Every** invocation and clear is logged to the exercise record per session (XC-004/XC-010);
      the message text is configurable (safety stop / ENDEX / real emergency).
- [ ] Invoking Break Fiction implies **Freeze world** (story 03) — the clock stops and the world holds.

## Out of Scope
The tiered pause itself (story 03); the compliance chrome / EXERCISE watermark (E1 COR-031/NFR-008 —
these are the normal in-fiction markings, not the alien break); EndEx flow (E1 COR-054).

## Technical Notes
Staff world (COBRA). Owns the guarded control + type-to-confirm + a broadcast channel that reaches all
in-exercise sessions (SignalR fan-out when present; design the delivery-log-per-session path). The
overlay component is intentionally outside both visual worlds. Reuses the Freeze state (story 03). See
implementation.md (story 04).

## Dependencies
E1 roles (Director gate), exercise-context (in-exercise-only scope), lifecycle; story 03 (Freeze); the
real-time broadcast host. Ticks STORY-UPDATES.md §A **CTL-024**.

## Tests
- Component (RTL): Controller role cannot access the control; Director can, and it requires typing
  "BROADCAST".
- Unit: invocation targets only this exercise's sessions and writes a per-session delivery log.
- Unit: invoking Break Fiction sets Freeze (clock stopped).
