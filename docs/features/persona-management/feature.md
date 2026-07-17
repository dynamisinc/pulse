# Feature: Persona management & cast libraries

**Epic:** E1 — Platform Core & Exercise Isolation  ·  **Phase:** 1  ·  **Feature ref:** F1.3
**World:** staff  ·  **Issue:** #40

## Summary
The reusable population model: org-library persona templates (with the voice notes that make the E8
engine believable), named casts for one-click seeding, mid-exercise persona creation, backdated
background history, and a bundled avatar library. Rich enough to populate a believable world, reusable
enough to make setup fast.

## Requirements covered
COR-020, COR-021, COR-022, COR-023, COR-024 (with SOC-054 audience magnitude, COR-053 scenario-time
for backdated content, XC-005 persona attribution).

## Design references
D0 foundations. Voice-profile quality is Phase-1-critical because the Phase-2 engine (E8) is only as
believable as these notes (COR-020).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Persona templates (create/edit/clone/archive, voice notes) | COR-020 | In Progress | #53 |
| 02 | Casts & one-action seeding with derived state | COR-021 | In Progress | #54 |
| 03 | Mid-exercise persona creation (≤60s) | COR-022 | Not Started | #55 |
| 04 | Pre-exercise backdated post history | COR-023 | Not Started | #56 |
| 05 | Bundled avatar library + upload | COR-024 | Not Started | #57 |

## Dependencies
Exercise-isolation (Persona/PersonaTemplate multi-instance, COR-003); org-library ownership
(Organization). Feeds E7 persona-operation (the console operates these) and E8 (voice notes drive
generation). Backend not present yet.

## Design notes
Staff world. Persona *types* (news outlet, agency, citizen, influencer, business, bad actor) drive
default styling, verification defaults, and E8 behavior profiles. Voice/personality notes are the
Phase-1-critical asset. Backdated content renders under the scenario-time rule (COR-053).
