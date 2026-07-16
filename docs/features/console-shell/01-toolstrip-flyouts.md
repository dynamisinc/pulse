# Story: Toolstrip + flyouts (the console's extension point)

**Feature:** Console shell  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** console UI architecture (D5)  ·  **Design decisions:** D5-016, D5-017, D5-019, **D7-011**  ·  **Issue:** #9

## Context
The controller console must stay legible as surfaces accumulate. The D5 review settled the frame: a
56px **right-edge toolstrip** with **flyouts**, governed by one rule — **continuous-watch** surfaces
(engine review queue, live world) keep permanent rail/column space; **consult-on-demand** surfaces
(Stories, Personas, Trainees, Rumors, participant admin, settings) are toolstrip tools that open as
flyouts with status badges. This is the extension point that keeps the rail from re-bloating as new
tools land.

> **Amendment (D7-011).** The **toolstrip container is `staff-shell`-owned** (one shell dock, two
> zones — see `staff-shell/02-toolstrip-dock.md`). This story is now about the **console registering
> its tools into the shell's surface-zone** via the shell's registration API — *not* the console
> drawing its own strip. The continuous-watch vs consult-on-demand rule (D5-017) stands as *which*
> tools the console registers vs keeps as permanent rail/column space. Participant-admin moves to a
> shell-global tool (`staff-shell/03`); it is no longer this feature's to draw.

## Acceptance Criteria
- [ ] Given the console mounted in the staff shell, when it renders, then it **registers** its
      consult-on-demand tools into the shell's toolstrip surface-zone (`staff-shell/02`, D7-011) with
      FontAwesome icons + accessible labels, and continuous-watch surfaces occupy permanent rail/column
      space rather than the toolstrip. The console does **not** draw its own strip.
- [ ] When the controller activates a toolstrip tool (click or keyboard), then its flyout opens over
      the console without displacing the live world/queue columns, and closes without losing their
      state.
- [ ] A tool's toolstrip icon carries a **status badge** (e.g. a count) that pulses red when that
      surface is escalating — conveyed by icon/label/number, **never color alone** (NFR-001).
- [ ] The toolstrip and every flyout are fully keyboard-operable and screen-reader labelled
      (NFR-001); focus returns to the toolstrip on flyout close.
- [ ] New tools register through one extension point (adding a tool does not require re-laying-out
      the console), and this surface is staff-only — never reachable from a participant session (XC-002).

## Out of Scope
The contents/behavior of each hosted tool (their own stories — persona picker in persona-operation,
review queue in engine-review-cockpit, trainee monitor story 05, etc.); the NEEDS-YOU bar (story 02).

## Technical Notes
Staff world (COBRA). Owns the console's **tool definitions + flyout content** that register into the
`staff-shell` toolstrip dock (D7-011) — the strip container itself is `staff-shell/02`. Continuous-watch
vs consult-on-demand is a per-tool config, not per-instance logic. FontAwesome icons; MUI 9 `sx`-only.
See implementation.md (story 01).

## Dependencies
E1 roles/exercise-context (staff-only gating). Foundation for every other E7 surface (Wave 1).

## Tests
- Component (RTL): activating a toolstrip tool opens its flyout without unmounting the live columns.
- Component (RTL): an escalating tool shows a badge with a number/label (not color-only).
- Unit: the tool registry lists continuous-watch vs consult-on-demand placement correctly.
