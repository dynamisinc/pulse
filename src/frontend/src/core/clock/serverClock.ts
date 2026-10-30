/**
 * core/clock/serverClock.ts
 * ---------------------------------------------------------------------------
 * The SERVER-SYNCED exercise clock (fix/noise-new-posts-clock; contract
 * `GET /api/clock` + SignalR `ScenarioClockChanged`). A pure data source: no
 * React, no network, no realtime — `serverClockSync.ts` feeds it.
 *
 * ## Why one clock
 * Server-stamped posts (noise, injects, engine) carry the server's
 * `IExerciseClock` time, which lags the wall clock after every Freeze. Posts
 * made over HTTP used to be stamped with the CLIENT's `scenarioNow()` (the wall
 * clock), so they sorted above everything the server stamped. There is now ONE
 * clock, the server's; this is the client's view of it.
 *
 * ## The three states
 *   - NOT STARTED / UNREACHABLE (nothing applied yet, or `started: false`):
 *     `scenarioNow()` is the wall clock and `mirrorsWallClock` is true — exactly
 *     today's behaviour, so the participant dateline still renders nothing.
 *   - RUNNING: `scenarioNow() = Date.now() + offset`, with
 *     `offset = scenarioTime - serverTime` (the contract's formula).
 *   - FROZEN: `scenarioNow()` is the constant `scenarioTime`.
 *
 * ## Offset, interpreted (contract section 5)
 * The offset is anchored on the instant the state was RECEIVED on this client,
 * not on `serverTime`: `offset = scenarioTime + latencyMs - receivedAtLocalMs`.
 * With synchronised clocks that is the contract's `scenarioTime - serverTime`
 * (plus the half-round-trip correction for a GET read); with a skewed client
 * clock it is still right, which `Date.now() - serverTime` is not. `latencyMs`
 * is half the measured round trip for a GET read, and 0 for a push (which has
 * no request to time).
 *
 * ## Optimistic local freeze (controller Pause)
 * `optimisticFreeze()` / `optimisticResume()` flip the clock locally the instant
 * the controller acts, so the header clock stops at once. The override lasts
 * only until the NEXT applied server state (the push, or a read), which always
 * wins; `clearOptimistic()` drops it early (the server refused the change).
 *
 * The wall source is injectable so tests assert the math without real timing.
 */

import { getExerciseClock } from './exerciseClock'
import type { IExerciseClock } from './exerciseClock'

/** The `GET /api/clock` body and the `ScenarioClockChanged` payload (same shape). */
export interface ScenarioClockState {
  /** The clock has been Start()ed for this exercise. */
  readonly started: boolean
  /** The clock is frozen (held). */
  readonly frozen: boolean
  /** ISO-8601 UTC scenario instant; `null` when not started. */
  readonly scenarioTime: string | null
  /** ISO-8601 UTC server wall instant at the same read. */
  readonly serverTime: string
}

/** Narrows an unknown wire body to a {@link ScenarioClockState}, or `null` when malformed. */
export function parseScenarioClockState(value: unknown): ScenarioClockState | null {
  if (typeof value !== 'object' || value === null) return null
  const body = value as Record<string, unknown>
  const { started, frozen, scenarioTime, serverTime } = body
  if (typeof started !== 'boolean' || typeof frozen !== 'boolean') return null
  if (typeof serverTime !== 'string' || Number.isNaN(Date.parse(serverTime))) return null
  if (scenarioTime === null || scenarioTime === undefined) {
    if (started) return null
    return { started, frozen, scenarioTime: null, serverTime }
  }
  if (typeof scenarioTime !== 'string' || Number.isNaN(Date.parse(scenarioTime))) return null
  return { started, frozen, scenarioTime, serverTime }
}

/** The server clock plus the controls `serverClockSync` and the pause machine use. */
export interface ServerExerciseClock extends IExerciseClock {
  subscribe(listener: () => void): () => void
  /** Adopts a server state (read or push). `latencyMs` = half the round trip for a read. */
  apply(state: ScenarioClockState, latencyMs?: number): void
  /** Forgets everything: back to the wall clock (an exercise switch / teardown). */
  reset(): void
  /** Hold the clock at its current instant until the next applied server state. */
  optimisticFreeze(): void
  /** Run the clock from its current instant until the next applied server state. */
  optimisticResume(): void
  /** Drop an optimistic override (the server refused): back to the last server state. */
  clearOptimistic(): void
  /** Whether scenario time is currently held (server state or optimistic override). */
  readonly isFrozen: boolean
  /** Whether a started server clock has been applied (false = wall clock). */
  readonly isSynced: boolean
}

/** Options for {@link createServerExerciseClock}. */
export interface ServerExerciseClockOptions {
  /** Wall source in epoch ms; default `Date.now`. */
  readonly wallNowMs?: () => number
}

/** Internal anchor: frozen at `heldMs`, or running as `wall + offsetMs`. */
type Anchor =
  | { readonly kind: 'wall' }
  | { readonly kind: 'frozen'; readonly heldMs: number }
  | { readonly kind: 'running'; readonly offsetMs: number }

/** Tolerance (ms) under which a re-applied state counts as unchanged (read jitter). */
const UNCHANGED_TOLERANCE_MS = 50

/** Same anchor kind and the same held/anchored instant within the tolerance. */
function sameAnchor(a: Anchor, b: Anchor): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === 'frozen' && b.kind === 'frozen') {
    return Math.abs(a.heldMs - b.heldMs) <= UNCHANGED_TOLERANCE_MS
  }
  if (a.kind === 'running' && b.kind === 'running') {
    return Math.abs(a.offsetMs - b.offsetMs) <= UNCHANGED_TOLERANCE_MS
  }
  return true
}

/** Creates an isolated server clock (the app uses {@link serverExerciseClock}). */
export function createServerExerciseClock(
  options: ServerExerciseClockOptions = {},
): ServerExerciseClock {
  const wallNowMs = options.wallNowMs ?? (() => Date.now())
  let server: Anchor = { kind: 'wall' }
  let optimistic: Anchor | null = null
  const listeners = new Set<() => void>()

  const notify = (): void => {
    for (const listener of Array.from(listeners)) listener()
  }
  const current = (): Anchor => optimistic ?? server
  const nowMs = (anchor: Anchor): number => {
    if (anchor.kind === 'frozen') return anchor.heldMs
    if (anchor.kind === 'running') return wallNowMs() + anchor.offsetMs
    return wallNowMs()
  }

  return {
    get mirrorsWallClock(): boolean {
      return current().kind === 'wall'
    },
    get isFrozen(): boolean {
      return current().kind === 'frozen'
    },
    get isSynced(): boolean {
      return server.kind !== 'wall'
    },

    scenarioNow(): Date {
      return new Date(nowMs(current()))
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },

    apply(state: ScenarioClockState, latencyMs = 0): void {
      let next: Anchor
      if (!state.started || state.scenarioTime === null) {
        next = { kind: 'wall' }
      } else if (state.frozen) {
        next = { kind: 'frozen', heldMs: Date.parse(state.scenarioTime) }
      } else {
        const receivedAtMs = wallNowMs()
        next = {
          kind: 'running',
          offsetMs: Date.parse(state.scenarioTime) + Math.max(0, latencyMs) - receivedAtMs,
        }
      }
      const hadOverride = optimistic !== null
      const unchanged = sameAnchor(server, next)
      optimistic = null
      // An unchanged state (the periodic resync) keeps the existing anchor and wakes nobody,
      // unless it just cancelled an optimistic override (the visible clock moved back).
      if (unchanged && !hadOverride) return
      if (!unchanged) server = next
      notify()
    },

    reset(): void {
      server = { kind: 'wall' }
      optimistic = null
      notify()
    },

    optimisticFreeze(): void {
      // Reverting an earlier optimistic resume first: the server state is the base.
      optimistic = null
      if (server.kind !== 'frozen') optimistic = { kind: 'frozen', heldMs: nowMs(server) }
      notify()
    },

    optimisticResume(): void {
      // Undoing an optimistic freeze (a refused Freeze) lands back on the SERVER's state,
      // which is still running, not on a clock resumed from the stale held instant.
      optimistic = null
      if (server.kind === 'frozen') {
        optimistic = { kind: 'running', offsetMs: server.heldMs - wallNowMs() }
      }
      notify()
    },

    clearOptimistic(): void {
      if (optimistic === null) return
      optimistic = null
      notify()
    },
  }
}

/** The single ambient server clock `serverClockSync` installs for a bound exercise. */
export const serverExerciseClock: ServerExerciseClock = createServerExerciseClock()

/** Whether the server clock is the ACTIVE exercise clock (a bound live session). */
export function isServerClockInstalled(): boolean {
  return getExerciseClock() === serverExerciseClock
}
