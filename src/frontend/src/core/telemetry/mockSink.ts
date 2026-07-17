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
 * Emits a validated v0 telemetry event to the mock sink:
 * 1. appends it to the bounded in-memory buffer,
 * 2. logs it to the dev console (DEV only — keeps identities out of prod
 *    consoles), and
 * 3. best-effort POSTs it to a mocked `/telemetry` endpoint via the shared
 *    axios client.
 *
 * Never throws — a POST/network failure (or a synchronous throw from the
 * client) is swallowed and counted so it can never block the caller's action.
 */
export function emitTelemetryEvent(event: TelemetryEventV0): void {
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

/** Clears the buffer and resets counters. For test isolation between cases. */
export function resetTelemetryBuffer(): void {
  buffer.length = 0
  emittedCount = 0
  droppedCount = 0
  loggedDropInProd = false
}
