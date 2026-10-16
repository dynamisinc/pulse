# Story: Refuse participant writes in Freeze and pause (#379)

**Feature:** Exercise build & go-live  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** CTL-023, COR-032, SOC-001  ·  **Design decisions:** ADMIN-IDENTITY-MODEL §5.1, §8.2 (L: live or staged (dry run); refused when paused or frozen), §10 (A5)  ·  **Issue:** #379
**Stack:** backend  ·  **Review tier:** Tier-2 (correctness, security)  ·  **Wave:** A5

## Context
Sim writes are lifecycle-gated: only in `live` and not Freeze ([`docs/design/ADMIN-IDENTITY-MODEL.md`](../../design/ADMIN-IDENTITY-MODEL.md) §5.1 "A5 adds that Freeze and pause refuse participant writes", tracker #379). Pause tiers per D5-amended CTL-023.

## Acceptance Criteria
- [ ] Given Freeze world (and the tier that pauses participant activity), when a participant posts, replies, reacts, follows or uploads an avatar, then the request is refused (409 `exercise-frozen`) with no state change and a participant-visible, in-fiction-safe message.
- [ ] Given Pause injects or Pause engine only, participant writes remain allowed (per tier definitions).
- [ ] Given `build`, `staged`, `completed` or `archived`, participant writes are refused; readonly sessions remain read-only.
- [ ] Controller and staff writes are unaffected by Freeze except where the matrix says otherwise.
- [ ] Refusals are telemetered (XC-004) with the actor and tier; no content from the refused body is stored.
- [ ] Isolation (XC-001/002, COR-001/002/007; brief C5): every new route has a foreign-exercise test **and** a foreign-org test; a cross-tenant id returns the same bare 404 as a missing id (the bare-404 pattern, design doc §7.2); id-taking org routes join the `CompositionRootWiringTests` allow-list.
- [ ] Accessibility (NFR-001): the refusal message is announced in a live region and is not color-only.
- [ ] Two worlds: participant message uses the brand skin; no COBRA.
- [ ] User guide (C5): `controller-guide.md` (tiers) and `participant-guide.md` updated in the same PR.

### Copilot review 2 fold (2026-10-16, ADMIN-IDENTITY-MODEL §8.2)
- [ ] Participant sim writes stay **allowed in `staged`** (dry runs, matching `ExerciseLifecycleStates.BehaviourOf(Staged)` today) and in `live`. They are refused only when paused or frozen. The route × role matrix test (story 17) encodes staged as allowed.

## Out of Scope
Changing tier semantics; client-side optimistic UI beyond showing the refusal.

## Technical Notes
Backend (+ small participant UI message). One write-gate filter on participant write routes. Orchestrator clearance for route-group wiring.

## Dependencies
Wave A5, after identity 17 (matrix) and A3.

## Tests
Tier x state x route matrix tests; participant RTL for the message.
