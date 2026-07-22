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

**Build-readiness note:** `<VerifiedMark>` (fixed seal-blue, shape+color, absence-is-the-signal) and
the `@FairhavenWater`/`@FairhavenWaterUpd` fixture pair (near-identical org monograms via `<Avatar>`)
already shipped and are already tested as part of **posts/02 (Complete)** and persona-management's
seed cast — see `PostCard.test.tsx` ("verified mark" / "unverified lookalike" suites) and
`VerifiedMark.test.tsx`. This story owns **no new shared component**; its only net-new surface in this
wave is exercising the same mark on the **profile header** (story 01) and keeping the AC honest about
what's actually buildable now (search is not yet built — see AC4).

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
- [ ] The impersonation pair renders honestly wherever personas appear **today** — post cards
      (already shipped, posts/02) and the profile header (story 01: `@FairhavenWater`'s header shows
      the mark, `@FairhavenWaterUpd`'s shows none) — with no additional verification logic beyond
      reusing the one shared `<VerifiedMark>`. (Rendering this pair side-by-side under **People in
      search** is feeds-discovery/03's scope once search ships — not yet built, out of this wave;
      that story already lists profiles' verified mark as a dependency.)

## Out of Scope
Verification eligibility rules (E1 template flag); search UI and its People section (feeds-discovery
SOC-082 — not yet built; will consume this story's fixture/mark work when it lands); controller
takedown of an impersonator (E7 CTL-025).

## Technical Notes
Participant world. Verified-mark token is fixed, separate from `--pulse-ac`. Shared `<VerifiedMark>`
(posts/02). See implementation.md (story 03).

## Dependencies
posts/02 (VerifiedMark, Complete); E1 verification flag; story 01 (profile header render target).
Downstream: feeds-discovery/03 (search People pairing) consumes this once search ships.

## Tests
- Component (RTL, already exists in `PostCard.test.tsx`/`VerifiedMark.test.tsx`): verified persona
  shows seal-blue mark unaffected by accent; a lookalike shows no mark and no platform warning.
- Component (RTL, net-new for this story): the profile header (story 01) renders the same honest
  pair — `@FairhavenWater` with the mark, `@FairhavenWaterUpd` without — via the shared
  `<VerifiedMark>`, no new logic.
