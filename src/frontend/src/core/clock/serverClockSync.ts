/**
 * core/clock/serverClockSync.ts
 * ---------------------------------------------------------------------------
 * Keeps {@link serverExerciseClock} in step with the server for ONE exercise
 * (fix/noise-new-posts-clock; contract section 5). A non-React driver, started
 * and stopped by `ServerClockMount.tsx` (the component that keys it by the active
 * exercise id).
 *
 * `startServerClockSync()`:
 *   - installs the server clock as the active `IExerciseClock`;
 *   - READS `GET /clock` on start, on every realtime reconnect, and every ~60s;
 *   - applies `ScenarioClockChanged` pushes from the SHARED realtime connection
 *     (`subscribe` on `core/realtime`, never a second connection);
 *   - on stop (unmount, exercise switch, sign-out) detaches everything, resets the
 *     clock to the wall clock and restores the default clock — and any read still
 *     in flight is DROPPED, so the exercise just left cannot answer into the next.
 *
 * Ordering: a push that lands while a read is in flight is NEWER than the read, so
 * the read is discarded rather than overwriting it. An unreachable/malformed read
 * leaves the last applied state in place (the clock keeps running from it); before
 * any state ever landed it is the wall clock, i.e. today's behaviour.
 *
 * Mock mode never starts this (see `ServerClockMount.tsx`): no network call.
 */

import { api } from '@/core/services/api'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import type { RealtimeConnection } from '@/core/realtime/connection'
import { getExerciseClock, resetExerciseClock, setExerciseClock } from './exerciseClock'
import {
  parseScenarioClockState,
  serverExerciseClock,
  type ScenarioClockState,
  type ServerExerciseClock,
} from './serverClock'

/** The hub event the server pushes after every Start / Freeze / Unfreeze / Jump / restore. */
export const SCENARIO_CLOCK_CHANGED_EVENT = 'ScenarioClockChanged'

/** Periodic resync cadence (a backstop for a missed push). */
export const CLOCK_RESYNC_INTERVAL_MS = 60_000

/** Result of one read: the state and the measured round trip. */
export interface ScenarioClockRead {
  readonly state: ScenarioClockState
  readonly roundTripMs: number
}

/**
 * Reads `GET /clock`. Throws on a failed request or a malformed body (the caller
 * keeps the previous state). Timed with the wall clock for the latency correction.
 */
export async function fetchScenarioClock(
  wallNowMs: () => number = Date.now,
): Promise<ScenarioClockRead> {
  const sentAt = wallNowMs()
  const response = await api.get<unknown>('/clock')
  const roundTripMs = Math.max(0, wallNowMs() - sentAt)
  const state = parseScenarioClockState(response.data)
  if (state === null) throw new Error('fetchScenarioClock: malformed clock body')
  return { state, roundTripMs }
}

/** Whether a push frame names `exerciseId` (case-insensitive: a GUID's casing is not identity). */
function frameIsFor(payload: unknown, exerciseId: string): boolean {
  if (typeof payload !== 'object' || payload === null) return false
  const id = (payload as { exerciseId?: unknown }).exerciseId
  return typeof id === 'string' && id.toLowerCase() === exerciseId.toLowerCase()
}

/** Dependencies, overridable in tests. */
export interface ServerClockSyncOptions {
  readonly clock?: ServerExerciseClock
  readonly connection?: RealtimeConnection
  readonly read?: () => Promise<ScenarioClockRead>
  readonly resyncIntervalMs?: number
}

/**
 * Starts syncing for `exerciseId`; returns the stop function. The server scopes the read to
 * the session's exercise; a push frame carries its `exerciseId` and one that is missing or
 * differs from the keyed id is dropped WITHOUT bumping `pushSeq` (so it cannot discard an
 * in-flight read). The caller (`ServerClockMount`) re-keys by exercise id.
 */
export function startServerClockSync(
  exerciseId: string,
  options: ServerClockSyncOptions = {},
): () => void {
  const clock = options.clock ?? serverExerciseClock
  const connection = options.connection ?? realtimeConnection
  const read = options.read ?? (() => fetchScenarioClock())
  const intervalMs = options.resyncIntervalMs ?? CLOCK_RESYNC_INTERVAL_MS

  let stopped = false
  /** Bumped on every applied push: a read that began before it is stale. */
  let pushSeq = 0
  let hadGap = false

  clock.reset()
  setExerciseClock(clock)

  const resync = (): void => {
    const pushSeqAtStart = pushSeq
    read().then(
      ({ state, roundTripMs }) => {
        // Dropped: this sync belongs to an exercise that has been left (or torn down).
        if (stopped) return
        // Dropped: a push newer than this read has already been applied.
        if (pushSeq !== pushSeqAtStart) return
        clock.apply(state, roundTripMs / 2)
      },
      () => {
        // Unreachable: keep whatever was last applied (wall clock if nothing was).
      },
    )
  }

  const offPush = connection.subscribe(SCENARIO_CLOCK_CHANGED_EVENT, payload => {
    if (stopped) return
    if (!frameIsFor(payload, exerciseId)) return
    const state = parseScenarioClockState(payload)
    if (state === null) return
    pushSeq += 1
    clock.apply(state)
  })
  const offState = connection.onStateChange((state, reason) => {
    if (stopped) return
    if (state !== HubConnectionState.Connected) {
      // A deliberate stop is the session reset's doing, not a missed-push window.
      if (reason !== 'stopped') hadGap = true
      return
    }
    if (!hadGap) return
    hadGap = false
    resync()
  })
  connection.start().catch(() => {
    // The periodic read still carries the clock while the hub is down (NFR-003).
  })
  const timer = setInterval(resync, intervalMs)
  resync()

  return () => {
    stopped = true
    offPush()
    offState()
    clearInterval(timer)
    clock.reset()
    if (getExerciseClock() === clock) resetExerciseClock()
  }
}
