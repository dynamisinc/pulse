# Story: Freeze and resume verified on UAT (demo beat 6)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** Not Started
**Requirements:** world-steering/07 (#350), world-steering/08 (#351), COR-053  ·  **Decisions:** DF-26  ·  **Issue:** —
**Stack:** script + manual  ·  **World:** both  ·  **Review:** Tier-1  ·  **Priority:** Must  ·  **Wave:** 4  ·  **Effort:** S
**Owner:** planning session · **Branch:** `build/demo-feedback/27-freeze-verification` → readiness PR to `main`

## Context

Demo beat 6 is "Freeze the world: the participant gets the holding page; Resume continues from the same scenario
minute". #350/#351 were merged in July (PR #386) and are still **In Progress, awaiting UAT verification**; the demo plan
lists "verify #350/#351" as the beat's prerequisite and nobody owns it. Story 18 adds a new case: Freeze must survive a
restart.

## Acceptance Criteria

- [ ] New `scripts/uat/Test-FreezeResume.ps1` against a named exercise (default: a throwaway "Freeze check" exercise,
      never the demo exercise unless `-ExerciseId` says so). As a controller it:
      1. records the scenario minute, sets pause tier `freeze` (in-fiction register), and checks
         `GET /api/overlay-state` (as a participant session from a provisioned test login) returns the pause state;
      2. checks over 90 s that the scenario minute does not move, an inject fire is refused, and noise posts stop
         (noise set to Low for the check, then back);
      3. resumes to the previous tier and checks the minute continues from where it froze (± 1 minute) and the overlay
         returns to `none`;
      4. with `-IncludeRestart` (after 18 is deployed): freezes, restarts the App Service, waits for health, checks the
         overlay is still pause and the minute unchanged, then resumes;
      5. leaves the exercise in the tier it found it (never FROZEN).
      PASS/WARN/FAIL output, non-zero exit on FAIL, nothing secret logged.
- [ ] Manual check (two browsers, Tom signs in): the participant sees the holding page appear and leave live, both
      registers (in-fiction "We'll be right back" and out-of-fiction), and the console's Pause pill shows the guarded
      "Confirm freeze" step. Screenshot both registers into the PR.
- [ ] When both pass, `world-steering/07` and `/08` status lines go to Complete with the evidence, and #350/#351 are
      closed (per GITHUB_TRACKER).

## Out of Scope

Escalation dial (#352), engine settings (#353/#354). Any code change to Freeze (a failure becomes a bug story).

## Technical Notes

Freeze path: `PausePill.tsx` → `POST /api/steering/pause-tier` → `PauseTierRegistry` → `PauseOverlayPublisher`
(`OverlayStateChanged`) → `overlayState.ts` / `OverlayLayer.tsx`. Participant test login via `New-DemoParticipant.ps1`
or a roster link.

## Dependencies

18 for step 4 only.

## Tests

`Test-FreezeResume.Tests.ps1` (mocked API: pass path, minute-moved fail, overlay-missing fail, always restores the tier).
The UAT run itself is the evidence.
