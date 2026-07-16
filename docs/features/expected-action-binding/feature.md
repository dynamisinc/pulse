# Feature: Expected-action binding

**Epic:** E8 — Adaptive Content Engine  ·  **Phase:** 4  ·  **Feature ref:** F8.1 / ADP-006 (depends E9)
**World:** staff / backend  ·  **Issue:** #141
**Status:** feature.md stub — Phase 4; depends on E9 (Cadence integration). NOT in the v1 launch set.

## Summary
Bind a storyline's expectation to Cadence inject `ExpectedAction` data, so "the participant didn't do
what the MSEL anticipated" becomes a first-class **automated** trigger (CTL-032 escalation) rather
than a manual controller judgment. This turns the MSEL's expected actions into silence-escalation
triggers directly.

## Requirements covered
ADP-006 (expected-action integration). *(Phase 4 — depends on E9)*

## Design references
Epic ADP-006 (explicitly "not part of the v1 launch set"; tagged Phase 4 by adversarial review B6).
`docs/design/E8-ENGINE-ARCHITECTURE.md` §1.1 (the `expectedActionRef` slot, reserved in v1) + §14
(Phase-4 stub). E9 `09-ecosystem-integration.md` (INT-*, the Cadence fire-into-Pulse integration).

## Stories (planned — Phase 4; do not build until E9 lands)
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Bind storyline expectation to Cadence ExpectedAction (CTL-032 automated) | ADP-006 | Not Started | — |

## Dependencies
E9 (Phase 4 — Cadence inject firing + the `ExpectedAction` data feed, INT-*); `storyline-model` (v1
provides the reserved `expectedActionRef` slot so no migration is needed); `silence-escalation` (v1 —
the trigger this automates); E7 CTL-032 expected-action tracking (manual now, E8-automated here).

## Design notes
Staff/backend. Phase 4, hard-dependent on E9 (Cadence integration). The v1 `storyline.expectation`
carries a **reserved, null `expectedActionRef`** slot (architecture §1.1) precisely so this Phase-4
binding needs no schema migration. Until E9 lands, expected-action tracking is manual (E7 CTL-032);
this feature makes "they missed the MSEL-anticipated action" an automated silence-escalation trigger.
