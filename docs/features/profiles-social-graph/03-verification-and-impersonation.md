# Story: Verification signal & impersonation support

**Feature:** Profiles & social graph  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** SOC-052  ·  **Design decisions:** D1-003, D1-008  ·  **Issue:** #111

## Context
The verified checkmark is a **trainable signal**, and impersonation (unverified lookalike accounts)
must be fully supportable — near-duplicate names/avatars are allowed by design (SOC-052). Per D1: the
mark is a **fixed seal-blue `#2D9CDB`** independent of the exercise accent (D1-003), and the platform
**never flags** the fake — absence of the mark is the **only** signal (D1-008). Concrete pair:
@FairhavenWater (verified) vs @FairhavenWaterUpd (no mark).

## Acceptance Criteria
- [ ] A qualifying persona (E1 verification flag) renders the verified mark in **fixed seal-blue
      `#2D9CDB`**, unchanged by the per-exercise accent (D1-003, COR-030).
- [ ] Near-duplicate impersonator accounts (lookalike name/avatar, no mark) are fully supported and the
      platform **never** flags or warns about them (SOC-002/003, D1-008) — absence of the mark is the
      only cue.
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
