# Story: Organization-account operation (post-as-org, attribution)

**Feature:** Identity, auth & roles  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** COR-018  ·  **Design decisions:** D4-005 (E5 realizes the switcher as "Releasing as")  ·  **Issue:** #66

## Context
Participants can be granted operation of one or more org personas ("post as Fulton County EM") in
setup or live. Multiple humans may share one org account — and **every action behind a shared handle
records the individual human** in telemetry (per-human attribution is evaluation-critical). A
participant-facing account switcher appears in posting UIs; full JIC workflow is Phase 3, but
attribution + post-as-org ship in Phase 1 (COR-018, XC-004).

## Acceptance Criteria
- [ ] A participant can be granted operation of one or more org personas (setup or live staff action).
- [ ] When a human posts/replies/DMs behind a shared org handle, telemetry records the **individual
      human** (COR-018/XC-004) — the origin `actingHumanId` — while the public sees only the org.
- [ ] Multiple humans may operate one org account concurrently (supported, attributed).
- [ ] A participant-facing account switcher is exposed in posting UIs (realized in E2 SOC-006 as the
      "Posting as" chip / E5 PRS-001 as "Releasing as", per **D4-005**); this story provides the
      grant + attribution model.

## Out of Scope
The composer account-switcher UI (E2 SOC-006); full JIC concurrent-draft/shift-handoff/approval chains
(Phase 3); controller post-as-persona (E7 — a different, staff mechanism).

## Technical Notes
Foundation. The grant + per-human attribution model consumed by E2/E5 posting and E7. See
implementation.md (story 09).

## Dependencies
Stories 01/02; telemetry (XC-004); consumed by E2 SOC-006, E5 PRS-001, and E7 attribution.

## Tests
- Unit/integration: a post behind a shared org handle records the acting human; multiple humans can
  operate one org account.
