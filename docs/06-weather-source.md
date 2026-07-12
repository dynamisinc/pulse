# E6 — Weather Source

> **Epic ID:** E6 · **Requirement prefix:** WX
> **Depends on:** E1 · **Feeds:** E3 (weather widget, alert bar), E2 (paired account posts), E10
> **Roles served:** Participants (consumers), Controllers (weather authors), Evaluators
> **Looking Glass parity target:** The Weather Source

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
| WX-020 | Paired verified E2 account (e.g., "@NWSAtlanta"-analog) for products and forecast chatter — the way most of the public actually receives weather info. |
| WX-021 | Portal weather widget (PRT-003): current conditions + active-alert count, linking to the site. |
| WX-022 | Product issuance/view telemetry feeds E10 (did participants see the warning before acting?). |

## 3. User experience

**The scripted storm.** During planning, the planner builds the weather timeline: partly cloudy at StartEx; a Severe Thunderstorm Watch at scenario-hour 2; upgraded to a Warning with a Beat-produced radar image at hour 3. During conduct these fire automatically on the exercise clock. Participants see the portal widget flip to alert state, the alert bar go amber, and @WeatherSource post the warning — the same multi-channel arrival pattern real weather has. The EM participant who only watches social still gets it; the one who checks the weather site gets the full product. Nobody can say the information wasn't available — and E10 shows exactly who saw it when.

**Design notes.** Deliberately institutional design — this is the one channel that should feel like a government data site, not a consumer app. High information density, plain typography, alert color conventions matching real NWS severity colors (participants' existing instincts should transfer).

## 4. Out of scope

Live real-world weather feeds (isolation principle — the sim's weather is the scenario's weather), meteorological simulation/generated radar, marine/aviation products, historical climate pages.

## 5. Open questions

1. Should the weather timeline 