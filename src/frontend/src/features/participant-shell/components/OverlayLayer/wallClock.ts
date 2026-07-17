/**
 * features/participant-shell/components/OverlayLayer/wallClock.ts
 * ---------------------------------------------------------------------------
 * The break-fiction wall-clock read (feature: participant-shell, story 05;
 * CTL-024/D7-003, story AC4; see
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §3).
 *
 * Break-fiction is Pulse's ONE participant-visible surface required to show
 * REAL time — the sole exception to COR-053's "scenario time only" rule.
 * `no-restricted-syntax` bans bare `new Date()` / `Date.now()` across every
 * file under `participant-shell/**` (`eslint.config.js`) precisely so that
 * exception can never spread silently; this module is the ONE place it's
 * allowed, and it exists so exactly ONE line in the whole feature carries the
 * lint exception, not every call site that needs a wall-clock read
 * (`OverlayLayer.tsx`'s `useWallClockNow` calls `readWallClockNow` below
 * instead of reading `new Date()` itself).
 *
 * World: participant (break-fiction only — see `OverlayLayer.tsx`'s module
 * header for why break-fiction is alien to both worlds by design, not a
 * violation of the participant/staff split).
 */

/**
 * Reads real wall-clock time. Never call `new Date()` / `Date.now()`
 * anywhere else in this feature — route every other "now" through
 * `@/core/clock`'s `scenarioNow()` instead (COR-053).
 */
export function readWallClockNow(): Date {
  // eslint-disable-next-line no-restricted-syntax -- CTL-024/D7-003 AC4: sole COR-053 exception.
  return new Date()
}

/**
 * Renders a wall-clock instant for the break-fiction display — deliberately
 * NOT `@/core/clock`'s `formatScenarioTime` (that utility formats SCENARIO
 * instants; reusing it here for a real instant would blur the one place this
 * feature shows real time). Uses the local browser locale/time zone —
 * break-fiction is a real-world control message, not tied to the exercise's
 * configured scenario time zone.
 */
export function formatWallClockNow(instant: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(instant)
}
