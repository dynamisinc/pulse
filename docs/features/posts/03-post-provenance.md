# Story: Post provenance & telemetry

**Feature:** Posts  ·  **Epic:** E2  ·  **Phase:** 1  ·  **Status:** Complete
**Requirements:** SOC-003 (XC-004, COR-018, COR-053)  ·  **Design decisions:** R-003 (staff-side display)  ·  **Issue:** #94

## Context
Every post records: author persona/participant (including the **individual human** behind a shared org
account, COR-018), created wall-clock time, exercise scenario time (from the native clock, COR-050),
and origin (participant / controller-as-persona / adaptive engine / fired inject). **Origin is never
participant-visible** — but it is deliberately **staff-visible**: the console renders it as an
always-visible origin line on every post card (R-003, live-monitoring/01). Participant-visible
timestamps render in **scenario time** (SOC-003, COR-053).

## Acceptance Criteria
- [x] Every post persists author, **acting human** (COR-018), created wall-clock time, scenario time,
      and origin (participant / controller-as-persona / engine / inject).
- [x] The persisted provenance is rich enough to drive the console's R-003 origin line without
      inference: the origin enum maps to the console vocabulary (**ENGINE · AUTO** /
      **SIMCELL-n · MANUAL**), an inject-fired post stores its **MSEL inject id** (rendered
      **INJ-nnn**, matching the fired timeline item), and the fired time is the post's scenario
      timestamp.
- [x] Origin is **never** exposed on any participant surface (XC-002) — a participant cannot tell a
      controller/engine post from a peer's.
- [x] Participant-visible timestamps (absolute + "2h ago") render in **scenario time** in the exercise
      time zone (COR-053); wall-clock is telemetry-only.
- [x] Each post creation emits an XC-004 telemetry event carrying these fields, feeding E10.

## Out of Scope
Composition UI (story 01); rendering (story 02); the amplification-chain reconstruction (amplification
SOC-022); the telemetry schema definition itself (E1 XC-004 v0).

## Technical Notes
Participant world render + backend provenance. Consumes the scenario-time utility (COR-053) and the
telemetry emitter (XC-004). See implementation.md (story 03).

## Dependencies
E1 exercise-clock (COR-050/053), telemetry (XC-004), identity-auth-roles (COR-018). Underpins E10
metrics + E7 monitoring.

## Tests
Delivered: `features/social/{types/post.ts,services/postService.ts,services/sanitize.ts}` +
`core/time/wallClock.ts`.

- `features/social/services/postService.test.ts` — `createPost` persists author, acting human, a
  wall-clock timestamp bounded by the surrounding `wallClockNowIso()` calls, the verbatim scenario
  time, and origin (incl. `injectId` on an `inject`-origin post); sanitizes text on ingest (NFR-004);
  emits exactly one XC-004 `'post'` telemetry event with the full envelope (actor incl.
  `actingHumanId`, origin, wall + scenario time, time zone, target) and never throws even when
  telemetry validation would reject the event; `actor.kind` stays `'persona'` across every origin
  (participant/controller-as-persona/engine/inject) so provenance lives only in `origin`, not
  `actor.kind`; a shift handoff on the same shared persona attributes each post to its own
  `actingHumanId` (COR-018). `toParticipantView` (XC-002) strips `origin`, `actingHumanId`,
  `createdWallClock`, and `injectId` — verified both on freshly-created posts and on the real seeded
  fixtures — leaving the exact participant-safe key set. `originConsoleLabel` (R-003) maps
  `engine`→`ENGINE · AUTO`, `controller-as-persona`→`SIMCELL · MANUAL`, `participant`→`PARTICIPANT`,
  and `inject`→`INJ-<injectId>` (with a safe `INJ-unknown` fallback), verified against every real
  seeded post including the fired inject (`INJ-042`).
- `features/social/services/sanitize.test.ts` — `<script>`/`onerror` payloads strip to inert text;
  ordinary punctuation (`& " '`) survives unchanged (no double-encode).
- `core/time/wallClock.test.ts` — `wallClockNowIso()` returns a well-formed, monotonically-advancing
  ISO-8601 UTC instant reflecting real time (this file is explicitly exempt from the participant
  wall-clock ESLint ban since it verifies the telemetry-only helper itself).

All ACs above are met by this suite; both orchestration code-review gates clean.
