# Feature: Exercise Portal ("[City] Today") and TTX display mode

**Epic:** E3 — Exercise Portal  ·  **Phase:** 3, pulled forward — **December release (Tom, 10/21)**  ·  **Feature ref:** F3.1 + F3.2 + F3.3 + F3.4 + F3.5 (one feature: the portal is one aggregator surface plus its kiosk mode)
**World:** participant (portal, resources shelf, kiosk-lite display) + staff (portal setup, Top Stories board; display control is Deferred)  ·  **Issue:** #696 (Epic #688)

## Summary
The participant's front door: a branded, per-exercise local-news-portal homepage that **aggregates** what the other channels already publish (Top Stories from News, a live social excerpt and trending from Social,
the latest releases from the Wire Room, the Weather Desk tile) under one masthead with a scenario-time dateline, hosts the shell's persistent alert bar, and visibly changes mood when an emergency alert is
active. It also owns **kiosk / big-screen display mode** for tabletop exercises (the "display content on a screen in a basement" scenario). **December ships kiosk-lite only (Q-35, Tom 10/29):** the facilitator signs a browser in with the existing shared view-only login and opens `/portal?display=1`; the screen shows the portal live in the shell's kiosk variant. The full design — a login-free per-display credential, a screen that renders a feed or one specific article / post / warning, a playlist, and "show this next" from the console — is **Deferred (post-December)**. The portal is **not a content channel** (foundation Q7): it owns no `ContentItem`s;
evergreen filler is `news` content tagged `background`. Everything generic is the [channels foundation](../channels-foundation/feature.md) and is referenced by `FC-n` / `F##`, never redefined.

## Requirements covered
| Group | IDs | Where |
|---|---|---|
| F3.1 Landing and aggregation | PRT-001 (landing: F12; E3 supplies the surface), PRT-002, PRT-003, PRT-004 (composition; pin API is F07), PRT-005, PRT-006 | 03, 06, 07, 09, 10, 11, 12, 17 |
| F3.2 Alert bar | PRT-010, PRT-011 (placement and mood only; bar, severities and source are shell + F10/F11), PRT-012 (entry point; history page is F11) | 13, 14 |
| F3.3 Navigation shell | PRT-020 (discoverability links; the nav itself is shell + F12), PRT-021 (verified, shell-owned), PRT-022 | 04, 07, 15, 16, 17 |
| F3.4 TTX display mode | PRT-040, PRT-041 (Master decision 10) — **kiosk-lite subset in December**; the credential, remote control and playlist are Deferred | 18, 19 (05, 08, 20 Deferred) |
| F3.5 World texture | PRT-030, PRT-031 (tag and authoring are F01/F07/F17; E3 supplies the starter pack and the Staged-state experience) | 09, 21 |
| Absorbed capability | RIP Alerts (Master §2: absorbed into Portal + Social notifications) | 13, 14, 23 (alert source F10, SOC-072 bridge F10) |
| Cross-cutting | XC-001/002/004/008/010, COR-053, NFR-001 (+ PDF-12 #680, Section 508), NFR-002 (burst), NFR-004, NFR-008, COR-008 (+ PDF-11 #679), COR-031, COR-052 (pairing only) | per-story ACs; proven in 23 |

Requirements owned by the foundation or the shell, **not re-implemented here**: PRT-001's routing decision (F12), PRT-004's `featuredRank` storage, `feature` action and ordered read (F01/F06/F07), PRT-010/011's bar,
severity styling and ticker (participant-shell/02, D7-002) and the alert source (F10/F11), PRT-012's history page and API (F11), PRT-020's nav strip (participant-shell/03 + F08/F12), PRT-021's chrome
(participant-shell/01), PRT-031's `Background` tag and its authoring control (F01, F17), channel enablement (F08).

## Design references
`docs/design/D2-portal.md`, `docs/design/DECISIONS.md` `## D2` (**D2-001..008**), `docs/design/D0-FOUNDATIONS.md` (two worlds, burst legibility, watermark readiness, a11y),
`docs/design/D7-application-shells/SHELL-CONTRACT.md` (the shell owns chrome, the single alert bar, nav and overlays; the portal owns the content region only), `docs/design/D3-news-outlets.md`
(portal vs outlet identity, D3-P1 skin mechanism). **No `STORY-UPDATES.md` exists for D2**, so no AMEND/ADD list applies; the D2 brief's own "open / deferred" items are handled below.
Applied: **D2-001** (aggregator identity, outlet source chips), **D2-004** (world state shifts the page; see conflict C-2), **D2-005** (a disabled channel hides module and link together), **D2-006**
(Pulse rail uses the social brand scope), **D2-007** (Resources shelf drops the news costume), **D2-008** (watermark slot).
D2 deferred items picked up here: alerts-history stub (the history page is F11; E3 adds the entry), kiosk-lite (stories 18-19; 05/08/20 Deferred), **mobile pass** (every participant story carries a mobile AC; no mockup exists, see Q-E3-6).
Parked: D2-002 visual directions (digital / print) and D2-003 layouts (band / grid): December ships **broadcast + anchor** only.

## Stories
| # | Story | Requirement(s) | Stack | E3 wave | Effort | Foundation / channel deps | Status | Issue |
|---|-------|----------------|-------|---------|--------|---------------------------|--------|-------|
| 01 | [Portal data model: limits guard + isolation tests (schema in F01's M1)](01-portal-data-model.md) | PRT-002/003/022 (data), XC-001/010 | backend | 1 | S | F01 (M1) | Not Started | #767 |
| 02 | [Portal wire contracts, fixtures, guards](02-portal-wire-contracts.md) | PRT-002/003/022, XC-002 | fullstack | 1 | M | F02 | Not Started | #768 |
| 03 | [Portal config API (masthead, modules)](03-portal-config-api.md) | PRT-002, PRT-003, COR-030/066 | backend | 2 | M | F03, F08 | Not Started | #769 |
| 04 | [Resources API](04-resources-api.md) | PRT-022, NFR-004, XC-010 | backend | 2 | M | F04, F08 | Not Started | #770 |
| 05 | [Display sessions: kiosk link and read-only session](05-display-sessions.md) — **Deferred (post-December, Q-35)** | PRT-040, PRT-041, NFR-009, XC-004 | backend | — | (L) | F08, PP-1 | Deferred (post-December) | — (no issue) |
| 06 | [Portal skin, masthead and dateline](06-portal-skin-masthead.md) | PRT-002, COR-053, NFR-008 | frontend | 2 | M | F13, F14 | Not Started | #771 |
| 07 | [Module frame, layout and clean hiding](07-module-frame-layout.md) | PRT-003, PRT-020, D2-005 | frontend | 2 | M | F08, F14 | Not Started | #772 |
| 08 | [Display state and remote-control API](08-display-state-control-api.md) — **Deferred (post-December, Q-35)** | PRT-040, XC-004 | backend | — | (M) | F06 | Deferred (post-December) | — (no issue) |
| 09 | [Top Stories module](09-top-stories-module.md) | PRT-004, PRT-006, PRT-030/031 (consumes) | frontend | 3 | L | F06, F09, F13, F14, F15 | Not Started | #773 |
| 10 | [Social Stream and Trending modules](10-social-stream-trending.md) | PRT-005, PRT-003, NFR-002 | frontend | 3 | L | F21, F15 | Not Started | #774 |
| 11 | [Press Room latest module](11-press-latest-module.md) | PRT-003, PRT-006 | frontend | 3 | S | F06, F15, press 01 | Not Started | #775 |
| 12 | [Weather widget mount](12-weather-widget-mount.md) | PRT-003, WX-021 (consumer) | frontend | 3 | S | weather 10 | Not Started | #776 |
| 13 | [World-state shift and alert placement](13-world-state-alert-placement.md) | PRT-010, PRT-011, D2-004 | frontend | 3 | M | F11 | Not Started | #777 |
| 14 | [Alerts entry and RIP Alerts absorption](14-alerts-entry-absorption.md) | PRT-012, PRT-010, SOC-072 | frontend | 3 | S | F10, F11 | Not Started | #778 |
| 15 | [Resources shelf](15-resources-shelf.md) | PRT-022, NFR-004 | frontend | 3 | M | F14 | Not Started | #779 |
| 16 | [Console: portal setup](16-console-portal-setup.md) | PRT-002, PRT-003, PRT-022 | frontend (staff) | 3 | L | F17 | Not Started | #780 |
| 17 | [Portal mount, landing and telemetry](17-portal-mount-landing.md) | PRT-001, PRT-006, PRT-020/021, XC-004 | frontend | 4 | L | F12 | Not Started | #781 |
| 18 | [Kiosk-lite: `/portal?display=1` and the kiosk frame](18-kiosk-route-frame.md) | PRT-040 (lite), PRT-041, NFR-008 | frontend | 4 | M | PP-2 (shell 06 AC2) | Not Started | #782 |
| 19 | [Kiosk-lite portal board](19-kiosk-slides-player.md) | PRT-040 (lite), NFR-002 | frontend | 4 | M | F15 | Not Started | #783 |
| 20 | [Console: display control](20-console-display-control.md) — **Deferred (post-December, Q-35)** | PRT-040, COR-052 (pairing) | frontend (staff) | — | (L) | F07, F17 | Deferred (post-December) | — (no issue) |
| 21 | [Evergreen filler starter pack](21-evergreen-filler-pack.md) | PRT-030, PRT-031 | backend | 4 | M | F04, F05, F07 | Not Started | #784 |
| 22 | [Console: Top Stories board](22-console-top-stories-board.md) | PRT-004 | frontend (staff) | 4 | S | F07 | Not Started | #785 |
| 23 | [Portal conformance](23-portal-conformance.md) | XC-001, NFR-001 (#680), NFR-002/008, COR-053 | testing | 5 | M | F20 | Not Started | #786 |

Totals: **20 in-scope stories** — 4 L (09, 10, 16, 17), 11 M (02, 03, 04, 06, 07, 13, 15, 18, 19, 21, 23), 5 S (01, 11, 12, 14, 22); **3 Deferred (post-December: 05, 08, 20)** — ≈ 31.5 sittings (was 23 stories / 8 L / 11 M / 4 S / ≈ 40.5: 05, 08, 20 deferred; 18 and 19 L → M; 01 M → S). Stack mix: 4 backend (01, 03, 04, 21), 1 fullstack (02), 2 staff-world (16, 22), 1 testing (23), the rest participant frontend. `F##` = channels-foundation story number; `R-x` = a request to a channel (see
[`implementation.md`](implementation.md)).

## Dependencies
**Channels foundation** (the portal composes it; nothing in E3 is a prerequisite for the foundation). E3 frontend work starts when foundation **Wave 2** is merged (F02 contracts, F08 gate, F13 skin, F14
primitives) and runs on `features/channels/mocks/` plus E3's own fixtures behind the axios client until the real routes land. **Channel features** the portal aggregates, each with a mock fallback so E3 is never
blocked: E4 News (the content list is F06; no E4 story is required), E5 Press (story 01 for `release` summaries), E6 Weather (**story 10 is a hard import** for story 12), E2 Social (R-S1 → foundation story 21).
**Platform prerequisites** (owned elsewhere, scheduled by the orchestrator; see the foundation's [§ Platform prerequisites](../channels-foundation/implementation.md#platform-prerequisites)): PP-1 a `display` session purpose/actor kind (**Deferred post-December: kiosk-lite needs no identity change**, verified against `SharedReadOnlyLoginService`), PP-2 the shell's kiosk chrome + watermark clause (participant-shell/06 AC2) — **the one kiosk prerequisite that remains**, PP-3's `/display/*` headers (Deferred), PP-4 per-display realtime (parked), exercise-clock/03 module advancement (COR-052, Not Started)
pairs with the kiosk but is **not required**: a clock jump already publishes scheduled content and the portal updates.
Already built and reused: participant shell (chrome, single alert bar, nav, overlays, `kiosk` variant flag), server scenario clock, media pipeline and watermark bands, social `PostCard` / feed / trending,
the shared read-only login (kiosk-lite's entry), `ParticipantShellConfigService` and `ChannelCatalog` (`portal` is catalogued, default off), SignalR hub, telemetry v0.

## Design notes
- **Two worlds.** The portal, the resources shelf and the kiosk are participant world: the portal's own aggregator skin (`OutletSkinScope`-style scope, story 06), never the COBRA theme, never a default MUI look,
  and visibly distinct from both the Pulse social app and every outlet (D2-001; the "print" direction is parked because it collides with the Courier-Ledger skin). The three console surfaces (16, 20, 22) are
  COBRA, dense, keyboard-first, and show participant rendering only through preview-as-participant (COR-041).
- **The portal aggregates; it does not publish.** No story writes a `ContentItem`; the one exception is the **starter pack** (21), which goes through `IContentPublishService`. Portal DTOs carry only
  portal-owned config; all aggregated content arrives through the foundation's participant read API with its XC-002 projection.
- **One alert bar.** The shell hosts exactly one (D7). The portal places nothing over it, never renders a second, and expresses an emergency only through mood and the content the controllers publish (13).
- **Scenario time only (COR-053).** The dateline, every card timestamp and the kiosk clock are server `scenarioTime` through `ScenarioDateline` / `formatScenarioTime`. The single sanctioned exception is
  authored text inside the Resources shelf (D2-007), which is out of fiction and not platform-rendered time.
- **Isolation (XC-001).** No portal route accepts an exercise id. Kiosk-lite is the existing **shared view-only login for one exercise**: the code is checked against the host-resolved exercise's credential and yields a read-only session scoped by host resolution like any session. (The per-display bearer link with its uniform bodyless 401 is Deferred.)
- **Mobile-first and burst.** The portal is many participants' phone home screen (single column at 320 px, 44 px targets). The Social Stream module holds a fixed footprint and coalesces updates so 120 posts/min
  reads as ambient motion, not jank (NFR-002); it has a Pause control (WCAG 2.2.2).
- **Kiosk and chrome (NFR-008).** The shell's `kiosk` variant strips compliance chrome and nav. COR-031 says chrome and watermark are never both off, so the kiosk **always** carries the EXERCISE watermark chip
  (Q-E3-2).
- **Pilot mode is unchanged.** With only `social` enabled nothing in this feature is reachable or visible; login still lands on the Social feed. Enabling `portal` flips landing to `/portal` (F12).

## Slip / cut order (December)
Full rationale per row is in [`implementation.md` § Schedule risk and cut order](implementation.md#schedule-risk-and-cut-order). Cut first to last:
1. **22** Top Stories board (per-item pin in F17 already satisfies PRT-004). 2. **21** filler starter pack (planners author filler with the `background` tag in F17). 3. **12** weather mount (hides cleanly if
weather 10 slips). 4. **15 PDF attachments** (resources become text and images; a PDF is a download-only link once press 02 lands). 5. **16 module reorder/toggle UI** (fixed order; hide only via channel enablement).
6. *(proposed)* **18/19 kiosk-lite** (the TV opens `/portal` in a normal browser). **Not cuttable:** 01, 02, 03, 06, 07, 09, 10, 13, 17, 23's isolation/a11y/two-worlds parts.
*(Applied 10/29 and no longer cut candidates: the playlist parts of 19/20 and the kiosk credential/remote control, 05/08/20, are **Deferred (post-December)** outright, Q-35.)*

## Deferred (post-December)
Per Tom, 10/29 (Q-35: portal first, **kiosk-lite only**): **05** display sessions (per-display revocable credential, `POST /api/auth/display`, Tier-2 security review, PP-1), **08** display state + remote-control API, **20** console display control, and the
playlist / pinned / show-next / per-kind-slide parts of the original **19**. These stay in the docs, marked Deferred, with no GitHub issues. The full PRT-040 ("login-free", facilitator-driven) is therefore not delivered in December (DECEMBER-RELEASE A-13).


## Open questions for Tom
See [`implementation.md` § Open questions](implementation.md#open-questions-for-tom) (Q-E3-1..Q-E3-12) with the defaults these stories assume.
