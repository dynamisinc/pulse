# Story: Toolstrip dock — one shell-owned strip, shell-global + surface zones

**Feature:** Staff shell frame  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** D7-011, COR-063  ·  **Design decisions:** D7-011  ·  **Issue:** —

## Context
D7-011 resolved a user-flagged conflict: there is **one** toolstrip, and the shell owns it. A 56px
right-edge dock with **two zones** — shell-global tools on top (Participant Admin, story 03), a
divider, then a **surface-registered zone** where the active surface contributes its own tools. The
controller toolbox (console-shell) **docks here**; surfaces **never draw a second strip**. Tools carry
status badges (e.g. a red pulsing count when a consult-on-demand surface is escalating, per D5-017).

## Acceptance Criteria
- [ ] Given a staff surface, when it renders, then the shell shows a single 56px right-edge toolstrip
      with a shell-global zone (top) and a surface-registered zone (below a divider) — and the surface
      draws **no** strip of its own (D7-011).
- [ ] A surface **registers** tools into the surface-zone via a shell API; `console-shell`'s toolbox
      tools (Stories, Personas, Trainees, Rumors, …) appear there, and the evaluator dashboard will
      register its own (fewer) tools the same way.
- [ ] Each tool supports a **status badge** (e.g. pending count / red pulsing when escalating, D5-017);
      the continuous-watch vs consult-on-demand rule (D5-017) governs *which* tools a surface registers
      vs keeps as permanent rail/column space.
- [ ] The toolstrip is **staff-world** (Cadence), keyboard-operable (each tool focusable/activatable),
      and screen-reader labelled with its badge count (NFR-001); staff-only (XC-002).
- [ ] Toolstrip + flyout state is exercise-scoped (XC-001); a flyout renders within the staff frame,
      never above the participant-preview stage.

## Out of Scope
The **individual tools/flyouts** themselves (console-shell registers them; participant-admin is story
03); the console's NEEDS-YOU bar (console-shell); the flyout **content** of any surface tool.

## Technical Notes
Staff world (COBRA/Cadence). Owns the dock container + a **tool-registration API** (the exported
seam surfaces import to contribute tools). Replaces the D5 assumption that the console draws its own
strip (COMPONENTS.md `.hgrp` etc.). See implementation.md (story 02). Reconciles console-shell story
01 (STORY-UPDATES §B): that story becomes "register into this dock," not "draw a strip."

## Dependencies
`staff-shell` header (story 01) + Cadence tokens (story 05); console-shell registers its toolbox here
(cross-feature); participant-admin (story 03) is the first shell-global tool. Ticks STORY-UPDATES §A.

## Tests
- Component (RTL): one toolstrip renders with a shell-global zone + a surface zone + divider.
- Unit: a surface registers a tool and it appears in the surface zone with its badge.
- Component (RTL): keyboard-operable; badge count is screen-reader labelled.
