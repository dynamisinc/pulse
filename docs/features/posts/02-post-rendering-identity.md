# Story: Post rendering & author identity (verified mark)

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-002  ·  **Design decisions:** D1-003, R-001, R-002, R-004  ·  **Issue:** #93

## Context
A post renders author identity — avatar, display name, handle, verified checkmark when applicable —
and **no platform-added editorial badges** (no "OFFICIAL", no "BREAKING" chrome). Authority lives in
the author's identity and their own words (SOC-002). The verified mark is the **canonical
scallop-with-check seal** in **fixed seal-blue `#2D9CDB`**, independent of the per-exercise accent —
rebranding never alters the trust signal (D1-003), and per the session-3 reconciliation the **same
mark renders on staff surfaces** (R-001 replaced the console's ad-hoc theme-colored marks with this
one). This card's anatomy is cross-surface canon: the console mirrors it (R-002).

## Acceptance Criteria
- [x] A post card renders avatar, display name, handle, relative scenario-time (COR-053), text, optional
      media/link card, and an action row with counts in the canonical order **reply · repost · like**
      (R-002; share follows where present) — the console renders the same order.
- [x] Avatars use the interim treatment until the COR-024 photo library lands (R-004): **human**
      accounts render a duotone head-and-shoulders silhouette over the persona color; **org/
      institutional** accounts render monograms (raw initials are retired).
- [x] A qualifying persona (E1 verification flag) renders the verified **scallop-with-check seal** in
      **fixed seal-blue `#2D9CDB`**, unchanged by the exercise accent theme (D1-003, R-001, COR-030).
- [x] There are **no** platform-added editorial badges ("OFFICIAL"/"BREAKING") on any post (SOC-002).
- [x] The verified/unverified state is discernible without relying on color alone where it conveys
      trust (NFR-001) — the mark is a shape+color seal, and its absence is meaningful (D1-008).
- [x] Participant-world styling only (Pulse skin, no COBRA/default MUI; D0).

## Out of Scope
Composition (story 01); provenance/telemetry internals (story 03); the impersonation search pairing
(profiles-social-graph SOC-052 / search); verification eligibility rules (E1).

## Technical Notes
Participant world. The verified-mark color is a fixed token separate from `--pulse-ac`. Post card is the
most-reused component in E2. `<VerifiedMark>` (scallop seal) and the avatar treatment are **cross-surface
primitives** — the E7 console imports the same components rather than restyling them (R-001/R-004); the
staff-only origin line the console adds on top is R-003 (live-monitoring/01), not part of this card.
See implementation.md (story 02).

## Dependencies
E1 verification flag (SOC-052 source); scenario-time utility (COR-053); persona identity. Reused
everywhere in E2.

## Tests
Delivered: `features/social/components/{PostCard,VerifiedMark,Avatar}.tsx` (rendering) +
`features/social/theme/{tokens.ts,social.module.css}` (fixed seal-blue token + card styling).

- `features/social/components/PostCard.test.tsx` — the keystone RTL suite, rendered through the real
  `ExerciseContextProvider` with an injected exercise clock for determinism: verified seal renders
  seal-blue and is unaffected by an ancestor `--pulse-ac` accent override; an unverified lookalike
  persona (SOC-052) renders a complete, plausible card with no mark and no substitute "unverified"
  text; no "OFFICIAL"/"BREAKING" chrome ever renders; action row renders reply/repost/like (and share,
  when present) in canonical order with correct counts and accessible `"<Label>, <count>"` names
  (NFR-001, never color/icon-only); `readOnly` variant hides interactive controls but keeps counts as
  inert, non-focusable text (COR-015/D1-011); post text always renders as inert text, never parsed HTML,
  for both `<img onerror>` and `<script>` payloads (NFR-004); relative/absolute timestamps render from
  the injected scenario clock, never wall-clock (COR-053); card body is keyboard-operable (Enter/Space
  fire `onOpen`, sibling action buttons/avatar do not); no origin/provenance field leaks even if present
  on the input data (XC-002).
- `features/social/components/VerifiedMark.test.tsx` — the seal is fixed seal-blue `#2D9CDB`
  independent of the `--pulse-ac` accent; accessible as an `img`-role shape+color signal via a
  `<title>`, not color alone (NFR-001); default/custom sizing.
- `features/social/components/Avatar.test.tsx` — org personas render a monogram, human personas render
  a duotone silhouette (no raw initials); the avatar is `aria-hidden` (decorative — identity is carried
  by the name/handle text); default/custom sizing.

All ACs above are met by this suite; both orchestration code-review gates clean.
