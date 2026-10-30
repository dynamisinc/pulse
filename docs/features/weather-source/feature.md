# Feature: Weather source — The Weather Desk (E6)

**Epic:** E6 — Weather Source  ·  **Phase:** 3, pulled forward — **December release (Tom, 10/21)**  ·  **Feature ref:** F6.1 Weather site, F6.2 Warning products & alerts, F6.3 Presence in the wider world
**World:** participant (the Weather Desk, institutional skin) + staff (authoring/timeline in the controller console)  ·  **Issue:** #695 (Epic #691)

## Summary
The authoritative, fictional weather service: a government-data-site-style destination with current conditions, a multi-day forecast per zone, an active-alerts panel and
NWS-conventional **warning products** (watch / warning / advisory) that drive weather-dependent scenarios. Weather is **scenario-scripted, not simulated**: controllers author
products and forecasts, schedule them on the scenario clock, and issuing a warning lights the shared alert bar, posts from `@WeatherDesk` and feeds the portal widget with
**one headline string, everywhere at once**. E6 is a *thin channel on the shared foundation*: it registers two content kinds, a channel mount, a staff editor and a skin; it owns
no publishing, scheduling, alert, outlet or realtime machinery.

## Requirements covered
WX-001, WX-002, WX-003, WX-004 (F6.1) · WX-010, WX-011, WX-012, WX-013 (F6.2) · WX-020, WX-021, WX-022 (F6.3). Cross-cutting: XC-001/002/004/008/010, COR-053, NFR-001 (+ PDF-12 #680),
NFR-004, NFR-008. WX-012 (inject-firable) is delivered by the foundation's content-inject story (F16) plus story 11's "attach to inject"; E6 adds nothing beyond making the kinds eligible.

## Design references
`docs/design/D0-FOUNDATIONS.md` (two worlds, non-negotiables), `docs/design/D4-press-weather.md` Part B (**weather parts only**; Part A / Wire Room is E5), `docs/design/D4-press-weather/` incl.
`STORY-UPDATES.md` and `wx011-propagation-storyboard.png`, `DECISIONS.md` D4-009…D4-013, `D7-application-shells/SHELL-CONTRACT.md` §2 (alert bar), `D5` STORY-UPDATES §E (console-side weather authoring).

STORY-UPDATES items applied by these stories (to be ticked by the orchestrator when the stories are accepted; this pass did not edit the checklist):
| Item | Type | Decision | Stories |
|---|---|---|---|
| WX-001 / WX-010 NWS-verbatim anatomy, IBW grid, AA-adjusted severity | AMEND | D4-009 | 01, 06, 07, 08, 09 |
| WX-011 emergency band, multi-alert bar, verbatim headline | AMEND (C-2) | D4-010 | 04, 08, 09, 10 |
| WX-013 imagery slot reserves the EXERCISE chip | AMEND | D4-012 | 07, 09, 11, 14 |
| WX-020 `@WeatherDesk`, auto-post editable pre-publish | AMEND (C-3) | D4-011 | 04, 11 |
| WX-002 staff-authored only | ADD/ref | D4-011 | 11, 12 (no participant composer exists anywhere in E6) |
| WX-004 per-zone selector | confirm | D4-009 | 02, 03, 08 |
| WX-021 widget swaps to the warning tile | confirm | D4-010 | 03, 10 |
| Mobile pass (§D) | BACKLOG→partly applied | D0 §4.6 | 06–10 are specified mobile-first; no design mockup exists, see Q4 |
| Warning ⇒ emergency "for now" / graded mapping (§D, C-2) | BACKLOG | D4-010 #6 | 04 encodes it in one pinned place; graded mapping is parked |
| Alerts history page (§D) | BACKLOG | — | owned by the foundation (F11), not E6 |

Decisions recorded here: **C-2** — every warning product raises `emergency` through `IAlertRaiser` regardless of hazard ("for now", sign-off #6); watch → `advisory`; advisory product → `info`
(E6 *passes* the severity, the alert source does no mapping, per F10). **C-3** — handle is `@WeatherDesk`, brand "The Weather Desk".

## Stories
| # | Story | Requirement(s) | Stack | Wave | Effort | Status | Issue |
|---|-------|----------------|-------|------|--------|--------|-------|
| 01 | [Product and forecast payload contract, kind descriptors](01-product-forecast-contract-and-kinds.md) | WX-010, WX-003, WX-013, WX-002 | fullstack | 2 | M | Not Started | #752 |
| 02 | [Zone model, service and API](02-zone-model-and-api.md) | WX-004 | backend | 3 | M | Not Started | #753 |
| 03 | [Weather site read API (site, zone, widget summary)](03-weather-site-read-api.md) | WX-001, WX-002, WX-003, WX-004, WX-021 | backend | 4 | M | Not Started | #754 |
| 04 | [Warning delivery: alert bar, @WeatherDesk post, lifecycle](04-warning-delivery-alert-and-post.md) | WX-011, WX-020, WX-002 | backend | 4 | M | Not Started | #755 |
| 05 | [Staff timeline read model and issue-update helper](05-staff-timeline-api.md) | WX-002, WX-003, WX-012 | backend | 4 | S | Not Started | #756 |
| 06 | [Weather channel mount, route shell and Weather Desk skin](06-channel-mount-and-skin.md) | WX-001, NFR-001, NFR-008 | frontend | 4 | M | Not Started | #757 |
| 07 | [Product components: severity chip, IBW grid, NWS product text](07-product-components.md) | WX-010, WX-011, NFR-001 | frontend | 3 | M | Not Started | #758 |
| 08 | [Weather site home: conditions, forecast, alerts panel, zone selector](08-weather-site-home.md) | WX-001, WX-003, WX-004, WX-011 | frontend | 5 | L | Not Started | #759 |
| 09 | [Product and forecast permalink page](09-product-permalink-page.md) | WX-010, WX-013, WX-022, XC-010 | frontend | 5 | M | Not Started | #760 |
| 10 | [Portal weather widget tile and summary hook](10-portal-widget-tile.md) | WX-021, WX-011 | frontend | 5 | S | Not Started | #761 |
| 11 | [Staff authoring: product and forecast editors](11-staff-product-forecast-editors.md) | WX-002, WX-010, WX-011, WX-012, WX-013, WX-020 | frontend | 5 | L | Not Started | #762 |
| 12 | [Staff weather timeline panel](12-staff-timeline-panel.md) | WX-002, WX-003 | frontend | 5 | M | Not Started | #763 |
| 13 | [Staff zone admin](13-staff-zone-admin.md) | WX-004 | frontend | 5 | S | Not Started | #764 |
| 14 | [Weather conformance: isolation, watermark, a11y/508, fictional-NWS guard](14-weather-conformance.md) | XC-001, NFR-001/008, PDF-12 (#680), WX-001 | testing | 6 | M | Not Started | #765 |
| 15 | [Scripted-storm sample timeline seed (stretch)](15-scripted-storm-sample-seed.md) | WX-002 | backend | 5 | S | Not Started | #766 |

## Dependencies
**Channels foundation** (`docs/features/channels-foundation/`, story numbers prefixed `F`): F01 data model, F02 contracts, F03 outlet registry (Weather Desk outlet + `@WeatherDesk` pairing), F04 publish funnel,
F05 scheduler, F06 participant read API, F07 staff content API, F08 enablement gate, F09 realtime, F10 alert source, F12 router, F13 skin system, F14 primitives, F15 data hooks + telemetry, F17 staff
authoring seam, F18 paired post, F20 conformance kit. Nothing in E6 is a prerequisite for another channel except the widget (story 10 → E3 portal, which consumes it).
**Migrations (Q-28, Tom 10/29):** E6 adds none; `WeatherZone` is created by F01's M1. **Same-wave serial edge (inconsistency I-4 fixed, 10/29):** story **12 waits for story 11** (the timeline's edit action delegates to 11's editors), so 11 and 12 are not parallel peers; both are in the combined wave CW5 with 12 starting after 11 merges.

## Design notes
- **Two worlds.** The Weather Desk is the *one* participant surface that should feel like a government data site (dense, plain, monospace product text) — and it is still a participant surface: skinned via
  `OutletSkinScope`, never the COBRA theme, never a default MUI look. Authoring (11, 12, 13) is COBRA, desktop-first, inside the controller console, and previews the participant DTO inside the staff frame (COR-041).
- **Fictional, never confusable with the real NWS.** NWS *conventions* (IBW grid, `...HEADLINE...`, `&&`/`$$`, hazard vocabulary, watch/warning colours) are reproduced so participants' instincts transfer; NWS *identity*
  is not: no real NWS/NOAA/weather.gov names or marks, no real WFO/office identifiers, no real SAME/EAS codes, real county FIPS, or real-world feed data. Story 14 enforces it with a scan.
- **Weather timeline = scheduled content, not a second scheduler.** A timeline entry is a `weather_product` or `forecast` `ContentItem` with `status: scheduled` and a `ScheduledScenarioTime`; the foundation scheduler (F05)
  publishes it on the exercise clock, in order, with freeze/jump semantics. E6 adds *reading* semantics on top (what is "current" at scenario time now, expiry, supersession) and the staff timeline view.
- **Scenario time only (COR-053).** Issued / Effective / Expires, forecast period labels with instants, "valid until", and observation times are scenario-time strings through `ScenarioDateline`. A product's *state*
  (pending / active / expired / cancelled) is derived from the shell's `scenarioNow` against `effective`/`expires`, so it ticks over without a refetch.
- **One headline string (D4-010).** `ContentItem.Headline` is the single source: the alert `message`, the `@WeatherDesk` post default text, the widget tile and the product page render the same stored string. No story may
  uppercase, truncate or paraphrase it in data; presentation renders it as stored.
- **Severity is never color-only (NFR-001).** Icon + WATCH/WARNING/ADVISORY text chip + colour, with the AA-adjusted hues (warning `#8b0000`, watch `#2e6b4f`; advisory proposed `#8a4b00`, see Q5).
- **Phase discipline.** Parked, not built: graded per-hazard severity mapping (C-2), generated radar / interactive map / zone polygons, VTEC codes, rolling auto-evolving forecasts, marine/aviation products, per-recipient
  alerting, a participant weather composer (never — D4-011 #9). See "Slip candidates" in `implementation.md`.

## Open questions for Tom
See the bottom of [`implementation.md`](implementation.md#open-questions-for-tom) (Q1…Q8) with the defaults these stories assume.
