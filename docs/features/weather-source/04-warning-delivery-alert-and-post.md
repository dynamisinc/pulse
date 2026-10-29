# Story: Warning delivery — alert bar, @WeatherDesk post, lifecycle

**Feature:** Weather source  ·  **Epic:** E6  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** WX-011, WX-020, WX-002  ·  **Design decisions:** D4-010 (sign-offs #6, #7), D4-011 (#10), C-2, C-3  ·  **Issue:** —
**Stack:** backend  ·  **World:** participant-visible effects, staff-controlled  ·  **Wave:** 4  ·  **Effort:** M

## Context
Issuing a product publishes to the site (the foundation funnel does that), pushes to the shared alert bar and optionally posts from `@WeatherDesk`. E6 supplies the **rules**; F10 (`IAlertRaiser`) and F18
(`IPairedSocialPoster`) supply the machinery. **Decision (C-2, "for now"):** every `warning` product, for every hazard, raises `emergency`; E6 passes the severity and the alert source does no mapping.
The one multi-alert bar (sign-off #7) is the shell's; E6 just raises into it.

## Acceptance Criteria
- [ ] **Severity map in one place.** Given `WeatherAlertSeverityMap.For(productType, hazard)`, then `warning` → `emergency` for **every** hazard, `watch` → `advisory`, `advisory` → `info`; the hazard parameter is accepted and deliberately ignored, a test pins "all hazards × warning = emergency", and the file carries the "for now / revisit graded mapping" note (D4-010 #6, backlog).
- [ ] **Raise through `IAlertRaiser`.** Given a weather product publishes (staff publish, inject fire or scheduler), then `RaiseAsync({ severity, headline, href: "/weather/{outlet}/{slug}", sourceChannel: "weather", sourceContentId, expires: product.expiresScenarioTime })` is called once, the alert `message` equals `ContentItem.Headline` **verbatim** (no paraphrase), and `ContentItem.AlertId` links it; `delivery.raiseAlert` is forced `true` for warnings (server rejects `false`) and defaults `true` for watch/advisory.
- [ ] **Lifecycle replaces, never stacks duplicates.** Given an `upgrade` (watch → warning) or `update` product, then the superseded product's alert is cleared and a new alert is raised; a `cancel` product clears the superseded alert and raises none; retracting a published product clears its alert; a `correction` that changes the headline replaces the alert so the strings never diverge.
- [ ] **Stale-on-jump guard.** Given a scheduled product published late by a forward time jump (F05 publishes with its own scheduled time) whose `expires` is already <= scenario now, then it publishes to the site/history but raises **no alert and no post**, and the publish result reports `alert: skipped_stale` / `post: skipped_stale`.
- [ ] **`@WeatherDesk` post (WX-020, D4-011).** Given `delivery.post.enabled`, then the post is made through `IPairedSocialPoster` as the Weather Desk outlet's paired persona, text defaults to the **product headline verbatim**, is editable pre-publish (the editor stores `delivery.post.text`), is <= 280 code points and sanitized, and `ContentItem.PairedPostId` links it; a missing paired persona or a poster failure never blocks the publish (outcome `no_paired_persona` / `failed` in the result, one log line).
- [ ] **Scheduled options survive.** Given a product scheduled with delivery options, then at publish time the runner path applies the same `delivery` options as a staff publish-now (alert/post decided from the stored payload, not a transient dialog): the descriptor's `ResolvePublishOptions` (story 01) feeds the funnel's FC-7a resolution, so the scheduler and inject fire need no dialog and `ContentItem.AlertId` / `PairedPostId` are linked by the funnel itself (FU-2 resolved).
- [ ] **Telemetry, isolation (XC-004, XC-001).** Exactly one `content_published` (F04) and one `alert_issued` (F10) per issuance with the acting human and `origin`; side effects run inside the exercise scope in the scheduler's background scope (`ExerciseContext` set before `PulseDbContext`); participants never see who issued it (XC-002).

## Out of Scope
Graded severity per hazard (backlog, C-2); per-zone or per-recipient targeting; the bar's rendering (F11 / shell); SAME/EAS tones; automatic cancellation at expiry (alerts expire by `expires`; an explicit `cancel` product is authored); sound.

## Technical Notes
`src/Pulse.WebApi/Features/Weather/Delivery/**`: `WeatherAlertSeverityMap`, `WeatherDeliveryPlanner` (builds the `PublishOptions` the descriptor's `ResolvePublishOptions` returns; `DefaultAlertMapping` is only the editor's pre-fill suggestion, FC-7a) and a `WeatherPublishedObserver : IContentPublishedObserver` for clear-on-retract/replace. Reuse `IContentPublishService` (never write `ContentItem` rows), the F04 result's side-effect outcomes. Headline is never transformed anywhere in this path.

## Dependencies
01, F04 (funnel, `PublishOptions` resolution FC-7a, observers), F05 (scheduler), F10 (`IAlertRaiser`), F18 (`IPairedSocialPoster`; no-op seam until it lands — the post ACs are verified after F18). Can run with 03, 05, 06.
