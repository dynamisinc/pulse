# Feature: Posts

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.1
**World:** participant  ·  **Issue:** #83

## Summary
The atom of Pulse: short-form posts with media, author identity, provenance, link previews, soft
delete, and grant-gated post-as-organization. The composer trainees live in — indistinguishable from a
real platform, fully instrumented underneath.

## Requirements covered
SOC-001, SOC-002, SOC-003, SOC-004, SOC-005, SOC-006 (with COR-018 attribution, COR-053 scenario time,
XC-004 telemetry, NFR-004 sanitization).

## Design references
Brief `docs/design/D1-social-app.md`; handoff `docs/design/D1-social-app/` + **`STORY-UPDATES.md`**.
Amendments applied: **SOC-002** verified mark fixed seal-blue `#2D9CDB` (D1-003); **SOC-005** tombstone
thread-only, feeds silently omit (D1-009); **SOC-006** "Posting as" chip grant-gated, one identity at a
time (D1-007/R2); composer depleting ring counter (D1-R5).

**Session-3 cross-surface reconciliation applied** (`docs/design/DECISIONS.md` §"R — Cross-surface reconciliation"):
the verified mark is the canonical **scallop-with-check** seal on both worlds (R-001); engagement row
order is **reply · repost · like** everywhere (R-002); avatars use the interim duotone-silhouette
(humans) / monogram (orgs) treatment until COR-024 (R-004); SOC-003 origin renders staff-side as the
console's always-visible origin line (R-003 — the data contract is story 03). The "Posting as" chip's
presentation is **interim — superseded by the D7 shell** (R-006; story 06).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | Post composition (text/media/hashtags/mentions) | SOC-001 | Not Started | #92 |
| 02 | Post rendering & author identity (verified mark) | SOC-002 / D1-003 | Not Started | #93 |
| 03 | Post provenance & telemetry | SOC-003 (XC-004) | Not Started | #94 |
| 04 | Link previews for in-sim URLs | SOC-004 | Not Started | #95 |
| 05 | Soft delete & tombstones (thread-only) | SOC-005 / D1-009 | Not Started | #96 |
| 06 | Post as organization (grant-gated chip) | SOC-006 / D1-007 | Not Started | #97 |

## Dependencies
E1: exercise-isolation (scoping), identity-auth-roles (org grants COR-018, observer COR-015),
exercise-clock (scenario time COR-053), persona-management (authors), telemetry (XC-004). This is the
foundation the rest of E2 builds on. Backend not present yet — compose/publish is the contract seam.

## Design notes
**Participant world** — per-brand skin (Pulse), **never** COBRA / default MUI look (D0). Verified mark
is the fixed seal-blue trust signal, independent of the per-exercise accent (D1-003). No platform-added
editorial badges (SOC-002). Observer mode hides the composer/Post (controls absent, not disabled;
D1-011). Origin (`controller-as-persona` / engine / inject) is captured but never participant-visible
(SOC-003).
