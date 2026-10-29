# Feature: Channels foundation (shared by E3 Portal, E4 News, E5 Press Room, E6 Weather)

**Epic:** E3/E4/E5/E6 shared foundation (hosted under E1 — Platform Core)  ·  **Phase:** 3, pulled forward — **December release (Tom, 10/21)**  ·  **Feature ref:** cross-cutting
**World:** both (participant read surfaces + staff authoring seam)  ·  **Issue:** — (no GitHub issues created in this pass)

## Summary
The one content pipeline every non-social channel builds on. E4 articles, E5 releases and E6 weather products are the same kind of thing: an
exercise-scoped, outlet-branded, scenario-timestamped item with a draft / scheduled / published / retracted lifecycle, a permalink, media,
sanitization, telemetry, a live push and an inject-queue hook. This feature builds that pipeline **once**, plus the shared pieces around it: the
outlet/brand registry and skin mechanism, the cross-channel alert source behind the shell's alert bar, the participant channel router with
per-exercise channel enablement, and the staff authoring/publish seam. E4/E5/E6/E3 stories then stay channel-specific (article layout, PDF
composer, warning formatting, portal modules) and import contracts by name from
[`implementation.md` § Frozen contracts](implementation.md#frozen-contracts).

## Why this is its own feature
Four channel epics, decomposed in parallel, would each reinvent: a content table, a publish funnel, a scheduler, permalinks, a realtime event, an
alert source, outlet skinning and a route gate. Any two diverging breaks the cross-channel promises (a warning lights the alert bar *and* the post
*and* the widget with one headline; a link card works for any channel; a disabled channel is unreachable everywhere).

## Requirements covered (cross-channel slices only; channel-specific parts stay with E3–E6)
- **Content model and lifecycle:** NWS-010 (model fields), NWS-011 (permalink), NWS-013 (publish now / schedule / hold; corrections as revisions),
  PRS-003 (embargo invisible to the public), PRS-005 (revisions preserved), WX-010 (product as content), PRT-031 (background-vs-scenario tag).
- **Outlets/brands:** NWS-001/002 (outlet = brand + skin tokens), PRS-010/012 (wire + org newsrooms as outlets), WX-001/020 (Weather Desk brand +
  paired handle), COR-030/066 (per-exercise brand), D3-P1/P2.
- **Alerts:** PRT-010/011/012 data side (WX-011, NWS-012 flash, CTL-021 raise path), SOC-072 pilot bridge.
- **Routing/enablement:** PRT-003 (disabled channels hide cleanly), PRT-020 (nav to mounted channels), PRT-001 (landing); closes exercise-configuration
  open question (c) "channel-enablement route gating is unowned".
- **Publish seams:** NWS-013/WX-012 (inject queue), PRS-013/NWS-004/WX-020 (paired social post), PRS-022/E8 (published-event observers),
  NWS-015/PRS-011 (link previews, SOC-004).
- **Cross-cutting:** XC-001/002/004/008/010, COR-053, NFR-001 (+ PDF-12 #680), NFR-004, NFR-008, COR-008 (+ PDF-11 #679).

## Design references
`docs/design/D0-FOUNDATIONS.md`, `D2-portal.md`, `D3-news-outlets.md` (+ `D3-news-outlets/STORY-UPDATES.md`, decisions D3-P1…P4), `D4-press-weather.md`
(+ `D4-press-weather/STORY-UPDATES.md`, D4-001…013), `D7-application-shells/SHELL-CONTRACT.md` (shell owns chrome, alert bar host, nav, overlays; channels
own the content region), `DECISIONS.md`. Applied here: **D3-P1/P2** (one rendering system; token surface CAN/CANNOT), **D4-010** (one multi-alert bar,
same headline string everywhere, warning forces the emergency band), **D4-012 / D2-008** (EXERCISE chip bottom-right), **D7-001/002/005**.
The D3/D4 STORY-UPDATES checklists stay open: each item is ticked by the channel feature that implements it, not by this foundation, except where a
story below says so.

## Stories
| # | Story | Requirement(s) | Stack | Wave | Effort | Status | Issue |
|---|-------|----------------|-------|------|--------|--------|-------|
| 01 | [Content, outlet and alert data model + migration](01-content-outlet-alert-data-model.md) | NWS-010/013, PRS-005, PRT-031, XC-001/010 | backend | 1 | L | Not Started | — |
| 02 | [Frozen wire contracts, client types and mock fixtures](02-frozen-wire-contracts.md) | NWS-010/011, PRT-011, XC-002 | fullstack | 1 | M | Not Started | — |
| 03 | [Outlet registry and defaults](03-outlet-registry.md) | NWS-001/002, PRS-010/012, WX-001/020, COR-066 | backend | 2 | M | Not Started | — |
| 04 | [Content publish funnel and lifecycle](04-content-publish-funnel.md) | NWS-013, PRS-005/022, XC-004/010, NFR-004, COR-053 | backend | 2 | L | Not Started | — |
| 05 | [Scheduler: embargo, scheduled publish, time jumps](05-scheduled-publish-runner.md) | NWS-013, PRS-003 | backend | 3 | M | Not Started | — |
| 06 | [Participant content read API, permalinks, link resolver](06-participant-content-read-api.md) | NWS-011/015, PRS-011, XC-001/002 | backend | 3 | M | Not Started | — |
| 07 | [Staff content write API](07-staff-content-api.md) | NWS-020/022, PRS-020, WX-012, XC-006 | backend | 3 | M | Not Started | — |
| 08 | [Channel enablement gate (server + client)](08-channel-enablement-gate.md) | PRT-003/020, XC-001 | fullstack | 2 | M | Not Started | — |
| 09 | [Realtime fan-out for channel content](09-realtime-content-fanout.md) | PRT-006, XC-001, NFR-002 | fullstack | 2 | M | Not Started | — |
| 10 | [Alert source: raise, clear, history (backend)](10-alert-source-backend.md) | PRT-010/011/012, WX-011, NWS-012, SOC-072 | backend | 2 | M | Not Started | — |
| 11 | [Alert bar live wiring (frontend)](11-alert-bar-live-wiring.md) | PRT-010/011/012, D4-010 | frontend | 3 | S | Not Started | — |
| 12 | [Participant channel router and landing](12-participant-channel-router.md) | PRT-001/020, COR-060/061, XC-002 | frontend | 3 | M | Not Started | — |
| 13 | [Outlet skin system (token files, scope provider, external registration)](13-outlet-skin-system.md) | NWS-002, COR-066, D3-P1/P2 | frontend | 2 | L | Not Started | — |
| 14 | [Shared content primitives](14-shared-content-primitives.md) | COR-053, NFR-001/004/008 | frontend | 2 | M | Not Started | — |
| 15 | [Content data hooks and reader telemetry](15-content-data-hooks-and-telemetry.md) | NWS-030, WX-022, XC-004, PRT-006 | frontend | 4 | M | Not Started | — |
| 16 | [Inject-queue integration: content injects](16-content-injects.md) | NWS-013, WX-012, CTL-010/011 | backend | 4 | M | Not Started | — |
| 17 | [Staff authoring and publish seam (console)](17-staff-authoring-seam.md) | NWS-020, PRS-020, WX-012, COR-041 | frontend | 4 | L | Not Started | — |
| 18 | [Paired social auto-post with link card](18-paired-social-post.md) | NWS-004, PRS-013, WX-011/020, SOC-004 | backend | 4 | M | Not Started | — |
| 19 | [Host-relative URLs and subdomain readiness](19-subdomain-readiness.md) | COR-008, PDF-11 (#679) | fullstack | 4 | S | Not Started | — |
| 20 | [Channel conformance kit (isolation, XSS, a11y/508, migration ledger)](20-channel-conformance-kit.md) | XC-001, NFR-001/004, PDF-12 (#680) | testing | 5 | M | Not Started | — |
| 21 | [Social prerequisites for channel consumers (R-S1, compose-with-link)](21-social-prerequisites.md) | PRT-005, NWS-015, SOC-004, COR-015 | frontend | 1 | M | Not Started | — |

Totals: **21 stories** — 4 L (01, 04, 13, 17), 15 M, 2 S (11, 19). Story 21 was added by the December consolidation pass; stories 01–04, 05–07, 09, 11–18 and 20 were amended in it (see [`implementation.md` § Follow-up resolution ledger](implementation.md#follow-up-resolution-ledger)).

## Dependencies
**Platform prerequisites** (owned by other features, scheduled by the orchestrator; see [`implementation.md` § Platform prerequisites](implementation.md#platform-prerequisites)): PP-1 a `display` session purpose/actor kind (identity-auth-roles + telemetry) for the portal kiosk; PP-2 participant-shell/06 kiosk chrome + watermark clause; PP-3 host CSP/headers; PP-4 per-display realtime (parked); PP-5 identity grants / "Posting as" chip (press, not required).
**Migrations** follow one serialized ledger (M1 F01 → M2 portal 01 → M3 weather 02 → M4 F16 → M5 press 06), see [`implementation.md` § Migration ledger](implementation.md#migration-ledger). The cross-feature index, combined waves, cut order and the single open-question list are in [`../DECEMBER-RELEASE.md`](../DECEMBER-RELEASE.md).

Already built and merged: exercise isolation (`IExerciseScoped`, `PulseDbContext` central filter, host resolution), participant shell (chrome, alert bar
host + history component, nav, overlays, brand hooks), the server scenario clock (`GET /api/clock`, `ScenarioClockChanged`, PR #678), the media pipeline and
watermark bands (demo-feedback 06), the SignalR hub and `IFeedBroadcaster`, the inject queue + `InjectBurstRunner`, `PostIngestService`, telemetry (`XC-004`
v0 + sink), `ParticipantShellConfigService` (`ChannelCatalog`, `Exercise.EnabledChannels`). **Nothing in E3–E6 is a prerequisite.**

## Design notes
- **Two worlds.** Participant read surfaces are brand-skinned (per outlet, per route subtree) and never carry COBRA or a default MUI look; the staff
  authoring seam (story 17) is COBRA and lives in the controller console. Preview-as-participant renders the participant subtree inside the staff
  frame (COR-041); it never restyles it.
- **Nothing breaks fiction.** No platform-added BREAKING / "exercise" / "sponsored" chrome inside a channel; compliance chrome and the alert bar are
  shell-owned; participant DTOs never carry origin, acting human, wall clock, draft state or the background tag (XC-002).
- **Scenario time only (COR-053).** Every participant-visible instant is a server-stamped `scenarioTime` string rendered through the shared formatter.
  Wall clock exists only in staff DTOs and telemetry.
- **The server is the clock.** Publish and schedule stamp from `IExerciseClock` (the FollowService / InjectQueue pattern), never from the browser (PR #678).
- **Seam for Cadence (PDF-06, #529).** `ContentItem.ExternalSource` + `ExternalRef` (nullable, unique per exercise per source) are reserved in story 01 so a
  later Cadence push (inject + clock, E9 / Phase 4) is idempotent. No integration endpoint is built here.

## Out of scope (parked)
Channel-specific rendering and authoring (E3–E6 features); the weather timeline engine (WX-002); kiosk mode (PRT-040/041); the PRS-021 approval gate; E8
drafting of articles beyond accepting `origin: engine` drafts (NWS-022); server-side watermark burn-in (PDF-09); offline cache (PDF-02); the Cadence
integration endpoint (PDF-06 / E9).
