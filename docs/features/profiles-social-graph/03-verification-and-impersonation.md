# Story: Verification signal & impersonation support

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-052  ·  **Design decisions:** D1-003, D1-008, R-001, R-004  ·  **Issue:** #111

## Context
The verified checkmark is a **trainable signal**, and impersonation (unverified lookalike accounts)
must be fully supportable — near-duplicate names/avatars are allowed by design (SOC-052). Per D1: the
mark is the **canonical scallop-with-check seal**, **fixed seal-blue `#2D9CDB`**, independent of the
exercise accent (D1-003), and the platform **never flags** the fake — absence of the mark is the
**only** signal (D1-008). Concrete pair: @FairhavenWater (verified) vs @FairhavenWaterUpd (no mark).
The session-3 reconciliation made this mark **cross-surface** (R-001): the console had drifted to
three ad-hoc, theme-colored marks — exactly the failure SOC-052 exists to prevent — and now renders
the same scallop seal everywhere it shows verification.

## Acceptance Criteria
- [ ] A qualifying persona (E1 verification flag) renders the verified **scallop-with-check seal** in
      **fixed seal-blue `#2D9CDB`**, unchanged by the per-exercise accent (D1-003, R-001, COR-030) —
      one shared mark component, never re-derived from theme color on any surface.
- [ ] Near-duplicate impersonator accounts (lookalike name/avatar, no mark) are fully supported and the
      platform **never** flags or warns about them (SOC-002/003, D1-008) — absence of the mark is the
      only cue. The R-004 avatar treatment preserves this: **both** accounts of the pair are org
      accounts and keep near-identical **monograms** (the duotone-silhouette treatment applies to
      humans only).
- [ ] The verified/unverified distinction is not conveyed by color alone (NFR-001) — the mark is a
      shape+seal and its absence is meaningful.
- [ ] The impersonation pair renders side-by-side under People in search (feeds-discovery search).

## Out of Scope
Verification eligibility rules (E1 template flag); search UI (feeds-discovery SOC-082); controller
takedown of an impersonator (E7 CTL-025).

## Technical Notes
Participant world. Verified-mark token is fixed, separate from `--pulse-ac`. Shared `<VerifiedMark>`
(posts/02). See implementation.md (story 03).

## Dependencies
posts/02 (VerifiedMark); E1 verification flag; feeds-discovery (search People pairing).

## Tests
- Component (RTL): verified persona shows seal-blue mark unaffected by accent; a lookalike shows no
  mark and no platform warning.
