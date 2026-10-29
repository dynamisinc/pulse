# Story: Evergreen filler starter pack

**Feature:** Exercise portal  ·  **Epic:** E3  ·  **Phase:** 3 — December release (Tom, 10/21)  ·  **Status:** Not Started
**Requirements:** PRT-030, PRT-031, XC-001, XC-010, NFR-004  ·  **Design decisions:** none  ·  **Issue:** #784
**Stack:** backend  ·  **World:** foundation (staff action, participant-visible result)  ·  **Wave:** 4  ·  **Effort:** M  ·  **Priority:** Could (cut order 2)

## Context
PRT-030: planners seed evergreen filler (human-interest, business features, "Get to know" profiles) so the world is not only crisis, supporting pre-StartEx normalcy (Staged, COR-043) and pacing lulls. PRT-031: filler is authored in the news pipeline and tagged `background` for E10 signal/noise. The **tag and the authoring** are the foundation's (F01, F07, F17); this story adds only the **starter pack**: one staff action that seeds a ready-made set of neutral filler `news` articles, so an exercise is not blank on day one. Per foundation Q7 the portal owns no content; the pack is ordinary `news` `ContentItem`s with `background: true`.

## Acceptance Criteria
- [ ] **Seed action.** Given a controller or planner, when they `POST /api/portal/filler/seed` on an exercise whose outlets exist (F03 seeds Newsline 7, Courier-Ledger on request), then 12-15 articles are created through `IContentPublishService` (never direct rows) as `origin: controller`, `background: true`, with the first few **published** now (so a Staged portal is not empty) and the rest **scheduled** at spread scenario times to serve pacing lulls.
- [ ] **Idempotent.** Given the action is called twice, then no item is duplicated: each pack item carries `ExternalSource = 'pulse-filler-v1'` and a stable `ExternalRef`, honoring F01's unique index; a second call reports `created: 0, skipped: N` and never overwrites a controller's edits.
- [ ] **Neutral and fictional.** Given the pack content, then every article is fictional, non-crisis and free of real people, brands, places and trademarks (a review checklist plus a scan for real-world domains and absolute URLs), reads as ordinary local news, carries no "filler" wording, and uses the sanitized rich-body profile (NFR-004).
- [ ] **Invisible tag (XC-002).** Given a participant reads the seeded items, then nothing marks them as filler (the `background` tag is staff-only); in staff views the tag is visible (F17) so E10 can separate signal from noise.
- [ ] **Staged-state normalcy.** Given an exercise in Staged with the pack seeded, when a participant opens the portal, then Top Stories shows the published filler with a calm lead (verified in 23's "normal day" fixture-to-live check).
- [ ] **Isolation and telemetry.** Given a seed in exercise A, then nothing appears in exercise B; each publish emits the funnel's `content_published` (FC-6) with the staff actor, and the action itself is a staff-audited command.
- [ ] **Retire.** Given the pack items later retracted or soft-deleted by a controller, then re-seeding does not resurrect them (the `ExternalRef` stays claimed).

## Out of Scope
Authoring UI and the background tag control (F17), the news article editor (E4 17), crisis content, a media library for filler hero images (items ship without hero or with the existing demo media only), localization.

## Technical Notes
Files: `Features/Portal/Seed/**` plus the versioned pack `filler-pack.v1.json`. Depends on the funnel's `ScheduleAsync` and `Background` support (F04/F07). Cast/outlet names come from the existing cast library; no new outlet is created here.

## Dependencies
03 (portal wiring convention), F03, F04, F05, F07. Can run with 17-19, 22.
