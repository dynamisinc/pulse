/**
 * Telemetry mock sink — v0 (XC-004)
 * ==================================
 *
 * There is no telemetry backend yet, so `emitTelemetryEvent` writes to a
 * **mock sink**: an in-memory buffer (test-inspectable via
 * `getEmittedTelemetryEvents` / `resetTelemetryBuffer`), a dev-console log,
 * and a best-effort POST through the shared axios client
 * (`core/services/api.ts`) to a mocked `/telemetry` endpoint.
 *
 * The POST is genuinely fire-and-forget: there is no real endpoint behind
 * it yet, so a network/mock failure is swallowed and must never throw back
 * into the caller's action (posting/reacting/etc. must never fail *because*
 * telemetry failed to send).
 *
 * This module only accepts an already-validated `TelemetryEventV0` — build
 * one with `buildTelemetryEvent` (see `emitter.ts`) before calling
 * `emitTelemetryEvent`.
 */

import { api } from '@/core/services/api'
import type { TelemetryEventV0 } from './schema'

/** In-memory buffer of every event emitted this session. Test-inspectable only. */
const buffer: TelemetryEventV0[] = []

/**
 * Emits a validated v0 telemetry event to the mock sink:
 * 1. appends it to the in-memory buffer,
 * 2. logs it to the dev console, and
 * 3. best-effort POSTs it to a mocked `/telemetry` endpoint via the shared
 *    axios client.
 *
 * Never throws — a POST/network failure (there is no real backend yet) is
 * swallowed so telemetry can never block or fail the caller's action.
 */
export function emitTelemetryEvent(event: TelemetryEventV0): void {
  buffer.push(event)

  // Dev-console only: keep telemetry noise — and actor identities — out of
  // production browser consoles.
  if (import.meta.env.DEV) {
    console.info(`[telemetry] ${event.eventType}`, event)
  }

  // Best-effort, fire-and-forget. Swallow BOTH an async rejection and any
  // synchronous throw from the client, so a telemetry send can never surface
  // to (or block) the caller's action. No real backend exists yet.
  try {
    void api.post('/telemetry', event).catch(() => {
      /* swallowed — see above */
    })
  } catch {
    /* swallowed — see above */
  }
}

/**
 * Returns a snapshot (shallow copy) of every event emitted this session, in
 * emission order. For test inspection — do not mutate the returned array to
 * affect the underlying buffer.
 */
export function getEmittedTelemetryEvents(): readonly TelemetryEventV0[] {
  return [...buffer]
}

/** Clears the in-memory buffer. For test isolation between cases. */
export function resetTelemetryBuffer(): void {
  buffer.length = 0
}
