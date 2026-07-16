# Story: Per-exercise brand theming hooks

**Feature:** Participant shell  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-066 (COR-030)  ·  **Design decisions:** D7 (theming hooks)  ·  **Issue:** —

## Context
The shell must carry **zero hardcoded brands** — every "Fairhaven"/"BAY SHIELD" string in the mockup
is demo config (D7 fidelity note). The shell exposes per-exercise **brand tokens** (COR-066/030) that
channels consume for their skins; the shell itself uses only its own chrome font (Figtree) and the
compliance/alert/overlay palettes. This is what lets one shell serve any exercise's brand and any
outlet's skin (NWS-002) without a code change — brand independence is the whole point of the
participant channel stubs in the mockup.

## Acceptance Criteria
- [ ] Given a per-exercise brand config, when a channel mounts, then it receives brand tokens
      (COR-066/030) it can theme against; the shell hardcodes **no** brand name, color, or logo.
- [ ] Changing the exercise brand config changes channel skins with **no shell code change** (the
      "Fairhaven" demo strings prove brand independence, not product copy).
- [ ] The shell's own chrome (compliance banners Figtree/green, alert-bar palettes, overlay treatments)
      is **independent** of the per-exercise brand — the exercise signal never re-skins to match the
      fiction (XC-002/003).
- [ ] Brand tokens are exercise-scoped (XC-001) and never leak one exercise's brand into another
      session.
- [ ] Participant surfaces theme from these tokens and **never** read as an enterprise app / COBRA /
      default MUI (D0 §2).

## Out of Scope
The **brand authoring** UI + token schema authority (exercise-configuration COR-030); per-outlet news
skins (NWS-002, E4); the staff-world Cadence tokens (`staff-shell` story 05).

## Technical Notes
Participant world. A brand-token provider mounted within the participant route subtree (per CLAUDE.md:
each brand mounts its own theme within its route subtree; never the COBRA staff theme). Tokens are
server-driven, exercise-scoped. See implementation.md (story 07).

## Dependencies
exercise-configuration brand config (COR-030); the channel-mount contract (story 04); channels (E2+)
consume the tokens. Ticks STORY-UPDATES §A.

## Tests
- Unit: channels receive brand tokens; no brand string is hardcoded in shell code.
- Component (RTL): swapping brand config reskins a channel without touching shell code; shell chrome
  is unchanged by the brand.
