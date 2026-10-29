# Story: Staff timeline read model and issue-update helper

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-002, WX-003, WX-012  ·  **Design decisions:** D4-011  ·  **Issue:** —
**Stack:** backend  ·  **World:** staff  ·  **Wave:** 4  ·  **Effort:** S

## Context
WX-002: planners define a **weather timeline** that plays out on the exercise clock, with manual override at any time. The timeline *is* the set of weather `ContentItem`s (scheduled and published) — the
scheduler is F05. This story gives the staff UI one read model of that timeline (by zone, in scenario-time order, with a "now" marker) and one helper that pre-fills a follow-up product so
"upgrade the watch to a warning" or "cancel it" is two clicks, not a re-keyed form.

## Acceptance Criteria
- [ ] **Timeline read.** Given a controller, `GET /api/weather/timeline?zone=&from=&to=` returns `{ nowScenarioTime, nowWallClock, items[] }` where each item is a weather `ContentItem` (any status except soft-deleted) with `kind`, `productType?`, `hazard?`, zones, headline, `status`, scenario time that applies (scheduled or published), `state` (pending|active|expired|cancelled for products), supersession link, and `lastError` from a failed scheduled publish; ordered by scenario time; staff-only (participant 401/403).
- [ ] **Manual override is visible.** Given a forecast published ad hoc (publish-now) while later items are still scheduled, then the timeline shows it in sequence with a `manual` marker (derived from `origin`/publish path), and the scheduled items remain scheduled — the override does not delete or reschedule the script.
- [ ] **Issue-update helper.** Given a published product, `POST /api/weather/products/{id}/issue-update` with `{ action: update|upgrade|cancel }` creates a **draft** through `IContentPublishService.CreateDraftAsync` pre-filled from the original (zones, hazard, IBW copied; `supersedesContentId` set; `upgrade` sets `productType: warning`; `cancel` clears IBW and seeds a "has been cancelled" body) and returns it; it never publishes; invalid transitions (`upgrade` of a warning, any action on an expired/cancelled/retracted product) are 409.
- [ ] **Time-jump honesty.** Given the clock jumps forward past scheduled items, then the timeline shows them as published with their own scheduled scenario time (F05 behaviour) and given a backward jump shows items published after `now` flagged `ahead_of_clock` so the planner sees why the site excludes them (story 03).
- [ ] **Isolation and auth (XC-001).** Scoped to the staff session's exercise; same filters as other staff routes (`EngineCockpitStaffAuthorizationFilter`, controller-role on the POST); added to the isolation suite; read-only roles can GET but not POST.
- [ ] **Telemetry (XC-004).** The helper's draft creation is emitted by the funnel with the acting human; the read emits nothing.

## Out of Scope
A second scheduler, bulk shifting the whole timeline by an offset (parked), recurring forecasts, auto-expiry products, the timeline UI (12).

## Technical Notes
`src/Pulse.WebApi/Features/Weather/Timeline/**`; mirror the `InjectEndpoints` auth/filter pattern; wall-clock pair is staff-only (shown like Cadence's scenario/wall pair). TS mirror in `features/weather/contract/timeline.ts` (new file; additive).

## Dependencies
01, F04, F07 (staff API/filters), F05 (scheduled semantics). Can run with 03, 04, 06.
