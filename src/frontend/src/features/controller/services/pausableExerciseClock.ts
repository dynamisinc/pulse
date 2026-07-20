/**
 * features/controller/services/pausableExerciseClock.ts
 * ---------------------------------------------------------------------------
 * The feature-local PAUSABLE exercise clock (feature: world-steering, story 03
 * — tiered pause; CTL-023, D5-014/1.3, COR-050/053). STAFF world — a pure data
 * source: no UI, no COBRA, no React.
 *
 * ## Why this exists (Phase-0 reconciliation)
 * `@/core/clock`'s SHIPPED `IExerciseClock` contract has NO pause primitive —
 * only `scenarioNow()` + an optional `subscribe()`. Story 03 owns this second,
 * feature-local `IExerciseClock` implementation. It is the mock stand-in for
 * story-01's native pause-aware clock provider / the backend reaction-loop
 * pause (`BACKEND_ROADMAP` B3). When that lands, the later flip swaps which
 * `IExerciseClock` is installed via `setExerciseClock()` — a contract-only
 * change with no consumer edits (`useScenarioTime` already polls + subscribes
 * generically). The dependency direction stays one-way and legal:
 * `features/controller` imports `@/core/clock`; `@/core/clock` must never import
 * back into a feature.
 *
 * ## The mechanic — an accumulated-frozen OFFSET
 * Scenario time tracks wall-clock time 1:1 MINUS the total wall-time that has
 * elapsed while frozen (the offset, `accumulatedFrozenMs`):
 *
 *   - while RUNNING:  scenarioNow = wallNow − accumulatedFrozenMs
 *   - while FROZEN:   scenarioNow = frozenAtWall − accumulatedFrozenMs  (held)
 *
 * On `resume()` the just-elapsed frozen span is folded into the offset, so
 * scenario time picks up EXACTLY where it froze — no scenario time is lost and
 * none is gained (the safety invariant behind CTL-023 / COR-050). Worked:
 *   freeze at wall F  → held scenario = F − A
 *   resume at wall R  → A' = A + (R − F); scenario = R − A' = F − A  (continuous)
 *
 * ## Install-once, unfreeze-on-resume (the safety invariant)
 * `usePauseState` installs THIS clock via `setExerciseClock()` the first time a
 * Freeze happens; thereafter it stays installed and merely toggles frozen state.
 * Resume does NOT `resetExerciseClock()` back to the wall-mirroring default —
 * that would discard the offset and jump scenario time FORWARD by the frozen
 * span. Keeping this clock installed and calling `resume()` is the only way to
 * satisfy "resumes with no time lost". Injects-paused / engine-paused never
 * call `freeze()`/`resume()`, so under them `scenarioNow()` keeps advancing
 * exactly as when running.
 *
 * ## Change-notification
 * `subscribe()` lets `useScenarioTime` (which subscribes generically when the
 * active clock supports it) re-read promptly on a freeze/resume — so the
 * `staff-shell` header SCENARIO clock stops the instant the world freezes rather
 * than after the next poll. `freeze()`/`resume()` both notify.
 *
 * The wall source is injectable (`wallNowMs`, default `Date.now`) so tests can
 * assert the offset math deterministically without real timing.
 */

import type { IExerciseClock } from '@/core/clock'

/**
 * A pausable `IExerciseClock` — the base contract plus explicit freeze/resume
 * controls and a read-only `isFrozen` flag. `subscribe()` is REQUIRED here (the
 * base makes it optional) so consumers can rely on prompt change-notification.
 */
export interface PausableExerciseClock extends IExerciseClock {
  /** The current scenario-time instant (held constant while frozen). */
  scenarioNow(): Date
  /** Subscribe to freeze/resume changes; returns an unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** Freeze the world: hold `scenarioNow()` at the current instant. No-op if already frozen. */
  freeze(): void
  /** Resume: advance again from the freeze instant, losing zero scenario time. No-op if running. */
  resume(): void
  /** Whether scenario time is currently held (frozen). */
  readonly isFrozen: boolean
}

/** Options for {@link createPausableExerciseClock}. */
export interface PausableExerciseClockOptions {
  /**
   * Real wall-clock source in epoch ms. Defaults to `Date.now`. Injected so
   * tests can drive freeze/resume math against a controlled wall clock (the
   * wall-clock ban is scoped to participant folders only; this is staff).
   */
  readonly wallNowMs?: () => number
}

/**
 * Creates a fresh pausable exercise clock. Each instance owns its own offset
 * and subscriber set — `usePauseState` uses the shared module singleton below,
 * but the factory is exported so the mechanic can be unit-tested in isolation.
 */
export function createPausableExerciseClock(
  options: PausableExerciseClockOptions = {},
): PausableExerciseClock {
  const wallNowMs = options.wallNowMs ?? Date.now

  /** Total wall-time (ms) elapsed while frozen — the scenario-time offset. */
  let accumulatedFrozenMs = 0
  /** Wall instant (ms) the current freeze began, or null while running. */
  let frozenAtWallMs: number | null = null
  const listeners = new Set<() => void>()

  const notify = (): void => {
    listeners.forEach(listener => listener())
  }

  const scenarioNowMs = (): number => {
    const base = frozenAtWallMs ?? wallNowMs()
    return base - accumulatedFrozenMs
  }

  return {
    get isFrozen(): boolean {
      return frozenAtWallMs !== null
    },

    scenarioNow(): Date {
      return new Date(scenarioNowMs())
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    freeze(): void {
      if (frozenAtWallMs !== null) return
      frozenAtWallMs = wallNowMs()
      notify()
    },

    resume(): void {
      if (frozenAtWallMs === null) return
      // Fold the just-elapsed frozen span into the offset so scenario time
      // continues from exactly where it froze (no time lost, no time gained).
      accumulatedFrozenMs += wallNowMs() - frozenAtWallMs
      frozenAtWallMs = null
      notify()
    },
  }
}

/**
 * The single ambient pausable clock `usePauseState` installs on Freeze. One per
 * runtime, mirroring the Wave-0 single-ambient-clock model in `@/core/clock`.
 */
export const pausableExerciseClock: PausableExerciseClock = createPausableExerciseClock()
