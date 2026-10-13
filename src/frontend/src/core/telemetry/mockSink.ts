/**
 * Telemetry mock sink — v0 (XC-004)
 * ==================================
 *
 * There is no telemetry backend yet, so `emitTelemetryEvent` writes to a
 * **mock sink**: a bounded in-memory buffer (test-inspectable via
 * `getEmittedTelemetryEvents` / `resetTelemetryBuffer`), a dev-console log, and
 * a best-effort POST through the shared axios client (`core/services/api.ts`)
 * to a mocked `/telemetry` endpoint.
 *
 * The POST is genuinely fire-and-forget: a network/mock failure is swallowed
 * and must never throw back into the caller's action (posting/reacting must
 * never fail *because* telemetry failed to send). But swallowing ≠ hiding — a
 * drop is **counted** and surfaced (see `getTelemetryHealth` / `noteTelemetryDrop`)
 * so a fully-dead pipeline isn't invisible: telemetry is the sole feed for the
 * (procurement-gating) AAR.
 *
 * This module only accepts an already-validated `TelemetryEventV0` — build one
 * with `buildTelemetryEvent` / `buildAndEmit` (see `emitter.ts`).
 *
 * Precedent note: the REAL sink must batch (+ `navigator.sendBeacon` on unload,
 * for `logout`/unload events), dedupe on `eventId`, and MUST NOT retain
 * unbounded event history client-side (NFR-007: telemetry about named
 * government personnel is a record). This mock deliberately caps its buffer.
 */

import { api } from '@/core/services/api'
import type { TelemetryEventV0 } from './schema'

/**
 * Max events retained in the in-memory inspection buffer. Bounded so a long,
 * high-rate exercise (NFR-002: 120 posts/min plus views/reactions) can't grow
 * this without limit or retain actor identities for the whole session.
 */
const MAX_BUFFER = 500

/** Bounded in-memory buffer of recently-emitted events. Test-inspectable only. */
const buffer: TelemetryEventV0[] = []
let emittedCount = 0
let droppedCount = 0
let loggedDropInProd = false

/**
 * How many holders currently have telemetry muted (see {@link muteTelemetry}).
 * A COUNT, not a boolean, so two overlapping holders (or a StrictMode
 * mount/unmount/mount) cannot unmute each other early.
 */
let muteDepth = 0

/**
 * Silences the sink until the returned release function is called: while any
 * holder is muted, `emitTelemetryEvent` neither buffers, logs, counts nor POSTs.
 * The release is idempotent (a second call is a no-op), so a cleanup that runs
 * twice can never unmute somebody else's hold.
 *
 * The ONE caller is the staff "preview as participant" (demo-polish C6). The
 * preview mounts the REAL participant channel inside a staff frame, and that
 * channel emits participant-kind telemetry on its own (a `view` for every feed,
 * thread and profile it opens). A preview is promised to be inert -- "Nothing
 * here reaches the exercise" -- and a staff session's `participant` events are
 * refused by the server anyway (403, counted as a degraded-pipeline drop), so
 * the preview holds a mute for as long as it is mounted rather than emit
 * telemetry about a participant who does not exist. Nothing else may call this:
 * telemetry is the sole feed for the AAR (see {@link getTelemetryHealth}).
 */
export function muteTelemetry(): () => void {
  muteDepth++
  let released = false
  return () => {
    if (released) return
    released = true
    // Never below zero: `resetTelemetryBuffer` may already have dropped this hold.
    if (muteDepth > 0) muteDepth--
  }
}

/**
 * Emits a validated v0 telemetry event to the mock sink:
 * 1. appends it to the bounded in-memory buffer,
 * 2. logs it to the dev console (DEV only — keeps identities out of prod
 *    consoles), and
 * 3. best-effort POSTs it to a mocked `/telemetry` endpoint via the shared
 *    axios client.
 *
 * Never throws — a POST/network failure (or a synchronous throw from the
 * client) is swallowed and counted so it can never block the caller's action.
 * Returns immediately, doing none of the above, while telemetry is muted
 * ({@link muteTelemetry}).
 */
export function emitTelemetryEvent(event: TelemetryEventV0): void {
  if (muteDepth > 0) return

  emittedCount++
  buffer.push(event)
  if (buffer.length > MAX_BUFFER) buffer.shift()

  if (import.meta.env.DEV) {
    console.info(`[telemetry] ${event.eventType}`, event)
  }

  // Best-effort, fire-and-forget. Swallow BOTH an async rejection and any
  // synchronous throw from the client — but count the drop (see below).
  try {
    void api.post('/telemetry', event).catch((error: unknown) => {
      noteTelemetryDrop('send', error)
    })
  } catch (error) {
    noteTelemetryDrop('send', error)
  }
}

/**
 * Records a dropped telemetry event — a build failure (`emitter.buildAndEmit`)
 * or a send failure. Never affects the caller's action; it only increments a
 * counter and, once, surfaces a prod-visible error so a fully-dead pipeline is
 * observable at hotwash (COR-054) rather than silently empty.
 */
export function noteTelemetryDrop(reason: 'build' | 'send', error?: unknown): void {
  droppedCount++
  if (import.meta.env.DEV) {
    console.warn(`[telemetry] dropped (${reason})`, error)
  } else if (!loggedDropInProd) {
    loggedDropInProd = true
    console.error('[telemetry] event(s) dropped — telemetry pipeline degraded')
  }
}

/** Health snapshot for a controller/dev surface (NFR-003 degraded-mode signal). */
export interface TelemetryHealth {
  /** Events accepted by the sink this session. */
  emitted: number
  /** Events dropped (build or send failure) this session. */
  dropped: number
  /** Events currently retained in the bounded buffer. */
  buffered: number
}

/** Returns a health snapshot of the telemetry pipeline. */
export function getTelemetryHealth(): TelemetryHealth {
  return { emitted: emittedCount, dropped: droppedCount, buffered: buffer.length }
}

/**
 * Returns a snapshot (shallow copy) of the buffered events, in emission order.
 * For test inspection — mutating the returned array does not affect the buffer.
 */
export function getEmittedTelemetryEvents(): readonly TelemetryEventV0[] {
  return [...buffer]
}

/**
 * Clears the buffer, resets counters, and drops every mute hold. For test
 * isolation between cases (a hold leaked by a case that never unmounted must not
 * silence the next one).
 */
export function resetTelemetryBuffer(): void {
  buffer.length = 0
  emittedCount = 0
  droppedCount = 0
  loggedDropInProd = false
  muteDepth = 0
}
