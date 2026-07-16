# E6 — Weather Source

> **Epic ID:** E6 · **Requirement prefix:** WX
> **Depends on:** E1 · **Feeds:** E3 (weather widget, alert bar), E2 (paired account posts), E10
> **Roles served:** Participants (consumers), Controllers (weather authors), Evaluators
> **Looking Glass parity target:** The Weather Source
> **Design handoff:** D4 (Weather Desk) — [`docs/design/D4-press-weather/`](design/D4-press-weather/) · decisions `D4-009…013` in [`DECISIONS.md`](design/D4-press-weather/DECISIONS.md); requirement amendments in [`STORY-UPDATES.md`](design/D4-press-weather/STORY-UPDATES.md).

## 1. Epic summary

The authoritative simulated weather service: a NOAA/NWS-style destination providing the exercise's official forecast, current conditions, and — most importantly — **warning products** (watches, warnings, advisories) that drive weather-dependent scenarios. Even non-weather exercises benefit: weather is ambient realism, and for hurricane/tornado/flood/winter scenarios it *is* the scenario driver.

Scope discipline: this is the smallest channel epic. It is a content presentation and alerting surface, not a meteorological model.

## 2. Features & requirements

### F6.1 Weather site

| ID | Requirement |
|---|---|
| WX-001 | A branded weather service site — default in-fiction brand **"The Weather Desk"** (screened, theme-configurable) — with NWS-style visual language (authoritative, data-forward): current conditions, multi-day forecast, and an active-alerts panel for the exercise's locale(s). |
| WX-002 | Weather state is scenario-scripted, not simulated: planners/controllers define a **weather timeline** (conditions and forecasts keyed to scenario time) that plays out automatically as the exercise clock (COR-050) advances, with manual override at any time. On a scenario-time jump (COR-051) the timeline **snaps** to the new scenario time; on suspension it freezes. High-risk leak class: warning products carry in-content watermarking per NFR-008 once available. |
| WX-003 | Forecast content supports the realistic evolution pattern: forecasts issued early in the timeline can differ from what "actually" happens (forecast uncertainty is trainable — e.g., the storm track shifts). |
| WX-004 | Multiple named locations per exercise (city/county zones) with per-zone conditions and alerts. |

### F6.2 Warning products & alerts

| ID | Requirement |
|---|---|
| WX-010 | Warning product model mirroring NWS conventions: type (watch/warning/advisory), hazard, zones, effective/expiry (scenario time), headline, body (formatted in familiar NWS style). |
| WX-011 | Issuing a warning product: publishes to the weather site's alert panel, pushes to the portal alert bar (PRT-010) at mapped severity, and optionally auto-posts from the weather service's paired E2 account. |
| WX-012 | Warning products are firable as Cadence injects (E9) or issued ad hoc by controllers (E7). |
| WX-013 | Graphics: support uploaded/Beat-generated imagery (radar loops, cone graphics, snowfall maps) as media on products and forecasts. No generated radar simulation at launch — canned/produced imagery only. |

### F6.3 Presence in the wider world

| ID | Requirement |
|---|---|
| WX-020 | Paired verified E2 account (e.g., "@NWSAtlanta"-analog) for products and forecast chatter — the way most of the public actually receives weather info. **→ D4-011 (C-3): the handle is @WeatherDesk.** |
| WX-021 | Portal weather widget (PRT-003): current conditions + active-alert count, linking to the site. |
| WX-022 | Product issuance/view telemetry feeds E10 (did participants see the warning before acting?). |

## D4 approved design — decisions folded into §2

> Source: design session **D4** — a full user-approved mockup with 12 sign-offs. Package:
> [`docs/design/D4-press-weather/`](design/D4-press-weather/)
> ([`DECISIONS.md`](design/D4-press-weather/DECISIONS.md),
> [`STORY-UPDATES.md`](design/D4-press-weather/STORY-UPDATES.md)). Requirement IDs are **stable**;
> the entries below **amend/confirm** the requirements above — original wording is preserved. They
> attach to the E6 stories when E6 is decomposed into `docs/features/weather-source/` (not yet done —
> see STORY-UPDATES "State of the E5/E6 backlog").

| Req | Decision | Change |
|---|---|---|
| WX-001 / WX-010 | D4-009 | weather.gov anatomy; **IBW What/Where/When/Impacts grid**; monospace product text with NWS furniture (`...HEADLINE...`, `PRECAUTIONARY/PREPAREDNESS ACTIONS`, `&&`/`$$`); **Issued/Effective/Expires in scenario time**; severity **icon + WATCH/WARNING text chip + color, never color-only**; **NWS hues darkened for WCAG AA** white-text contrast (warning `#8b0000`, watch `#2e6b4f`). |
| WX-004 | D4-009 | Per-zone selector on the site and on products. |
| WX-002 | D4-011, D4-012 | **Staff-authored only — no participant composer** (sign-off #9); warning products carry the EXERCISE watermark. |
| WX-011 | D4-010 | Watch = advisory ticker; **warning = emergency band that escapes the ticker on every channel**; **every warning type forces the emergency band, for now** (sign-off #6); **one multi-alert bar** carries weather + non-weather together (sign-off #7); the **same headline string** appears on the bar, the @WeatherDesk post, the portal widget, and the product page — no paraphrase. ⚠ **Conflict C-2** — supersedes "at mapped severity" (provisional "for now"). |
| WX-013 | D4-012 | Imagery slot **reserves the bottom-right EXERCISE watermark chip** (NFR-008; matches portal D2-008) — the highest-risk leak template, covered first. |
| WX-020 | D4-011 | Paired handle is **@WeatherDesk**; auto-post defaults to the **product headline verbatim** and is **editable pre-publish, console-side** (sign-off #10 — a D5 note). ⚠ **Conflict C-3** — supersedes the "@NWSAtlanta"-analog / "@WeatherSource" naming. |
| WX-021 | D4-010 | Portal widget swaps its forecast tile for the **warning tile** — same headline string (fourth simultaneous appearance). |

**Routed to D5 (controller console):** @WeatherDesk auto-post editing + all weather authoring are
staff-side — see [`D5 STORY-UPDATES §E`](design/D5-controller-console/STORY-UPDATES.md).
**Open item:** the alerts-history page (PRT-012, the alert bar's "Details →" target) is still stubbed.

## 3. User experience

**The scripted storm.** During planning, the planner builds the weather timeline: partly cloudy at StartEx; a Severe Thunderstorm Watch at scenario-hour 2; upgraded to a Warning with a Beat-produced radar image at hour 3. During conduct these fire automatically on the exercise clock. Participants see the portal widget flip to alert state, the alert bar go amber, and @WeatherDesk (was "@WeatherSource" — superseded, D4-011/C-3) post the warning — the same multi-channel arrival pattern real weather has. The EM participant who only watches social still gets it; the one who checks the weather site gets the full product. Nobody can say the information wasn't available — and E10 shows exactly who saw it when.

**Design notes.** Deliberately institutional design — this is the one channel that should feel like a government data site, not a consumer app. High information density, plain typography, alert color conventions matching real NWS severity colors (participants' existing instincts should transfer). **→ D4-009 (refined):** NWS hues **darkened for WCAG AA** white-text contrast, always paired with icon + WATCH/WARNING text chip (never color-only, NFR-001).

## 4. Out of scope

Live real-world weather feeds (isolation principle — the sim's weather is the scenario's weather), meteorological simulation/generated radar, marine/aviation products, historical climate pages.

## 5. Open questions

1. Should the weather timeline 