# Feature: Press Room (The Wire Room) — participant release publishing

**Epic:** E5 — Press Room  ·  **Phase:** 3, pulled forward — **December release (Tom, 10/21)**  ·  **Feature ref:** F5.1 + F5.2 + F5.3
**World:** participant (composer, wire, newsrooms, release page, approval gate) + staff (one COBRA kind editor + approval settings)  ·  **Issue:** #694 (Epic #690)

## Summary
The PIO's formal publishing surface: a participant writes a press release (a **rich-text body**, pasted from Word if they like) on behalf of an organization they operate, optionally attaches a finished PDF as a **download-only attachment** (Tom, 10/29, Q-03), publishes now or
embargoes it, optionally socializes it, and the release lands on the public wire and the org's newsroom. E5 is the **only participant-authored channel**, so it is the one that adds
a participant write path, a narrow `document` (PDF attachment) media kind, an optional approval gate and the evaluation signals about *how* the PIO worked. It is built **on** the shared pipeline in
[`../channels-foundation/implementation.md`](../channels-foundation/implementation.md) (FC-1..FC-9): a `release` kind descriptor, a `press` channel mount, a kind editor for the
console and skin token files. It never edits a foundation file; the gaps it found were all resolved in the foundation or the platform by the December consolidation pass (see [`implementation.md`](implementation.md) § Foundation follow-ups — resolved).

## Requirements covered
- **F5.1 Authoring:** PRS-001 (org-account authoring, per-human attribution, JIC account), PRS-002 (**rich-text-first** sheet with first-class paste-from-Word, image, and a download-only PDF attachment — PDF-first inline rendering is post-December, Q-03), PRS-003 (embargo/schedule), PRS-004 (autosave + edit timeline), PRS-005 (visible revisions, prior versions kept).
- **F5.2 Wire:** PRS-010 (wire), PRS-011 (permalink; the link-preview endpoint itself is foundation 06), PRS-012 (org newsrooms), PRS-013 (opt-in cross-post).
- **F5.3 Staff and world:** PRS-020 (controller publishes as any org persona), PRS-021 (approval gate), PRS-022 (publish event for E8/E10).
- **Evaluation-facing:** the E10 signals EVL-010 (response + approval latency), plus the per-human attribution and draft-timeline evidence the epic §3 describes.
- **Cross-cutting:** XC-001/002/004/008/010, COR-053, COR-018, NFR-001 (+ PDF-12 #680, Section 508), NFR-004, NFR-007 (edit-timeline capture disclosure), NFR-008.
- **Closes foundation Q3** (document media kind) and implements the defaults for **Q2** (one child outlet per org under The Wire Room) and **Q6** (revise-own yes, retract staff-only).

## Design references
`docs/design/D0-FOUNDATIONS.md`; `docs/design/D4-press-weather.md` (Part A only) and `docs/design/D4-press-weather/` (README, SHELL-CONTRACT, STORY-UPDATES, mockup); `docs/design/DECISIONS.md` `## D4`.
**Applied (press items only):** D4-001 (composer is the letterhead sheet, not a form/CMS), D4-002 (drop never publishes; exactly one confirm gate; cancel-embargo notifies approvers + audit trace),
D4-003 (redundant SCHEDULED state; "FOR IMMEDIATE RELEASE" flips to "EMBARGOED — HOLD UNTIL"), D4-004 (cross-post unchecked, handle named, live card), D4-005 ("Releasing as {org} ▾" reuses the D1 chip),
D4-006 (autosave ambient, never a control), D4-007 (approval gate is participant paper; return REQUIRES a note), D4-008 (wire public to all participants), D4-012 (watermark slot, applied to release page chrome).
D4 STORY-UPDATES items this feature ticks when built: PRS-002, PRS-003, PRS-004, PRS-013, PRS-020, PRS-021, PRS-001/D4-005, PRS-010/012/D4-008, C-1. Backlog items: return-notification reach (stays wire-internal), mobile pass (done in stories 07/09), sanitized paste (stories 04/07); **real inline PDF render is Deferred (post-December, story 03, Q-03)** and the D4-001 headline-from-PDF suggestion goes with it.
**Not E5 (left to E6):** all WX-* and the weather halves of D4 (D4-009/010/011 and the weather part of D4-012). The shared alert bar (D4-010) is foundation.
**Reconciliation C-1 applied:** the approval gate is participant paper regardless of operator; a controller approving does so through the participant approval view (preview-as-participant frame), never a staff-chrome control (story 10).

## Stories
| # | Story | Requirement(s) | Stack | Wave | Effort | Status | Issue |
|---|-------|----------------|-------|------|--------|--------|-------|
| 01 | [Release kind, press contracts and org newsrooms](01-release-kind-and-org-newsrooms.md) | PRS-010/012, PRS-001, PRS-005 (model), XC-004 (vocabulary) | fullstack | 3 | M | Not Started | #738 |
| 02 | [`document` media kind: download-only PDF attachment (sniff, size cap, deny-list scan, attachment-only serve)](02-document-media-kind.md) | PRS-002, NFR-004, Q3 | backend | 1 | M | Not Started | #739 |
| 03 | [Inline PDF page rendering](03-inline-pdf-rendering.md) — **Deferred (post-December, Q-03)** | PRS-002, NFR-001, NFR-004 | frontend | — | (M) | Deferred (post-December) | — (no issue) |
| 04 | [Release author API: orgs, drafts, autosave, edit timeline](04-release-author-api.md) | PRS-001, PRS-004, COR-018 | backend | 3 | L | Not Started | #740 |
| 05 | [Publish, embargo, revise and cross-post API](05-publish-embargo-revise-api.md) | PRS-003, PRS-005, PRS-013, PRS-022 (publish), D4-002 | backend | 4 | L | Not Started | #741 |
| 06 | [Approval gate backend](06-approval-gate-backend.md) | PRS-021, D4-002/007, EVL-010 | backend | 4 | L | Not Started | #742 |
| 07 | [Composer: the letterhead sheet (rich-text body, optional PDF attachment)](07-composer-letterhead-sheet.md) | PRS-002, PRS-004, PRS-001, D4-001/005/006 | frontend | 4 | L | Not Started | #743 |
| 08 | [Composer: timing, cross-post and the single confirm gate](08-composer-publish-panel.md) | PRS-003, PRS-013, D4-002/003/004 | frontend | 5 | M | Not Started | #744 |
| 09 | [The wire, org newsrooms and release page (attachment block, no inline PDF)](09-wire-newsroom-release-page.md) | PRS-010/011/012, PRS-005, D4-003/008 | frontend | 5 | L | Not Started | #745 |
| 10 | [Approval gate participant UI](10-approval-gate-ui.md) | PRS-021, D4-007, C-1 | frontend | 5 | M | Not Started | #746 |
| 11 | [Revise a published release (author side)](11-revise-published-release.md) | PRS-005, Q6 | frontend | 5 | S | Not Started | #747 |
| 12 | [Release telemetry, evaluator signals and the reaction hook](12-release-telemetry-and-evaluation.md) | PRS-022, PRS-004 (NFR-007), EVL-010, XC-004 | backend | 5 | M | Not Started | #748 |
| 13 | [Console: `release` kind editor (publish as any org)](13-console-release-editor.md) | PRS-020, PRS-002 | frontend | 5 | M | Not Started | #749 |
| 14 | [Console: approval-gate settings](14-console-approval-settings.md) | PRS-021 (config), D4-007 #1 | frontend | 5 | S | Not Started | #750 |
| 15 | [Press conformance and the compose-to-publish bench](15-press-conformance.md) | XC-001, NFR-001/004, PDF-12 (#680), D4-001 | testing | 6 | M | Not Started | #751 |

Totals: **14 in-scope stories** — 5 L (04, 05, 06, 07, 09), 7 M (01, 02, 08, 10, 12, 13, 15), 2 S (11, 14); **1 Deferred (03)**. ≈ 25.0 sittings (was 15 stories / 6 L / 7 M / 2 S / ≈ 27.5: story 02 L → M, story 03 deferred). Stack mix: 5 backend, 1 fullstack, 7 frontend (2 staff), 1 testing.

## Dependencies
**Foundation (channels-foundation):** 01, 02 (Wave 1) → 03, 04, 08, 13, 14 (Wave 2) → 05, 06, 07, 12 (Wave 3) → 15, 17, 18 (Wave 4) → 20 (Wave 5). Per-story edges are in the Wave Plan.
**Already built:** the media pipeline, `IExerciseClock`, telemetry sink, notifications, the social composer and `PostIngestService`, the participant shell. **Not yet built and on the critical path:** multi-org
operation grants (`identity-auth-roles/09`, Not Started) and the "Posting as" chip (posts/06) — see Q-E5-2 in `implementation.md`; story 04 ships a swappable `IReleaseOrgResolver` so E5 is not blocked.
**December-date risk:** see `implementation.md` § Schedule risk. With the PDF reduced to a download-only attachment (Q-03) the security long pole is gone; the critical path is the participant write path (04/05) + the composer (07/08, now a rich-text editor that needs the Q-13 library).
**Migrations (Q-28, Tom 10/29):** story 06 owns **M2** (formerly M5), the only migration after F01's M1; it is no longer ordered behind F16. **Single org per person (Q-18, Tom 10/29):** `IReleaseOrgResolver` returns the bound persona; PP-5 is not needed.

## Design notes
- **Two worlds.** Everything a PIO or citizen touches (composer, wire, newsroom, release page, approval gate) is **participant world**: the `wire-room` outlet skin via `OutletSkinScope`, letterhead-forward, austere, never COBRA, never a default MUI look, never a CMS or admin look (D4 anti-pattern).
  The two staff stories (13, 14) are COBRA and live in the console.
- **Participant-authored content must never break fiction or leak staff fields.** Author DTOs carry only what the author may see (own org's drafts/scheduled/returned items, colleagues' display names);
  never `origin`, `injectId`, `featuredRank`, `background`, wall clock, other orgs' drafts, or approval internals beyond the author's own return note (XC-002). No platform chrome is added to a release (FC-9.5).
- **Scenario time only (COR-053).** Embargo is set, shown and counted down in scenario time; the server stamps everything from `IExerciseClock`; wall clock exists only in staff DTOs and telemetry.
- **Mobile-first (D0 §4.6).** The D4 mockup is desktop; every participant story here carries a mobile AC (closing D4 STORY-UPDATES §D "mobile pass").
- **Soft delete (XC-010).** Participants can delete only their own drafts (soft). A published release is never deleted by a participant; retract is staff-only and renders the foundation tombstone (Q1 default).
- **Telemetry (XC-004).** The publish itself is `press_release` (FC-6); other E5 events are vocabulary additions only (story 01 owns the list).

## Out of scope (parked, per the epic and Master PRD)
Press-conference / AV simulation; media-inquiry inbox; multi-org joint releases beyond the JIC-account pattern; **embargo visible to media personas pre-release** (epic §5 Q1, recommended post-launch);
return-notification reach beyond the wire (D4-007 sign-off #3, explore later); the portal's Press Room module (PRT-003, E3); the link-preview endpoint (foundation 06); offline cache (PDF-02);
server-side watermark burn-in of PDFs (PDF-09); OCR/translation of PDFs; PDF form/annotation features; **inline PDF rendering, PDF page counts and headline-from-PDF suggestion (post-December, story 03, Q-03)**.
