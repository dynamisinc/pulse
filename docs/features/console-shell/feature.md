# Feature: Console shell (toolstrip, flyouts, action bar)

**Epic:** E7 — Controller Command Surface  ·  **Phase:** 1  ·  **Feature ref:** D5 additions
**World:** staff  ·  **Issue:** #2  ·  **Status:** feature.md stub — decompose before build

> **Architectural foundation of the console (Wave 1).** The D5 design review introduced the shell
> pattern that hosts every other E7 surface, so this feature lands first. Stories below are planned,
> not yet authored.

## Summary
The controller console's frame: a right-edge **toolstrip** with **flyouts**, a persistent
**NEEDS-YOU action bar**, a **static identity badge**, and the interaction-safety rule that chips
locate-and-highlight but **never act**. This is the extension point that keeps the console from
re-bloating as surfaces are added.

## Requirements covered
D5-016, D5-017, D5-019 (toolstrip + flyouts); D5-010, D5-012(d) (NEEDS-YOU bar);
D5-012(g) → **amends COR-005** (static identity during conduct); D5-014/3.4 (Flag → AAR, partial);
D5-016 + D5-014/3.1 (trainee monitor flyout, partial).

## Design references
`docs/design/D5-controller-console/README.md`, the canonical `docs/design/DECISIONS.md` (D5 + R + D7
sections), and both amendment logs: **`D5-controller-console/STORY-UPDATES.md`** (§B ADDs, §A COR-005)
and **`D7-application-shells/STORY-UPDATES.md`** (§B — the frame moves to `staff-shell`; this feature
keeps its content). Apply the amendments; cite the decision IDs.

**Session 3 → D7 (shell extraction — RESOLVED).** The console's improvised container chrome —
exercise banner, header/brand lockup, exercise identity block, clock cluster, state pill, staff
presence, header action group — was inventoried (R-006, `docs/design/COMPONENTS.md`) and frozen
pending the D7 unified-shell session. **D7 has landed** (`docs/design/D7-application-shells/`): those
elements are now owned by the new **`staff-shell`** frame feature (header, toolstrip dock, identity
badge, classification tag, clocks, state pill, presence). **This feature keeps only the console-
specific content that mounts in that frame:** the toolbox tools (which *register into* `staff-shell`'s
toolstrip dock, D7-011 — not a strip this feature draws), the NEEDS-YOU action bar, the console's
flyouts, Flag, and the trainee monitor. See `docs/design/D7-application-shells/STORY-UPDATES.md` §B.

## Stories (planned)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Toolstrip + flyouts — **register tools into `staff-shell` dock (D7-011)** | D5-016/17/19 | Not Started | #9 |
| 02 | NEEDS-YOU action bar — locate & highlight, never act | D5-010, D5-012(d) | Not Started | #10 |
| 03 | Static identity badge during conduct — **presentation → `staff-shell` header (D7-007/010)** | COR-005 / D5-012(g) | Not Started | #11 |
| 04 | Flag on any post → after-action record (minimal) | D5-014/3.4 | Not Started | #12 |
| 05 | Trainee monitor flyout (adaptive-loop metric) | D5-016, D5-014/3.1 | Not Started | #13 |

## Dependencies
E1 exercise-context + roles (Director vs Controller gating); the E10 after-action record sink for
Flag (story 04, minimal write now, full annotation set deferred to D6/evaluator). Command palette
here hosts `persona-operation`'s picker.

## Design notes
**Interaction safety (D5):** NEEDS-YOU chips highlight a target (amber ring) but **never execute** —
nothing fires without an explicit Fire press (no action-at-a-distance). Continuous-watch surfaces
(engine review queue, live world) keep permanent rail/column space; consult-on-demand surfaces
(Stories, Personas, Trainees, Rumors, participant admin) are toolstrip flyouts with status badges.
Keyboard-first, fully operable (NFR-001).
