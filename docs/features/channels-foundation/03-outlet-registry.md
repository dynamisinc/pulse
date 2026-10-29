# Story: Outlet registry and defaults

**Feature:** Channels foundation  ·  **Epic:** E4 (with E5/E6)  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** NWS-001, NWS-002, NWS-004 (pairing), PRS-010, PRS-012, WX-001, WX-020, COR-030, COR-066  ·  **Design decisions:** D3-P1, D3-P2, D4-011  ·  **Issue:** —
**Stack:** backend  ·  **World:** participant read / staff write  ·  **Wave:** 2  ·  **Effort:** M

## Context
An **outlet** is the brand a piece of content publishes under: a news outlet, the Wire Room (with one child outlet per org newsroom), or the Weather Desk. One registry per
exercise replaces three ad-hoc "outlet" tables. The visual identity is **data** (`skinKey` + `skinOverrides`), so a fifth outlet is a row and a token file (D3-P1).

## Acceptance Criteria
- [ ] **Read.** Given an exercise with enabled outlets, when a participant calls `GET /api/outlets?channel=news`, then it returns that exercise's enabled outlets as `OutletDto` ordered by `sortOrder`, and `GET /api/outlets/{slug}` returns one; disabled, soft-deleted and other-exercise outlets give the same 404 as an unknown slug (XC-001).
- [ ] **Channel gate.** Given the channel is disabled for the exercise, when `GET /api/outlets?channel=…` is called, then it is a 404 via `RequireChannelEnabled` (story 08).
- [ ] **Staff write.** Given a controller session, when it calls `POST|PUT|DELETE /api/outlets` and `POST /api/outlets/reorder`, then outlets are created, edited (stale `version` → 409), soft-deleted and reordered; participant and anonymous callers get 401/403.
- [ ] **Validation.** Given a write, then `slug` follows FC-1, `pairedPersonaId` must be a persona in the same exercise (an id from another exercise answers exactly like an unknown id, COR-001), `parentOutletId` must be a `press` outlet in the same exercise, `categories` is ≤ 20 strings, and `skinOverrides` is allowlisted to the FC-3b keys and size-capped.
- [ ] **Reusable skin-override validator (news FU-3b, portal FU-4b).** Given any `OutletSkinTokens` subset, then a **public** `ISkinOverridesValidator` (FC-7) enforces the FC-3b key allowlist, the CANNOT list and a 4 KB cap, and accepts `ext.<ns>` only for the namespaces `news`, `press`, `weather`, `portal` with flat scalar / string-array values; `OutletService` and the portal config API (portal 03) both call it, and an unknown namespace or key is a readable 400.
- [ ] **Scoop-only clutter (D3-P2).** Given `skinOverrides.clutter`, when `skinKey` is not the tabloid skin's key, then the write is rejected with a readable 400.
- [ ] **Defaults.** Given an exercise with no outlets, when staff invoke "add default outlets" for a channel, then Newsline 7 / The Courier-Ledger / The National Wire / The Scoop (`news`), The Wire Room (`press`) and The Weather Desk (`weather`, paired handle `@WeatherDesk`, D4-011) are created from the cast library; running it twice creates no duplicates. A `weather` exercise has **exactly one** default outlet (slug `weather-desk`, paired `@WeatherDesk`), so weather products resolve their outlet by channel without a picker (weather FU-8).
- [ ] **No exercise-identifying leakage.** `OutletDto` carries no exercise id, no admin/staff field and no wall-clock value (XC-002); `homeRoute` is host-relative (FC-9.3).
- [ ] **Telemetry.** Each staff create/edit/delete/reorder emits one `outlet_action` event (`channel: system`, `actor.actingHumanId`, `target { entityType: 'outlet', entityId }`) in the same unit of work (XC-004).

## Out of Scope
The skin token files and rendering (story 13; the four news token files are E4's); the outlet's paired-persona **creation** (E2 persona admin); org newsroom page content (E5); outlet admin UI (story 17 hosts it; each channel may add fields).

## Technical Notes
Files: `Features/Channels/Outlets/**` (service, endpoints, validator, defaults catalog). Staff gate pattern: `InjectEndpoints` empty-prefix groups with `EngineCockpitStaffAuthorizationFilter` + controller-role filter.
The defaults catalog is DEMO CONFIG (like the "Fairhaven" strings), not hard-coded brand in shell code. `Outlet.Enabled=false` hides an outlet without deleting it.

## Dependencies
01, 02. 08 for the channel gate (the filter interface exists from 02; a stub passes until 08 lands, then the wiring test asserts the real filter).
