# Story: Staff header — lockup, identity badge, clocks, state pill, classification tag

**Feature:** Staff shell frame  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-063, COR-005  ·  **Design decisions:** D7-007, D7-010  ·  **Issue:** —

## Context
The 56px navy Cadence header every staff surface renders under. It carries, left→right: the brand
lockup (PULSE / SURFACE NAME), the **exercise identity badge** (name + role/cell, **static during
conduct**, COR-005), the scenario+wall **clock pair**, the exercise **state pill** (dot + text), the
**classification tag** (`UNCLASSIFIED // FOUO`, persistent), staff **presence** avatars, and the
**Preview as participant** button (story 04). D7-010 folded the old separate exercise bar into this
header — there is **no** standalone `.exbar`; the FOUO marking survives as a compact mono tag.

## Acceptance Criteria
- [ ] Given a staff surface, when it renders, then the shell header shows the brand lockup (PULSE /
      {surface name}), the identity badge, the scenario+wall clock pair, the state pill, the
      classification tag, presence, and the Preview-as button — in the navy Cadence chrome.
- [ ] The **identity badge is static during conduct** (COR-005 / D5-012(g)): exercise name + role/cell,
      **no switcher** in a Live exercise; switching is pre-conduct (Build/Staged). *(This is the
      canonical home of the behavior `console-shell` story 03 specified as interim — R-006 resolved.)*
- [ ] The **classification tag** `UNCLASSIFIED // FOUO` is a persistent compact mono tag in the header
      (D7-010), config-driven per deployment; there is **no** separate staff exercise bar.
- [ ] The **state pill** shows conduct state with **text + dot, never color-only** (NFR-001); the
      **scenario clock** and **wall clock** are both shown (dual-time, Cadence convention).
- [ ] The header is **staff-world** (navy `#1e3a5f` Cadence) — thumbnail-distinguishable from any
      participant view (XC-002, hard gate); fully keyboard-operable and screen-reader labelled (NFR-001).

## Out of Scope
The full **exercise-switcher** UX + assignment model (E1 COR-005); the toolstrip (story 02); the
Preview-as **behavior** (story 04 — this story renders the button); the console's own header action
controls (console-shell — they dock into the header action slot).

## Technical Notes
Staff world (COBRA/Cadence). Reads exercise identity + lifecycle state (COR-005/032/050) and roles.
Replaces the D5 improvised `.exbar` / `.hdr` / `.exsw` / `.clocks` / `.state-pill` / `.presence`
inventory (COMPONENTS.md) — this is their unified home. Use `@/theme/styledComponents` where they map.
See implementation.md (story 01). Reconciles console-shell story 03 (STORY-UPDATES §B).

## Dependencies
E1 exercise identity + roles + lifecycle + clock (COR-005/032/050); `staff-shell` Cadence tokens
(story 05); Preview-as button target (story 04). Ticks STORY-UPDATES.md §A.

## Tests
- Component (RTL): header renders lockup + badge + clocks + state pill + FOUO tag + presence + preview.
- Component (RTL): Live exercise → static badge, no switcher; state pill has text + dot (not color-only).
- Component (RTL): header is Cadence-navy, keyboard-operable.
