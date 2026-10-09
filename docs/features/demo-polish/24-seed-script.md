# Story: Seed script (demo content through the public APIs)

**Feature:** Demo polish  ·  **Epic:** E7  ·  **Phase:** 1  ·  **Status:** In Progress
**Requirements:** CTL-001, COR-023 (backdated history), COR-024, XC-004  ·  **Design decisions:** plan §2.5 (seed late, through the product)  ·  **Issue:** #443
**Story ID:** S1  ·  **Stack:** script (PowerShell 7)  ·  **Priority:** Must  ·  **Effort:** M  ·  **Wave:** seed (Fri 10/16 → Sun 10/18; written after the backend freeze)
**Home story:** — (no existing backlog story; extends the `scripts/uat` toolbox).

## Context
**As** the presenter, **I want** one command that loads the opening feed, avatars, banners, videos and the run
sheet into UAT, **so that** the demo opens on a believable, populated fictional county — and re-running it on
Monday is safe. It drives only the **public product APIs** (no seed-only backend code, no SQL, no `/api/ops/*`),
so content work never collides with the backend freeze (plan §2.5). Pack format: implementation.md §1.10
(`pulse.demopack.v1`); the run-sheet output follows §1.9. Authors the content: S2.

## Acceptance Criteria
- [ ] **Script and safety.** `scripts/uat/Seed-DemoContent.ps1` (`#Requires -Version 7.0`, dot-sources
      `Common.ps1`) takes `-PackPath` (default `docs/demo/pack/pack.json`), `-ApiHost`, `-SiteUrl`,
      `-StaffUsername`, `-ScenarioAnchor` (default: now, UTC), `-RunSheetOut`, `-WhatIf`, `-Resume`; calls
      the anonymous `GET /api/exercise-context` first (host-resolved `exerciseId` + `timeZone`), then signs in
      via `POST /api/auth/staff/login` with `{username, secret, exerciseId}` (the request requires
      `exerciseId`; single-exercise script, so no active-exercise switch), using a secret from `$env:PULSE_STAFF_SECRET` or a hidden prompt (the
      `Copy-StaffSecret.ps1` pattern) — **the secret and tokens are never printed, logged or written to disk**.
- [ ] **Public APIs only.** It calls nothing but `/api/exercise-context` (for `exerciseId` and the `timeZone` every
      post requires), `/api/auth/staff/login`, `/api/steering/pause-tier`,
      `/api/staff/media`, `/api/media`, `/api/personas`, `/api/staff/personas/{id}`, `/api/posts`, `/api/feed`;
      a test greps the script for any other `/api/` path or `sqlcmd`/SQL and fails.
- [ ] **Engine paused by default (Decision 4).** After seeding, and unless `-LeaveEngineRunning` is passed, it
      calls `POST /api/steering/pause-tier` with `{"tier":"engine"}` as the controller and reports the applied
      tier. The tier lives in memory and every reset or restart sets it back to `running`, so the run-of-show
      repeats this after any reset.
- [ ] **Validate first, write nothing on error.** It validates the whole pack (§1.10 rules: unique keys,
      resolvable refs, replies after parents, text ≤ 280, alt on every media item, files present and within the
      server's limits) before the first request; `-WhatIf` prints the plan (counts per step) and exits 0 with no
      writes.
- [ ] **Media upload.** It uploads each file once (poster image first, then the video with `posterMediaId`),
      honours `429` by sleeping the `Retry-After` and retrying, and records a manifest at
      `%LOCALAPPDATA%\Pulse\demo-seed\<exerciseId>.json` mapping pack keys → asset ids (+ SHA-256) so a re-run
      **does not re-upload** and `-Resume` continues a partial run.
- [ ] **Personas and posts.** It resolves handles to ids via `GET /api/personas`, applies display
      name/bio/location/verified/avatar/banner with `PATCH` (unknown handle → stop and list the known handles),
      then posts the opening feed as `controller-as-persona` in chronological order with `scenarioTime = anchor
      − minutesBeforeAnchor`, replies after parents (`parentPostId` from the manifest), and baselines
      (`engagementBaseline`); a re-run skips posts already in the manifest (idempotent) and never duplicates.
- [ ] **Run-sheet export.** It writes `runsheet.demo.json` (`pulse.runsheet.v1`) with pack media keys and post
      keys rewritten to real asset/post ids, importable by C3 without edits (`import` of it succeeds).
- [ ] **Self-check.** After seeding it fetches `GET /api/feed` and verifies ≥ the number of top-level posts
      seeded, that every media `url` answers a ranged request (`Range: bytes=0-1`) with `206`, and prints a ✅/❌
      summary; it exits non-zero if any check fails.

## Out of Scope
Resetting or clearing UAT (`Reset-DemoState.ps1`, `Clear-DemoContent.ps1` already exist; run them first),
creating personas or exercises, engine seeding, authoring the content (S2), direct DB writes, multi-exercise
seeding, a GUI.

## Technical Notes
- Files: `scripts/uat/Seed-DemoContent.ps1`, `scripts/uat/Seed-DemoContent.Tests.ps1` (Pester 5 for the pure
  functions: pack validation, offset math, manifest/idempotency, run-sheet rewrite — if Pester is unavailable on
  the machine, document a `-WhatIf` dry-run transcript instead), `docs/demo/pack/schema/**` (JSON Schema for
  `pack.json`). Follow the style of `New-DemoParticipant.ps1` (comment-based help, `-WhatIf`, secrets handled in
  memory).
- Rate limit: `POST /api/media` allows ~30/min per account (BM) — ~25 media files fit in one run; the 429
  back-off is still required. Posts need a persona-bound id: staff post as the **chosen persona**
  (`authorPersonaId`), acting human = the staff user (server-derived).
- Scenario time: the frontend's `scenarioNow()` currently tracks wall-clock (`core/clock/exerciseClock.ts`), so
  anchoring at *now* places the opening feed 0–6 scenario hours in the past; pass `-ScenarioAnchor` if a live
  exercise-clock provider has replaced that by seeding time.

## Dependencies
Backend frozen and live in UAT: PE-BE, BM, BP, B2 (and I1 deployed). S2 supplies the pack. Runs after the 10/16
functional walk starts; final re-run Mon 10/19 after the final reset.

## Tests
- Pester (or documented dry run): pack validation matrix (each rule), offset math, manifest idempotency (second
  run issues zero uploads/posts), run-sheet rewrite passes the C3 schema, no secret in output, API-path
  allowlist grep.
- Manual (🧑): `-WhatIf` transcript; full run against UAT; the self-check summary all ✅; open the participant app
  and confirm photos, a playing video, threads with replies and baselines.
