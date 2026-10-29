# Story: Scripted-storm sample timeline seed (stretch)

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-002  ·  **Design decisions:** D4-009, D4-010, D4-011  ·  **Issue:** —
**Stack:** backend  ·  **World:** staff  ·  **Wave:** 5  ·  **Effort:** S

**Slip candidate.** Not required for the December exit criteria; it makes the epic's "scripted storm" demo (partly cloudy at StartEx, watch at hour 2, warning with radar at hour 3) one click.

## Context
The epic's §3 narrative is the canonical demo. This seeds it into an exercise as **drafts and scheduled items** using only the funnel, so a planner can edit rather than author from scratch.

## Acceptance Criteria
- [ ] **Seed endpoint.** Given a controller, `POST /api/weather/seed-sample-timeline` with `{ startScenarioTime? }` creates, in the staff session's exercise, a default zone if none exists, a StartEx `forecast` (partly cloudy), a Severe Thunderstorm **Watch** scheduled at +2h and an **upgrade to Warning** scheduled at +3h (superseding the watch) with IBW text and an imagery placeholder, all via `IContentPublishService` as `scheduled` (never published directly).
- [ ] **Idempotent and fictional.** Given it runs twice, then no duplicates are created (keyed by `ExternalSource: 'pulse-sample'` + `ExternalRef`); all names, zones and text are fictional and pass the story-14 NWS scan.
- [ ] **Delivery defaults.** The seeded watch and warning carry `delivery` defaults per story 04/Q2 and the warning's alert is forced on; nothing publishes until the scheduler fires it.
- [ ] **Auth, isolation, telemetry.** Staff-only controller role; scoped to the session exercise; the funnel emits the usual events with the acting human; a participant gets 401/403.

## Out of Scope
Other hazards/scenarios (parked scenario packs), UI beyond a console button owned by story 12 (optional), randomisation, importing real storm tracks.

## Technical Notes
`src/Pulse.WebApi/Features/Weather/Seed/**`. Uses the `ExternalSource`/`ExternalRef` idempotency reserved by F01 (the Cadence seam) — namespace `pulse-sample`, never `cadence`.

## Dependencies
01, 02, 04 (delivery defaults), F04, F05, F07, F03 (Weather Desk outlet). Can run with 08–13.
