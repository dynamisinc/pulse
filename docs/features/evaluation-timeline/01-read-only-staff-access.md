# Story: Read-only staff access to the evaluator dashboard

**Feature:** Evaluation timeline & replay foundation  ·  **Epic:** E10  ·  **Phase:** 4  ·  **Status:** Not Started
**Requirements:** EVL-004, COR-013  ·  **Design decisions:** D6-002  ·  **Issue:** —

## Context
EVL-004 requires the timeline (and by extension the whole evaluator dashboard) to be staff-only —
evaluator **read**, per COR-013 ("Evaluator role can see all channels and all controller activity
but cannot post, react, or DM") — and available **live during conduct**, not just after EndEx. D6-002
resolves how "read-only" reads on this specific surface: no pause, no engine control, no dial, no
fire, no compose — **nothing rendered disabled**, because the COR-015 read-only principle ("affordances
absent, not disabled") applies here too. The tab row itself carries a one-line caption pointing
steering to the Controller Console. Shell-global items (Preview-as-participant, participant admin,
staff presence, the clock pair) remain, per D7-007 — those are shell-owned furniture, not this
story's to remove. See `docs/10-evaluation-aar.md` F10.1 and `feature.md`.

## Acceptance Criteria
- [ ] Given a user with the Evaluator role, when they open the evaluator dashboard during a live,
      in-conduct exercise (not only post-EndEx), then the Live/Timeline/Replay/Metrics views render
      fully populated — EVL-004's "available live, not just after."
- [ ] Given the evaluator dashboard's tab row, when it renders, then it carries the caption
      "Read-only — evaluators observe; steering lives in the Controller Console (COR-013)" — per
      D6-002.
- [ ] Given the evaluator dashboard, when it renders, then no steering affordance exists anywhere on
      the surface — no pause, no engine kill switch, no fire/veto/approve, no compose, no dial —
      per D6-002 these are **absent**, never rendered-and-disabled.
- [ ] Given a participant account, or a role other than Evaluator/Director/post-ex Controller, when
      it requests the evaluator dashboard route, then access is denied — this is a staff-only
      surface, never reachable from a participant session (XC-002).
- [ ] Given the D7 staff shell, when the evaluator dashboard mounts inside it, then shell-global
      items (Preview-as-participant, participant admin quick-panel, staff presence, scenario+wall
      clock pair) still render per D7-007 — this story only removes steering, not the shell's own
      furniture.
- [ ] Isolation (XC-001/COR-001): the dashboard's data is scoped to the evaluator's assigned
      exercise; a request for another exercise's evaluation data returns 403/404 and extends the
      standing isolation suite.
- [ ] Accessibility (NFR-001): the read-only caption and the absence of steering controls are
      conveyed as programmatically-associated text (announced to assistive tech), not implied by
      missing buttons alone.

## Out of Scope
The contents of each view (Live/Timeline/Replay/Metrics — their own stories); the Controller
Console's steering surfaces (E7); the mechanics of the Evaluator role itself (`identity-auth-roles`
already owns COR-013's role definition — this story only consumes and gates on it).

## Technical Notes
Staff world. Owns `src/frontend/src/features/evaluator/` — the route guard and the tab-row shell
(Live/Timeline/Replay/Metrics) every other story's view renders into. Reuses the D7 staff shell
(header/toolstrip) — do not draw a second header/exbar. See `implementation.md` (Wave 1).

## Dependencies
`identity-auth-roles` (E1 — COR-013 Evaluator role, session scoping); the D7 staff shell.

## Tests
- Component (RTL): steering controls are absent from the DOM (not merely disabled) for the
  Evaluator role.
- Unit: route guard denies non-staff roles and cross-exercise dashboard requests.
- Isolation suite: extend the standing cross-exercise-access test for the evaluator dashboard route.
