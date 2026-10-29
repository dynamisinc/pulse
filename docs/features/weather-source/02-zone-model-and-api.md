# Story: Zone model, service and API

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-004  ·  **Design decisions:** D4-009  ·  **Issue:** #753
**Stack:** backend  ·  **World:** both (participant read, staff write)  ·  **Wave:** 3  ·  **Effort:** M

## Context
WX-004: multiple named locations per exercise (city/county zones) with per-zone conditions and alerts. The foundation has no zone concept, so E6 owns the small exercise-scoped `WeatherZone` model. **Q-28 (Tom, 10/29): the table itself is created by foundation F01's M1**; this story owns the service, catalog and API over it and adds no migration.
Zones are **named labels, not geometry** (no polygons, no map): a product or forecast references zones by slug. This story also implements `IWeatherZoneCatalog` (declared in story 01).

## Acceptance Criteria
- [ ] **Entity (schema is F01's M1).** Given `WeatherZone : IExerciseScoped` (`Slug`, `Name`, `Kind` county|city|region|custom, `Description?`, `SortOrder`, `IsDefault`, `Version`, `DeletedAt`) as created by F01's **M1** (Q-28; this story adds **no migration**, E6 has none), then it sits behind the `PulseDbContext` central filter + write guard, slugs follow FC-1 and are unique per exercise, and the service's tests prove both against the real entity (no zone is auto-created on exercise setup).
- [ ] **Staff CRUD.** Given a controller, `GET|POST|PUT|DELETE /api/weather/zones` create/edit/soft-delete zones (staff-only; 401/403 for participants; `version` conflict → 409); exactly one zone is `IsDefault` (the site's initial selection and the widget's zone); the first zone created becomes the default.
- [ ] **Participant read.** Given a participant on an exercise with the weather channel enabled, `GET /api/weather/zones` returns enabled zones ordered by `SortOrder` as `{ slug, name, kind, isDefault }` behind `RequireChannelEnabled("weather")`; a disabled channel returns the same 404 as an unknown route.
- [ ] **Soft delete (XC-010).** Given a zone referenced by published products/forecasts is deleted, then it disappears from the participant list and new authoring, but `IWeatherZoneCatalog.ResolveAsync(slugs, includeDeleted: true)` still returns its name so historic products keep rendering their zone names; nothing is hard-deleted.
- [ ] **Catalog.** `IWeatherZoneCatalog.ExistAsync(slugs)` returns missing slugs for the resolved exercise only; an empty catalog means weather products/forecasts cannot be created (story 01 validation error `no_zones`), and the staff API reports that state so the editor can prompt "add a zone first".
- [ ] **Isolation (XC-001/002).** Another exercise's zone id/slug is indistinguishable from unknown (404); participant DTOs carry no `exerciseId`, acting human or wall clock; the route is added to the standing isolation suite via the F20 kit.
- [ ] **Telemetry (XC-004).** Staff zone create/edit/delete emit a server event in the same unit of work with the acting human (`weather_zone_changed`, registered by foundation story 02, FC-6b), channel `weather`.

## Out of Scope
Zone geometry/maps, lat/long, county lists from real geography, per-zone alerting rules, zone import from Cadence or CSV (parked). Zone admin UI (13).

## Technical Notes
Backend only: `Features/Weather/Zones/**`. The entity file, DbSet line and migration are **F01's** (M1; FU-1 resolved by folding it in; there is no outlet-categories fallback). This story consumes `WeatherZone` and must not edit `Data/**` or `Migrations/**`. Mirror `OutletService` for shape. Fictional zone names only in seeds/fixtures.

## Dependencies
01 (interface), **F01 (M1 creates `WeatherZone`)**, F08 (gate). Can run with F05, F06, F07, 07.

## Tests
`WebApplicationFactory<Program>` wiring test; isolation cases; catalog resolution including soft-deleted.
