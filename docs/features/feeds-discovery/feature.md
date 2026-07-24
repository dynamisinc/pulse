# Feature: Feeds & discovery

**Epic:** E2 — Social Network  ·  **Phase:** 1  ·  **Feature ref:** F2.9 (§3 Feeds & discovery)
**World:** participant  ·  **Issue:** #91

## Summary
Where trainees live: the All Posts firehose, the Following feed, full-text search, real-time updates via
a **buffered "new posts" pill (never auto-scroll / live-insert)**, the stretch engagement-weighted "For
You" mode, and the grant-gated PIO multi-column monitoring mode.

## Requirements covered
SOC-080, SOC-081, SOC-082, SOC-083, SOC-084 + PIO multi-column mode (D1-010, elevated from the epic
design notes).

## Design references
`docs/design/D1-social-app/` + `STORY-UPDATES.md`. **SOC-083 amended (D1-005):** bursts buffer behind a
sticky "▲ N new posts" pill (`aria-live=polite`); the feed **never live-inserts / auto-scrolls** into
the reading stream. **ADD (D1-010):** PIO Columns, grant-gated, off by default. Observer mode hides the
composer/pill (D1-011). Read-only sessions default to All Posts (COR-015).

## Stories
| # | Story | Requirement(s) | Status | Issue |
|---|-------|----------------|--------|-------|
| 01 | All Posts feed (global chronological) | SOC-080 | Complete | #120 |
| 02 | Following feed | SOC-081 (COR-015) | Not Started | #121 |
| 03 | Full-text search (+ People/impersonation) | SOC-082 / D1-008 | Not Started | #122 |
| 04 | Real-time updates — "new posts" pill (no auto-scroll) | SOC-083 / D1-005 | Complete | #123 |
| 05 | Engagement-weighted "For You" mode (stretch) | SOC-084 | Not Started | #124 |
| 06 | PIO multi-column mode (grant-gated) | D1-010 | Not Started | #125 |
| 07 | Live post store — Wave-1 minimal slice (shared store + live read, no pill) | SOC-083 (partial) / D1-005 (partial) | Complete | — |

**Story 07** is a Wave-1 cross-feature integration slice (see `console-shell/01` +
`persona-operation` 01–03), authored to unblock a controller-published post appearing in the feed.
**Delivered** — built Gate-1 clean on `feature/simcell-operator`, wired at the Wave-1 integration step,
Gate-2 clean on the integrated umbrella (684/684 tests, browser-verified: a console-published post
appears at the top of the participant feed with no reload). It is a **partial** of SOC-083/D1-005 —
story 04 remains the FULL follow-up (buffered pill, SignalR + polling fallback) and is not superseded
or completed by 07; story 04 stays Not Started.

## Dependencies
posts (PostCard), profiles (follow edges), hashtags-trending; E1 isolation, scenario-time, telemetry,
observer/read-only (COR-015). SignalR real-time host (Phase 1) powers live updates.

## Design notes
Participant world. The feed is the burst surface (NFR-002/SOC-071): the "new posts" pill keeps it
legible and accessible (`aria-live=polite`, NFR-001) — **posts never live-insert or auto-scroll while
the user reads.** Chronological is the launch default; "For You" is a per-exercise stretch toggle. PIO
Columns replaces center+sidebar with TweetDeck-style columns for org-grant holders (D1-010).
