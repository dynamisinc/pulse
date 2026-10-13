# Story: Link cards and QR codes

**Feature:** Easy participant login  ·  **Epic:** E1  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** COR-011, COR-017 (part: handing out credentials at StartEx)  ·  **Design decisions:** none (EL-5, EL-6, EL-12)  ·  **Issue:** #469
**Stack:** backend  ·  **Review:** Tier-1 (staff-only; reveals credentials in bulk, so isolation and `no-store` are checked at Gate 1)  ·  **Priority:** Must  ·  **Wave:** 1  ·  **Effort:** S

## Context

The printed card sheet needs, per person: name, QR, link, sign-in name. The frontend may not add an npm
package this week, so the QR is generated **on the server** with the QRCoder NuGet package (EL-12) and returned
as an SVG data URI that the page drops into an `<img>`. This story is that one endpoint. It reads active links
that story 02/03 created and decrypts them with story 01's protector; it never creates or changes a link.

World: staff (the data feeds the print preview in story 12). The QR encodes exactly the personal join URL
(`{FrontendBaseUrl}/join/{token}`).

## Acceptance Criteria

- [ ] **Given** `POST /api/staff/roster/cards` *(amended: was GET, see EL-20)*, **then** it answers `200 RosterCardsDto` with `exerciseName` and one
      `RosterCardDto` per participant whose account is enabled, whose link is active and whose token decrypts:
      `name`, `agency`, `role`, `signInName`, `joinUrl` and `qrSvgDataUri`. Ordered by name. `?id=` (repeatable)
      limits it to those accounts; no `id` means every eligible participant.
- [ ] **Given** the QR, **then** `qrSvgDataUri` is `data:image/svg+xml;base64,…` for an SVG that encodes **exactly**
      the card's `joinUrl` (QRCoder `SvgQRCode`, error correction M, quiet zone included, a `viewBox` so it scales,
      black on white). The SVG contains no `<script>`, no `<image>`, no `href`/`xlink:href` and no external
      reference. A test compares the rendered module matrix to `QRCodeData` generated from the same URL, and the
      SVG is well-formed XML.
- [ ] **Given** a requested or eligible participant who cannot get a card, **then** they appear in `skipped` with
      a reason: `notFound` (unknown **or** from another exercise: identical), `noActiveLink`, `disabled`, or
      `tokenUnrecoverable` (the protected copy no longer decrypts). The request still succeeds with the others.
- [ ] **Given** `Authentication:FrontendBaseUrl` is unset, **then** the endpoint answers `409` ProblemDetails
      ("join links are not configured") and no card is produced; `GET /api/staff/roster` already reports
      `joinLinksAvailable: false` (story 02). **Given** more than `MaxCardsPerRequest` (500) ids, **then** `400`.
- [ ] **Given** any successful response, **then** it carries `Cache-Control: no-store` (it contains credentials).

### Cross-cutting
- [ ] **Isolation (XC-001/COR-001):** only the caller's exercise's links are read (central filter); an `id` from
      another exercise yields the same `notFound` skip as an unknown id, with no difference in status or body.
      Extends the standing suite.
- [ ] **Telemetry (XC-004):** one `roster.cards.generated` event per request with the card count (staff actor with
      role and acting human), in one unit of work. No URL, token or name in the payload.
- [ ] **Authorization (EL-13):** behind `EngineCockpitStaffAuthorizationFilter` + `RosterStaffRoleFilter`: 401 with
      no staff session, 403 for an evaluator or an unassigned user; a participant session never reaches it.
- [ ] **Content security (NFR-004):** names are returned as plain strings for the page to render as text (they were
      sanitized at ingest in story 02); the SVG is generated server-side from the URL only, never from user text.

## Out of Scope

Printing and the page layout (story 12). Issuing or rotating links (03). Embedding a logo or the exercise brand in
the QR. PNG output. Server-side PDF generation. Emailing (13).

## Technical Notes

Backend. New folder `Features/Identity/LinkCards/`: `LinkCardEndpoints`, `LinkCardService`, `QrSvgRenderer`
(`AddLinkCards()` / `MapLinkCardEndpoints()`). Use only QRCoder's cross-platform renderers: `QRCodeGenerator`,
`QRCodeData`, `SvgQRCode` with the **string-colour** `GetGraphic` overload (the `System.Drawing.Color` overloads are
Windows-only) and `SizingMode.ViewBoxAttribute`. The `QRCoder` package reference is added by story 01 (so the csproj is not contended);
pin the version it chose. Reuse `JoinUrlBuilder`, `IParticipantLinkTokenProtector`, `ExerciseFactsReader` and
`RosterLinkDtoFactory`. Register the literal `/api/staff/roster/cards` route; it must not collide with story 03's
`{id:guid}` routes (`guid` constraint). Keep the service allocation-light: 100 cards is the normal case, 500 the cap.
See `implementation.md` (story 04, gotchas 3, 5).

## Dependencies

Story 01 (protector, URL builder, DTOs, QRCoder reference). Reads data created by 02/03 but is testable alone by
seeding `ParticipantLink` rows. Consumed by story 12.

## Tests

`Pulse.WebApi.Tests/Features/Identity/LinkCards/`: `QrSvgRendererTests` (matrix equals QRCoder's for the URL,
well-formed, no script/href/image), `LinkCardServiceTests` (eligible, each skip reason, join base unset,
>500, `id` filter), `LinkCardEndpointsHttpTests` (200/400/409/401/403, `no-store`),
`LinkCardIsolationTests` (`[RequiresDockerFact]`: cross-exercise id is `notFound`), `LinkCardTelemetryTests`.
Manual check in UAT: scan a card QR with a phone camera (see `feature.md` walk-through step 4).
