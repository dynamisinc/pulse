# Story: Participant-visible exercise identity — requirements gap

**Feature:** Exercise configuration  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-005 (gap; touches COR-003/004, COR-031, XC-002/XC-003)  ·  **Design decisions:** R-006, COMPONENTS.md divergence #5  ·  **Issue:** #180

## Context
The session-3 shell extraction surfaced a **requirements gap, not a visual task** (COMPONENTS.md
"Shell extraction", divergence #5): the controller console shows the exercise name + role
**persistently** during conduct (COR-005; `console-shell/03`), while participant surfaces show
**no exercise identity anywhere** — nobody looking at a participant screen can tell which exercise
session it belongs to. No requirement currently says whether that asymmetry is intended.

The tension this decision must resolve:

- **COR-004 / XC-002** deliberately keep the exercise *concept* out of the participant world — no
  picker, no list, no simulation-status surface (`exercise-isolation/04`). "Which session is this"
  must not reintroduce admin/meta affordances into the fiction.
- **Concurrent exercises are a core capability** (COR-003, multi-instance personas; per-exercise
  hostnames in `exercise-isolation/08`). Two sessions of the same fiction family can run in one
  facility — a wrong-room/wrong-hostname screen is plausible and today **undetectable from the
  participant frame**.
- **Out-of-fiction framing already exists**: the compliance chrome (COR-031, XC-003;
  `exercise-configuration/02`) renders configurable text outside the app frame on every channel —
  the one place session identity could appear without breaking fiction (D0 §2).

This story delivers the **requirement decision** that the D7 unified-shell session (R-006) then
designs against. It must land **before D7 specs the shared frame**.

## Acceptance Criteria
- [ ] A written requirement decision (recorded in this story and reflected into the E1 epic text)
      answering: **do participant surfaces carry visible exercise-session identity?** If yes —
      *what* identity (exercise name, session code), *for whom* (participants, room facilitators,
      support staff), and *where it may render* (environment chrome only — never inside the
      fiction).
- [ ] The decision explicitly reconciles **COR-004/XC-002**: any identity shown creates no
      exercise-selection or simulation-status affordance for participants
      (`exercise-isolation/04` ACs remain satisfiable as written).
- [ ] The decision is handed to **D7 as a named input** (cited from the D7 brief/session notes as
      resolving COMPONENTS.md divergence #5) before the unified shell is specced.
- [ ] Outcome routing: if "yes, in the chrome" — `exercise-configuration/02` (compliance chrome)
      and the D7 shell inherit it as a chrome **content** requirement, consistent across every
      enabled channel (XC-003); if "no" — the D1↔D5 asymmetry is recorded as intended and the
      wrong-session risk is explicitly accepted in the E1 epic.

## Out of Scope
Any visual or shell design (D7 owns the shell — R-006); the staff identity badge
(`console-shell/03`, COR-005 as amended by D5-012(g)); banner presentation (interim pending D7);
hostname-scoping mechanics (`exercise-isolation/08`).

## Technical Notes
Requirements/documentation story — no code. The likely resolution surface is the COR-031
environment chrome (outside the fiction frame), already per-exercise-configurable text — that
path keeps XC-002 intact and needs no new participant-world element. Whatever is decided must
hold on every participant channel (social, portal, outlets, weather — XC-003).

## Dependencies
COMPONENTS.md ("Shell extraction", divergence #5) + R-006 (`docs/design/`);
COR-004 (`exercise-isolation/04`), COR-031 (`exercise-configuration/02`), COR-005
(`console-shell/03`). **Blocks:** the D7 unified-shell session consumes this decision.

## Tests
None here (requirements decision). The outcome is tested by the stories it lands in (compliance
chrome / D7 shell stories).
