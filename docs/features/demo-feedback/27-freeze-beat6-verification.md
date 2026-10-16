# Story: Freeze and resume verified on UAT (demo beat 6)

**Feature:** Demo feedback cut (10/20)  ·  **Phase:** 1  ·  **Status:** In Review
**Requirements:** world-steering/07 (#350), world-steering/08 (#351), COR-053  ·  **Decisions:** DF-26  ·  **Issue:** #545
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
      *Scripted and Pester-covered, but left unticked: the AC as written (a participant-session overlay read) is met
      only by the live run with `-ExerciseId <demo> -ParticipantUsername <login>`, because participant sessions are
      host-bound. **Pending Tom's UAT run.** See "Script notes" below for the signals used and the gaps (no staff
      scenario-minute GET; participant sessions are host-bound; no participant-binding field on staff personas).*
- [ ] Manual check (two browsers, Tom signs in): the participant sees the holding page appear and leave live, both
      registers (in-fiction "We'll be right back" and out-of-fiction), and the console's Pause pill shows the guarded
      "Confirm freeze" step. Screenshot both registers into the PR. *Pending Tom's UAT run (checklist below).*
- [ ] When both pass, `world-steering/07` and `/08` status lines go to Complete with the evidence, and #350/#351 are
      closed (per GITHUB_TRACKER). *Pending Tom's UAT run; for now 07/08 only carry "UAT verification scripted by
      demo-feedback/27; pending the live run".*

## Out of Scope

Escalation dial (#352), engine settings (#353/#354). Any code change to Freeze (a failure becomes a bug story).

## Technical Notes

Freeze path: `PausePill.tsx` → `POST /api/steering/pause-tier` → `PauseTierRegistry` → `PauseOverlayPublisher`
(`OverlayStateChanged`) → `overlayState.ts` / `OverlayLayer.tsx`. Participant test login via `New-DemoParticipant.ps1`
or a roster link.

## Dependencies

18 for step 4 only.

## Tests

`scripts/uat/Test-FreezeResume.Tests.ps1` (Pester 5, 35 tests) runs the real script against a simulated API: a fake
wall clock (no real waiting), the pause tier and its scenario clock, the overlay, the noise knob (a post every 30 s
stamped with scenario time), the inject queue with the Freeze fire refusal (DELETE checks `version`), staff tokens
(a restart can drop them: 401), and an App Service restart whose handover shows as a failing `/health` and clears
in-memory state unless Freeze is persisted.

- Pass path: exits 0, every check PASS, tier / noise level / pool / test inject all back as found, every session
  signed out; the noise pool is authored by the explicit `-NoisePersonaHandle`; without it there are zero noise writes
  (WARN) and the other freeze signals still run; the out-of-fiction register; the staff secret never appears.
- Minute moved across the Freeze → FAIL. Overlay never shows pause → FAIL. Fire refused for another reason → FAIL.
- Tier always restored: a step that throws mid-hold (found tier `engine`, `running`, `injects`; the inject, noise and
  pool are cleaned up too) and an overlay read throwing right after Freeze; a restore POST answering 500 or throwing
  → the loud "COULD NOT RESTORE ... set the Pause pill back ... NOW" FAIL and exit 1; already-frozen and not-live
  exercises are refused before any write.
- Cleanup failures are FAILs with a manual step: inject DELETE, noise-level restore, pool clear; a create whose
  response was lost is found by title and deleted.
- Demo exercise: refused when the name lookup lands on it; with an explicit `-ExerciseId` (compared as a GUID) there
  are zero noise writes and the overlay is read as the participant; a participant on another exercise falls back to
  the staff read with a WARN; a missing "Freeze check" exercise fails cleanly.
- `-IncludeRestart`: refused before 18 unless `-Force`, including a 17-only deploy (the `persisted` contract field
  present, persistence absent); Freeze restored with the wrong clock anchor (backwards or forwards) → FAIL on the
  fresh post-restart noise post, or WARN "unverified" without `-NoisePersonaHandle`, never PASS; with `-Force` before 18, FAIL "expected until
  demo-feedback/18 is deployed"; with 18 and an observed restart, PASS; transport exceptions in the wait loop and a
  401 after the restart (re-sign-in) are survived; no observed restart → WARN "persistence not proven".
- `-WhatIf` is a dry run: prints the plan, sends nothing (no sign-in, Freeze, noise, probe or restart).

Run: `Invoke-Pester scripts/uat/Test-FreezeResume.Tests.ps1 -Output Detailed`. The UAT run itself is the evidence.

## Script notes

- **Scenario minute.** No staff GET returns the server's current scenario minute (the console header's clock is
  browser-local, `pausableExerciseClock.ts`). The script reads the server clock through `clockFrozen` on
  `GET /api/steering/pause-tier` and `lastPostedAt` on `GET /api/staff/noise` (the max scenario time over the
  exercise's noise posts, i.e. the server clock's stamp on the latest one). Continuity after Resume = the first noise
  post's scenario time minus the pre-Freeze anchor post's, less the running (unfrozen) wall time; within ±60 s passes.
- **Demo exercise.** Run against it only with an explicit `-ExerciseId`. It then makes no noise change at all, so no
  test post can reach the customer-demo feed; the post-Resume continuity check is a WARN "not run on the demo
  exercise" and the run relies on `clockFrozen`, the overlay, the fire refusal and read-only noise reads. Without
  `-ExerciseId` the script signs in on the demo exercise only to read the controller's assignments.
- **Overlay.** `GET /api/overlay-state`. Participant sessions are host-bound (`SessionAuthenticationMiddleware`), so
  a participant can read only the exercise bound to the API host (the demo exercise). Against the throwaway
  "Freeze check" exercise the overlay is read through the controller's session (same projection) with a WARN.
- **Fire refusal.** A skipped `[freeze check]` post item (so it can never publish), fired mid-hold: expects `409` with
  the `InjectQueueService.FrozenMessage` detail. Deleted at the end.
- **Personas.** The staff persona projection exposes neither a participant binding nor `castable`, and roster
  participants get citizen personas (`CitizenPersonaFactory`), so the script never guesses an NPC: noise writes
  (pool and level) happen only with an explicit `-NoisePersonaHandle`; without it they are skipped with a WARN. The
  fire-probe inject (skipped first, so it never publishes) uses that handle, else the first persona outside
  `-ExcludePersonaHandle` (default `KestrelCoEM`).
- **`lastPostedAt` caveat.** After an earlier clock reset (a pre-18 restart, a re-seed at minute 0) older noise posts
  can carry a later scenario time than the live clock, so the max can sit still; run on an exercise whose clock has
  not been reset since its last noise post.
- **Restart.** `-IncludeRestart` restarts the whole UAT API (every exercise, demo included): it asks for confirmation
  (ConfirmImpact High) and refuses unless 18 is detected or `-Force`. Detection: a non-destructive GET of story 18's
  POST-only `/api/steering/runtime-state/reset` (405 = route exists = 18; 404/other = pre-18; never POSTed). The
  `persisted` field is not used: story 17 adds it, defaulting to true, before persistence exists. A PASS needs an
  observed restart (a failing `/health` during the wait); otherwise WARN. Clock continuity across the restart is
  measured from a fresh noise post after the Resume (needs `-NoisePersonaHandle`, non-demo); unchanged counts while
  down only show nothing posted, so without a fresh post it is WARN "unverified".

## Manual check (two browsers, Tom signs in)

Pending Tom's UAT run. Use the demo exercise (participant sessions are host-bound) or the throwaway exercise from a
staff preview; restore the tier afterwards.

- [ ] Browser A: controller console (`/staff/console`). Browser B (fresh profile/private window): participant
      signed in (`/login`), on the feed.
- [ ] Console Pause pill → Freeze: the guarded **"Confirm freeze"** step appears before anything changes; cancel once
      and confirm nothing happened in B.
- [ ] Freeze, **in-fiction** register: B shows the holding page live (no refresh), "We'll be right back".
      Screenshot B.
- [ ] Resume: the holding page leaves B live; the feed continues; the console clock continues from the frozen minute.
- [ ] Freeze, **out-of-fiction** register: B shows the out-of-fiction notice ("EXERCISE PAUSED"). Screenshot B.
- [ ] Resume, and set the pill back to the tier it was in before the check (never leave it Frozen).
- [ ] Attach both screenshots to the readiness PR; then `pwsh scripts/uat/Test-FreezeResume.ps1` (and
      `-IncludeRestart` once 18 is deployed) output alongside.
