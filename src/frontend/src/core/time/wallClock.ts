/**
 * core/time/wallClock.ts
 * ---------------------------------------------------------------------------
 * *** REAL WALL-CLOCK TIME. TELEMETRY / LOGGING ONLY. NEVER PARTICIPANT-VISIBLE. ***
 *
 * `wallClockNowIso()` returns the genuine current wall-clock instant (an
 * ISO-8601 UTC string, e.g. via `Date().toISOString()`). It exists for exactly
 * one purpose: stamping the `wallClockTime` field of a telemetry envelope
 * (`@/core/telemetry`, XC-004) and any other staff-only/forensic logging.
 *
 * WHY THIS LIVES IN `core/time/` AND NOT `features/social/`:
 * `eslint.config.js` bans bare `new Date()` / `Date.now()` across every
 * participant-surface feature folder (`src/features/social/**`, `portal`,
 * `news`, `press`, `weather`, `participant-shell`) — see the `no-restricted-
 * syntax` block there — because every participant-visible timestamp must
 * render in SCENARIO time (COR-053), never wall-clock. That ban is scoped to
 * those folders on purpose: it does NOT cover `core/**`, so there can be
 * exactly ONE clearly-named, loudly-documented call site for real wall-clock
 * time, instead of every feature quietly reinventing (or accidentally
 * leaking) its own `new Date()`.
 *
 * DO NOT add another bare `new Date()` / `Date.now()` anywhere under
 * `src/features/social/**` (or any other participant surface). If you need a
 * real wall-clock instant for telemetry/logging, import `wallClockNowIso()`
 * from here. If you need a PARTICIPANT-VISIBLE instant, you want
 * `scenarioNow()` / `formatScenarioTime()` from `@/core/clock` instead — this
 * module has no participant-facing use whatsoever.
 *
 * Precedent: mirrors the Wave-0 decoupling of `@/core/clock` and
 * `@/core/telemetry` — a small, standalone `core/` seam with no dependency on
 * exercise context or the scenario clock. Callers assemble/pass the value
 * they need; this module only sources it.
 */

/**
 * Returns the current REAL wall-clock instant as an ISO-8601 UTC string
 * (`YYYY-MM-DDTHH:mm:ss.sssZ`).
 *
 * Telemetry/logging use only — see the module header. Never call this to
 * produce a value a participant surface will render; that is always scenario
 * time (`@/core/clock`).
 */
export function wallClockNowIso(): string {
  return new Date().toISOString()
}
