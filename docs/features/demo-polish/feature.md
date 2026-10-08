# Feature: Demo polish (participant-first demo)

**Epic:** E1 Platform Core & Isolation · E2 Social Network · E7 Controller Command Surface (sliced)  ·  **Phase:** 1  ·  **Feature ref:** cross-feature demo slice (no single `F{n}.{m}`)
**World:** both — participant (F-stories) and staff (C-stories, PE)  ·  **Issue:** #419

## Summary
A time-boxed push (**ready Mon 2026-10-19, demo Tue 2026-10-20**) that makes the participant social app look and
behave like a finished X-class product — real photos and **inline video from Azure Blob**, real avatars,
persisted likes/reposts/replies, an X-style three-column frame with working URLs — and lets controllers drive
that feed from the console (post-as-persona with media and replies, a Live world column, a one-click Run sheet,
persona profile edit). It is the vehicle for the demo storyline v2 in
[`docs/demo/PARTICIPANT-FIRST-DEMO-PLAN.md`](../../demo/PARTICIPANT-FIRST-DEMO-PLAN.md) §3; the plan is the
source of truth for scope and calendar, [`implementation.md`](implementation.md) is the source of truth for the
frozen wire contract and file ownership.

This is a **demo slice, not a new capability**. Each story slices an existing backlog story (its "Home story");
when the push is done the home story's own Status is *not* flipped by this feature — only the slice is. The
engine (E8) stays available but is out of this push's scope.

## Requirements covered
Slices of, not completions of: **SOC-001, 002, 003, 005, 010, 011, 012, 020 (repost toggle only), 030, 040,
041/042 (client-side), 050, 052, 053, 070 (derived, Could), 080–083**; **CTL-001, 003, 025 (takedown slice),
030/031 (Live world), 010/011/013 (Run sheet, browser-side)**; **COR-001, 002, 007, 018, 020–022 (profile edit),
024 (avatar/banner media), 053**; **XC-001, 002, 004, 009, 010**; **NFR-001, 004 (partial), 008 (video watermark
slot), 009 (upload only)**.

## Design references
- `docs/design/D1-social-app/README.md` (+ `DECISIONS.md`): D1-005 (buffered pill), D1-006 (flattened thread),
  D1-009 (tombstones in threads only), D1-011 (controls absent, not disabled), D1-013 (frame `240 | 600 | 344`),
  D1-R5 (ring counter), SOC-052/D1-008 (no archetype tell, verified seal fixed `#2D9CDB`).
- `docs/design/D5-controller-console/STORY-UPDATES.md`: reviewed — no AMEND/ADD/RECONCILE item changes these
  stories. D5-016/D5-017 (continuous-watch surfaces get permanent space, not a flyout) shape C2/C4; CTL-033
  ("absent, not disabled") shapes C5. Nothing to tick.
- `docs/design/D0-FOUNDATIONS.md` §2 (two worlds) and §4 (seven non-negotiables) apply to every UI story.

## Stories
Order = wave order. Priorities and effort are the plan's (§5). *Home story* is in each file's header.

| # | Story | ID | Pri | Stack | Wave | Requirement(s) | Status | Issue |
|---|-------|----|-----|-------|------|----------------|--------|-------|
| 01 | [Keyless Blob storage for media](01-blob-storage-keyless.md) | I1 | Must | infra | 1 | XC-009, COR-002, NFR-004 | In Review | #420 |
| 02 | [Schema: media, replies, reactions, avatars (one migration)](02-schema-media-replies-reactions.md) | B1 | Must | backend | 1 | SOC-001, SOC-010, SOC-030, COR-001, COR-020, XC-010 | In Review | #421 |
| 03 | [Client seam: PostCard split, contract v2, mocks, upload client](03-client-seam-contract-v2.md) | F0 | Must | frontend | 1 | SOC-001, SOC-002, XC-002, XC-009, COR-053 | In Progress | #422 |
| 04 | [Role-scoped realtime groups](04-role-scoped-realtime-groups.md) | B5 | Should | backend | 1 | XC-002, SOC-052, COR-001 | In Review | #423 |
| 05 | [Media pipeline: upload, store, SAS, library](05-media-pipeline.md) | BM | Must | backend | 1b | SOC-001, XC-009, COR-002, NFR-004, NFR-009 | In Progress | #424 |
| 06 | [Post v2 read/write](06-post-v2-read-write.md) | BP | Must | backend | 1b | SOC-001, SOC-002, SOC-054, XC-002, COR-024 | In Progress | #425 |
| 07 | [Replies and real threads](07-replies-and-threads.md) | B2 | Must | backend | 1b | SOC-010, SOC-011, SOC-012, SOC-005 | In Progress | #426 |
| 08 | [Reactions (like, repost) and engagement reader](08-reactions.md) | B3 | Must | backend | 1b | SOC-030, SOC-020, XC-004 | In Progress | #427 |
| 09 | [Controller takedown (soft delete + PostRemoved)](09-controller-takedown.md) | B6 | Should | backend | 1b | CTL-025, XC-010 | In Progress | #428 |
| 10 | [App frame and navigation](10-app-frame-navigation.md) | F1 | Must | frontend | 2 | SOC-083, COR-004, NFR-001 | Not Started | #429 |
| 11 | [Media display: grid, video player, viewer](11-media-display.md) | F2 | Must | frontend | 2 | SOC-001, XC-009, NFR-001, NFR-008 | Not Started | #430 |
| 12 | [Engagement: persisted likes and reposts](12-engagement.md) | F3 | Must | frontend | 2 | SOC-030, SOC-020, SOC-021 | Not Started | #431 |
| 13 | [Threads and composer: replies, attach, instant post](13-threads-composer.md) | F4 | Must | frontend | 2 | SOC-001, SOC-010, SOC-011, SOC-012 | Not Started | #432 |
| 14 | [Brand and profile finish](14-brand-profile-finish.md) | F5 | Must | frontend | 2 | SOC-050, SOC-002, COR-030, NFR-001 | Not Started | #433 |
| 15 | [Explore: trending, search, hashtag polish](15-explore.md) | F6 | Should | frontend | 2 | SOC-040, SOC-041, SOC-082 | Not Started | #434 |
| 16 | [Notifications, derived client-side](16-notifications-lite.md) | F7 | Could | frontend | 3 | SOC-070 | Not Started | #435 |
| 17 | [Post as persona v2](17-post-as-persona-v2.md) | C1 | Must | frontend | 3 | CTL-001, CTL-003, SOC-012 | Not Started | #436 |
| 18 | [Live world column](18-live-world-column.md) | C2 | Must | frontend | 3 | CTL-030, CTL-031 | Not Started | #437 |
| 19 | [Run sheet](19-run-sheet.md) | C3 | Must | frontend | 3 | CTL-010, CTL-011, CTL-013 | Not Started | #438 |
| 20 | [Console cleanup](20-console-cleanup.md) | C4 | Must | frontend | 3 | CTL-002, CTL-003 | In Progress | #439 |
| 21 | [Persona profile edit](21-persona-profile-edit.md) | PE | Should | fullstack | 2 (BE) / 3 (FE) | COR-020, COR-022, COR-024 | Not Started | #440 |
| 22 | [Takedown UI and live feed removal](22-takedown-ui.md) | C5 | Should | frontend | 3 | CTL-025, XC-010 | Not Started | #441 |
| 23 | [Preview-as-participant and StartEx/EndEx](23-preview-and-startex.md) | C6 | Could | frontend | 3 | COR-041, COR-054 | Not Started | #442 |
| 24 | [Seed script](24-seed-script.md) | S1 | Must | script | seed | CTL-001, COR-023 | Not Started | #443 |
| 25 | [Content pack authoring](25-content-pack-authoring.md) | S2 | Must | content | seed | COR-023, XC-009 | Not Started | #444 |

Wave-0 prep items P1 (CI flake fix) and P3 (Tom picks stock clips) are in the plan, not stories here. P2 is this
folder.

## Dependencies
- **Foundation that already exists** (do not rebuild): exercise isolation (E1), sessions/identity, XC-004
  telemetry, the AI engine, SignalR hub, follow graph, tiered pause, the staff shell and console.
- **Serial edges**: B1 merges before every Wave-1b story; F0 merges before every Wave-2/3 frontend story; I1
  deployed (🧑) before the UAT media smoke test; C1 before C3 (library picker); BM+BP+B2 live before the F2/F4/C1
  live checks; backend freeze Thu 10/15.
- **Calendar and cut lines**: plan §7 (Cut line 1 = BM not live by Sat 10/10; Cut line 2 = cut F6 search and F7
  on Mon 10/12; Cut line 3 = unmerged backend after 10/15 is out). Plan B for video: plan §7.

## Design notes
- **Two worlds, and the one place they touch.** F-stories are the *participant world*: per-brand skin via CSS
  Modules + `--pulse-*` tokens, **no COBRA, no default MUI look**, FontAwesome only, mobile must not break but
  is not the target (desktop-first, plan decision 5). C-stories and PE are the *staff world*: COBRA
  (`@/theme/styledComponents`), dense, keyboard-first. The **Live world column (C2)** and the **composer preview
  (C1)** show participant *content* inside staff *chrome*; they must carry unmistakable staff framing (labelled
  panel, monospaced meta, no `PostCard`) so they can never be confused with a participant view. C6's preview
  mounts the real participant channel inside a labelled staff frame under the shell `preview` variant.
- **Exercise isolation is always Critical.** Every new read/write is scoped by `PulseDbContext`'s central
  filter; no request carries an `exerciseId`; a cross-exercise id (post, parent, media, persona, reaction
  target) is indistinguishable from an unknown id. A SAS is minted only for media already resolved inside the
  caller's scope (DP-11 documents the one residual: a leaked SAS is readable until expiry).
- **Provenance is never participant-visible (XC-002).** `origin`, `actingHumanId`, `uploadedByHumanId`,
  baselines, wall-clock, `personaType` stay off every participant payload. New fields (`media`, `inReplyTo`,
  `viewer`, `avatarUrl`, `bannerUrl`, `location`) are participant-safe by construction.
- **Scenario time only (COR-053)** on participant surfaces: relative and absolute post times, profile "joined",
  the video duration badge is a media length (not a clock). Staff may see wall-clock beside it. No participant
  story calls `new Date()`/`Date.now()` (lint-banned there).
- **Accessibility (NFR-001).** Alt text required for every image *and video* (composer will not enable Post
  without it); state (liked, reposted, removed, upload status, severity) is never color-only; the video player
  is keyboard-operable; real-time lists use polite live regions; modals trap and return focus.
- **Watermark (NFR-008).** The video player reserves the "EXERCISE" watermark slot and renders it when
  `isWatermarkRequired(chromeConfig)`.
- **Telemetry (XC-004).** Server emits `post`/`reply`/`reaction`/`repost`; the console emits `steering_action`
  for takedown and persona edit; live-mode frontends never double-emit (implementation.md §1.8).
- **Prototype-grade DoD (plan §8):** ACs met + risk-class tests (isolation, upload magic-byte validation, SAS
  scope/expiry, scenario time first) + CI green + **no Critical/High at Gate 1**. Mediums/Lows become follow-up
  issues. "Verified in UAT" is satisfied in bulk by the 10/16 walk.

## Cut from this push (post-demo backlog)
From the plan (§5): live AI / §8 sign-off · engine verification debt (except Freeze) · ambient chatter ·
direct-to-Blob upload for large files · server-side transcoding and thumbnails · Defender malware scanning · DMs
· full notifications · PIO column mode · the timed inject queue and scheduler (PAUSE INJECTS stays hidden) ·
participant admin UI · persona create/delete and **handle** edits · the "X reposted" fan-out · quote posts ·
mobile bottom tab bar · E3–E6 channels · E10 evaluation.

Also cut by P2 so nothing is built by accident (each is a recorded gap, not an oversight):
- Server-persisted **link previews** (the feed never sends `linkPreview`; F2's link-card image is mock-verified
  only).
- Video **captions/WebVTT** (DP-12) and a poster-less-Safari mitigation beyond `preload="metadata"` + `#t=0.1`.
- **NFR-009** rate limits on `POST /api/posts` and reactions (only `POST /api/media` is limited this push).
- Takedown **Director notification** and a stored incident-category column (category rides in telemetry only,
  DP-9).
- Controller reactions (DP-10); participant self-delete (SOC-005 participant half); reply threading beyond a
  flattened direct-reply view.
- Persisted/server-side run sheet, scheduling, and Cadence-sourced items (the sheet is browser storage + JSON).
- Server-side search/trending (everything is computed client-side over the loaded newest-200 feed).
- Dark mode (forced light for the demo, F5).
