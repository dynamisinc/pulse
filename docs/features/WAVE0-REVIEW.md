# Wave 0 — Adversarial review & codified precedents

> Wave 0 (foundation seams: exercise-context, scenario-time, XC-004 telemetry v0) passed both
> orchestration gates, then got a deliberate **adversarial, precedent-setting** review — because this
> is the first wave and its patterns propagate to every later wave. This doc records the precedents
> that review codified (now enforced in code/tests/lint), what the remediation changed, and what was
> deliberately deferred. Future waves should treat the **Precedents** section as binding.

## Precedents codified (binding for later waves)

### Telemetry (XC-004)
1. **Envelope-level vs event-type data.** Cross-cutting metadata lives in **named envelope fields**,
   never in `payload`. The v0 envelope now reserves (optional) `correlationId` (groups one logical
   operation), `causationId` (the `eventId` of the direct parent — amplification/rumor lineage),
   `sequence` (per-source ordering tiebreaker), and `source` (producing emitter). `payload` is *only*
   for event-type-specific data; each event-type family should ship a companion payload schema.
2. **Ordering authority.** Client wall-clock timestamps are **never** a cross-client total order
   (skew, ms ties, and COR-051 scenario-time jumps make them unreliable). `sequence` is a best-effort
   client tiebreaker; **server ingest order is the authority** — decide this before EVL-003 replay.
3. **Attribution is enforced by the schema, not convention.** A `superRefine` requires
   `participantId`/`personaId` by actor kind, `actingHumanId` for `controller-as-persona` (COR-018),
   `injectId` for `inject`, and `participantId`-or-`sessionId` for view events (COR-015). Nested
   `actor`/`target` are `strictObject` so a typo'd id fails loudly instead of being silently dropped.
4. **Telemetry never breaks the caller — at the build step too.** The blessed path is `buildAndEmit`,
   which never throws (build/validate/emit failures are swallowed **and counted**). The unguarded
   `emitTelemetryEvent(buildTelemetryEvent(...))` form is banned in feature code.
5. **ID generation is transport-independent.** `generateEventId()` falls back from
   `crypto.randomUUID()` (secure-context-only) to `getRandomValues` to a non-crypto id — never throws
   on a plain-HTTP LAN deploy (COR-008/009). `eventId` is the dedup/idempotency key.
6. **Swallow the failure, never the signal.** Send/build drops increment a counter and surface once in
   prod (`getTelemetryHealth`), so a dead pipeline is visible at hotwash — telemetry is the sole AAR feed.
7. **Bounded client retention.** The sink buffer is capped (no unbounded growth / PII retention,
   NFR-007). The real sink must batch + `sendBeacon` on unload + dedupe on `eventId` (see Deferred).

### Scenario time (COR-053)
8. **Relative age is pure instant arithmetic** on the millisecond delta — never calendar math
   (`intervalToDuration`), which computes in the runtime's local zone and made the same two instants
   render differently across a DST boundary / per browser. The passed `timeZone` affects
   absolute/dateline only. (Enforced by a DST-crossing regression test.)
9. **One "now" per render pass.** Relative rendering takes an injected reference (`opts.now`, or the
   hook's single snapshot) — never a per-row global re-read.
10. **Invalid instants degrade, never throw.** A bad instant renders `''`, never a `RangeError` into a
    participant tree.
11. **Wall-clock can't leak by accident.** The default `timeZone` is **UTC** (loud) not a real region
    (silent-wrong); a **lint rule bans `Date.now()`/`new Date()` on participant surface paths**
    (`src/features/{social,portal,news,press,weather,participant-shell}/**`). Staff surfaces are exempt.
12. **The clock contract is jump/pause-aware and swappable.** `IExerciseClock` reserves an optional
    `subscribe()` (story 01's real clock notifies on jumps/pause; the mock polls) and must be
    exercise-scoped.

### Isolation
13. **`exerciseId` is a display/telemetry field, NOT a query-scoping param.** Query isolation is
    enforced **server-side** (COR-001). A participant request must never carry a client-supplied
    `exerciseId` — that is the cross-exercise-leak vector. (Documented on `ExerciseScope`.)
14. **`status` is not a render-safety signal.** A resolved scope ≠ "safe to show live content";
    lifecycle gating (archived/scheduled/complete) is story 04/06.
15. **One env-guarded mock flip point.** Mock data is switched in exactly one place
    (`USE_MOCK_EXERCISE_CONTEXT`), never per-call, so a forgotten `adapter:` can't fail *open* to mock
    data in prod. Prod without a backend fails **closed**.
16. **The isolation gate is deliberately hand-rolled (not React Query).** RQ's cache/refetch/retry
    fight fail-closed semantics. RQ remains the default for ordinary cacheable data; the isolation
    gate is the documented exception.

### Testing & conventions
17. **No tautological tests.** A test must fail if the code under test breaks (never assert logic
    defined inside the test). One distinct failure mode per test; the name matches the case.
18. **Scenario-time regressions are pinned by divergent system-vs-scenario clocks**, not a `Date.now`
    spy alone (catches a bare `new Date()` leak too).
19. **Every mock-backed seam ships both** a boundary-mocked branch test **and** an un-mocked
    shipped-path test (e.g. `exerciseContextResolver.default.test.ts`).
20. **Isolation-sensitive modules assert the ABSENCE of forbidden surface** (no picker/list/admin
    exports) rather than exact export equality (fails for the reason that matters, COR-004).
21. **Enforce mechanically what can't be unit-tested yet** (the participant wall-clock lint ban).
22. **`core/` capability = its own folder once it exceeds one file** (`core/exerciseContext/`).
23. `@typescript-eslint/no-non-null-assertion` is now an error project-wide — guard, don't `!`.

## What this remediation changed
- Telemetry: reserved 4 envelope fields; nested `strictObject`; conditional-attribution `superRefine`;
  `generateEventId` fallback; caller-safe `buildAndEmit`; bounded buffer + `getTelemetryHealth`/drop counter.
- Scenario time: pure-`diffMs` relative (fixes the DST/zone bug + removes dead units); invalid-instant
  guard; `opts.now` + one-now-per-render hook; UTC default; poll-only-on-change; immutable `scenarioNow`;
  reserved `IExerciseClock.subscribe`.
- Isolation: precedent docs (13–16); single env-guarded flip point; foldered into `core/exerciseContext/`.
- Tooling: `no-non-null-assertion` (+ fixed `main.tsx`); participant wall-clock lint ban.
- Tests: 89 → 142; fixed 1 tautological + 1 redundant + 1 brittle export test; added DST/TZ-purity,
  invalid-instant, one-now-per-render, poll/subscribe, superRefine, nested-strict, reserved-fields,
  `buildAndEmit`, health, bounded-buffer, and crypto-absent id coverage.

## Deliberately deferred (need their own PR / a later wave)
- **`noUncheckedIndexedAccess` / `exactOptionalPropertyTypes`** — high-value, but they surface errors
  across the existing evaluator feature (array-heavy) and this seam; enabling cleanly needs a dedicated
  codebase-wide fix pass, not this foundation PR.
- **Real telemetry transport** — batching, `navigator.sendBeacon` on unload (so `logout`/unload events
  aren't dropped), and `eventId` dedup on retry. The v0 mock's per-event POST is fine until the backend
  lands; the real sink must adopt these (precedent 7).
- **Branded `ScenarioInstant` type** — would make wall-clock un-passable at the type level; deferred as
  speculative with no consumers yet (the lint ban covers the participant-path risk for now).
- **Convergence of `features/evaluator/services/scenarioTime.ts`** (a parallel elapsed-minutes model)
  onto this canonical instant-based utility — tracked for when that surface is next touched.
