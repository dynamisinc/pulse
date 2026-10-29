# Feature: News network (outlets, articles, breaking and corrections)

**Epic:** E4 — News Network  ·  **Phase:** 3, pulled forward — **December release (Tom, 10/21)**  ·  **Feature ref:** F4.1–F4.4 (one feature: the channel is a single rendering system)
**World:** participant (articles, outlet pages, skins) + staff (article editor only)  ·  **Issue:** #693 (Epic #689)

## Summary
Four credibility-diverse news outlets (Newsline 7, The Courier-Ledger, The National Wire, The Scoop) rendered by **one** article/homepage system, each outlet a skin token file (D3-P1). Participants read
full articles at stable permalinks, see authorial breaking banners and two kinds of corrections, play Beat video inline, and share to Pulse as a link card; controllers author, schedule and revise
articles through the foundation's publish seam. This feature is **channel-specific only**: everything generic (content table, funnel, scheduler, permalinks, realtime, alert source, channel router,
skin mechanism, primitives, staff shell) is the [channels foundation](../channels-foundation/feature.md) and is referenced by `FC-n` / story number, never redefined.

## Requirements covered
| Group | IDs | Where |
|---|---|---|
| F4.1 Outlets | NWS-001, 002, 003 (home), 004 (link target only) | 03, 10–14, 15, 16 (outlet rows + seed: foundation 03; paired post: foundation 18) |
| F4.2 Articles | NWS-010, 011, 012, 013, 014, 015 | 01, 02, 04–09 (NWS-011 permalink: foundation 06 + 02; NWS-015 link preview: foundation 06/18, share: 09) |
| F4.3 Authoring | NWS-020, 021, 022 | 17, 18, 01 (accept engine drafts) |
| F4.4 Reader / telemetry | NWS-030, 031, 032 | 04, 08, 09, 19 (FC-6 base: foundation 15) |
| Cross-cutting | XC-001/002/004, COR-053, NFR-001 (+ PDF-12 #680), NFR-004, NFR-008, NFR-002 (burst), XC-010 | per-story ACs; proven in 20 |

Requirements owned by the foundation, not re-implemented here: NWS-010 model fields/persistence, NWS-011 permalink resolution, NWS-013 publish/schedule/hold mechanics and revision storage, NWS-004 paired-post
creation, NWS-015 link-preview data, NWS-020 shell/preview/inject attach (E4 supplies only the article editor).

## Design references
`docs/design/D3-news-outlets.md`, `docs/design/D3-news-outlets/STORY-UPDATES.md`, `DECISIONS.md` `## D3` (**D3-P1…P4**), `D0-FOUNDATIONS.md` (two worlds, watermark, a11y), `D7-application-shells/SHELL-CONTRACT.md`
(channel renders in the content region only), `D2-portal.md` (D2-008 watermark parity; D2-002 print/Courier-Ledger caution). Approved fidelity is **exhibits 1a/1b only** (grid contract + registers); the
full clickable mockup (article states, homepage compositions, mobile, skin switcher) is a separate, later design deliverable (open question 6).

### D3 STORY-UPDATES checklist → stories (ticks happen in `STORY-UPDATES.md` when each story is built; not ticked in this docs-only pass)
| Item | Type | Story |
|---|---|---|
| NWS-002 skins are token files; fifth outlet = zero layout code | AMEND | 10–13, 03, 20 |
| NWS-010 kicker + slot-mapped model | AMEND | 01, 04 |
| NWS-003 lead-mode enum, Scoop-only clutter | AMEND | 15, 14 |
| NWS-012 breaking slot empty by default, vocabulary token | AMEND | 07 (+ 01 payload) |
| NWS-013 exactly two correction renderings | AMEND (RECONCILE flagged) | 08, 17 |
| NWS-014 one player, tokenized treatment | AMEND | 05 |
| NWS-032 watermark chip bottom-right on hero | AMEND | 05 (+ foundation 14) |
| NWS-031 discussion footer, no comments ever | AMEND (hardening flagged) | 09 |
| NWS-030 telemetry invisibility | AMEND | 04, 19, 20 |
| NWS-001 brand config bounded by CANNOT list | AMEND | 03, 20 (server guard: foundation 03) |
| NWS-011/015 share + embed contracts | AMEND | 06, 09 |
| ADD skin token schema | ADD | foundation 13 (schema), 10–13 (instances) |
| ADD article grid spec | ADD | 04 |
| ADD Scoop clutter-module set | ADD | 14 |
| ADD register token values | ADD | 10–13 |
| RECONCILE epic Q1 (bylines optional) | RECONCILE | 04 (byline format token) |
| BACKLOG: full mockup; NWS-020/021/022 UI; NWS-004 pairing | BACKLOG | mockup: open question 6; authoring: 17/18; pairing: foundation 18 |

## Stories
| # | Story | Requirement(s) | Stack | E4 wave | Effort | Foundation deps | Status | Issue |
|---|-------|----------------|-------|---------|--------|-----------------|--------|-------|
| 01 | [Article kind descriptor](01-article-kind-descriptor.md) | NWS-010/012/013/022/032, NFR-004 | backend | 1 | M | F02, F04 | Not Started | #718 |
| 02 | [News channel mount and routes](02-news-channel-mount.md) | NWS-011/015/003 | frontend | 4 | M | F08, F12, F13, F15 | Not Started | #719 |
| 03 | [Outlet masthead and section nav](03-outlet-masthead-nav.md) | NWS-001/002/003 | frontend | 1 | M | F02, F13 | Not Started | #720 |
| 04 | [Article page grid, head block, assembly](04-article-page-assembly.md) | NWS-010/011/030, COR-053 | frontend | 2 | L | F02, F13, F14, F15 (mock until live) | Not Started | #721 |
| 05 | [Hero media, Beat video player, watermark chip](05-hero-media-beat-video.md) | NWS-014/032, NFR-008 | frontend | 1 | M | F02, F13, F14 | Not Started | #722 |
| 06 | [Body, pull quotes, inline media, embedded Pulse posts](06-article-body-embeds.md) | NWS-010/015, NFR-004 | frontend | 1 | M | F02, F13, F14, F21 | Not Started | #723 |
| 07 | [Breaking-news slot](07-breaking-slot.md) | NWS-012 | frontend | 1 | S | F02, F13, F14 | Not Started | #724 |
| 08 | [Corrections, Updated stamp, retraction tombstone](08-revisions-and-retraction.md) | NWS-013, XC-010 | frontend | 1 | M | F02, F13, F14 | Not Started | #725 |
| 09 | [Share to Pulse and discussion footer](09-share-and-discussion-footer.md) | NWS-011/015/030/031 | frontend | 1 | M | F02, F13, F14, F18, F21 | Not Started | #726 |
| 10 | [Skin — Newsline 7](10-skin-newsline7.md) | NWS-002 | frontend | 1 | S | F13 | Not Started | #727 |
| 11 | [Skin — The Courier-Ledger](11-skin-courier-ledger.md) | NWS-002 | frontend | 1 | S | F13 | Not Started | #728 |
| 12 | [Skin — The National Wire](12-skin-national-wire.md) | NWS-002 | frontend | 1 | S | F13, F14 | Not Started | #729 |
| 13 | [Skin — The Scoop](13-skin-the-scoop.md) | NWS-002 | frontend | 1 | S | F13, F03 | Not Started | #730 |
| 14 | [Scoop clutter modules](14-scoop-clutter-modules.md) | NWS-002/003 | frontend | 1 | M | F13 | Not Started | #731 |
| 15 | [Outlet home page](15-outlet-home-page.md) | NWS-003, NFR-002 | frontend | 2 | L | F13, F14, F15, F09 | Not Started | #732 |
| 16 | [Section pages](16-section-pages.md) | NWS-001/003 | frontend | 3 | S | F15 | Not Started | #733 |
| 17 | [Article editor](17-article-editor.md) | NWS-020/022 | frontend (staff) | 3 | L | F17, F07 | Not Started | #734 |
| 18 | [Article templates](18-article-templates.md) | NWS-021 | frontend (staff) | 2 | S | — (E4 01 only) | Not Started | #735 |
| 19 | [E4 telemetry beyond FC-6](19-news-telemetry.md) | NWS-030/014, XC-004 | frontend | 2 | S | F15 | Not Started | #736 |
| 20 | [News conformance](20-news-conformance.md) | XC-001, NFR-001 (#680), NFR-004/008 | testing | 5 | M | F20, F06, F07 | Not Started | #737 |

Totals: 20 stories — 3 L (04, 15, 17), 9 M, 8 S; 1 backend (01), 2 staff-world (17, 18), 1 testing (20), the rest participant frontend. `F##` = channels-foundation story number.

## Dependencies
**Channels foundation** (all of E4 sits on it). No E4 story is a prerequisite for the foundation. E4 starts when foundation **Wave 2** is merged (F02 contracts, F13 skin system, F14 primitives; F03/F04 for story 01's runtime
registration) and finishes when F12/F15/F17/F20 land. Until a backend route exists, frontend stories run on `features/channels/mocks/` fixtures behind the axios client (the contract in FC-3/FC-4 is the seam).
Already-built and reused: server scenario clock, media pipeline and watermark bands, social `PostCard`, composer, telemetry emitter, participant shell (D7).

## Design notes
- **Two worlds.** Articles, outlet pages and skins are participant-world and per-outlet skinned inside `OutletSkinScope`; they never import COBRA and never look like default MUI. The editor (17) and templates (18) are staff-world COBRA and show participant rendering only through preview-as-participant (COR-041).
- **One system, four token files (D3-P1).** The invariant nine-slot anatomy lives in code (04); identities live in data (10–13). The Scoop's clutter (14) is the only sanctioned busy design and is double-guarded (server, render).
- **Nothing breaks fiction.** The outlet says BREAKING, the outlet issues the correction; the platform adds no badge, no "Updated" marker of its own beyond the authorial stamp the data carries, and no view counts (NWS-030).
- **Scenario time only (COR-053).** Every datetime is a server `scenarioTime` through `ScenarioDateline`; The National Wire's timestamp-first style is a format, never a source.
- **Mobile-first.** Shared links open on phones: single column, ≥ 16px body, rail folds below, 44px targets.
- **Burst legibility.** Home/section lists coalesce new stories (≤ 1 announcement per 5 s) and never shift under the reader (NFR-002).
- **Watermark.** Hero chip bottom-right reserved from day one (05, foundation 14); skin-proof.

### NewsNow (PDF-05) interaction
`post-demo-feedback` PDF-05 ("NewsNow ... embedding is preferred", triaged **Won't (confirm demand)**) concerns *embedding* Looking Glass's NewsNow, a different thing from E4. E4 is the native
replacement: its Newsline 7 skin and the `/news/{outlet}/{slug}` permalink pattern already deliver the NewsNow experience (E4 epic: "Looking Glass parity target: NewsNow"). Interaction: **none in the build**; if demand for embedding
returns, the feature note there ("`D3-news-outlets` is an approved design ... relevant if PDF-05 returns") holds, and E4's skins would be the native alternative. **Done (Tom, 10/29):** PDF-05 is marked superseded by E4 in post-demo-feedback and #528 is closed.

## Out of scope (parked)
Comments (never, NWS-031); paywall/subscription theater (epic Q2: never); participant-authored articles (epic §4: via E5); standalone video platform; Beat asset picker via E9 (Phase 4, upload only now);
E8 article drafting beyond accepting `origin: engine` drafts; related-articles / most-read / personalization (would need reader-visible telemetry); Cadence-pushed articles (foundation Cadence seam, E9); per-skin final homepage art (full-mockup deliverable);
server-side watermark burn-in (PDF-09); offline cache (PDF-02); the cross-outlet top-stories page (E3).

## Open questions for Tom
See the hand-off report; defaults assumed above and in `implementation.md` § Open questions.
