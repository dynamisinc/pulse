/**
 * Telemetry emitter — v0 (XC-004)
 * ================================
 *
 * `buildTelemetryEvent` constructs + validates a `TelemetryEventV0` from a
 * caller-assembled partial (everything except the two fields the emitter
 * stamps — `eventId` and `emittedAt`). It **throws** `TelemetryValidationError`
 * on an invalid envelope; call it directly only where you want that throw
 * (tests, or a caller that has already guarded).
 *
 * `buildAndEmit` is the **blessed** call path for feature code: it builds,
 * validates, and emits, and it **never throws** — a validation or id-generation
 * failure is swallowed (and counted, see `getTelemetryHealth`) and it returns
 * `null`. Telemetry must never break the caller's action: a post/reaction must
 * never fail *because* telemetry failed to build or send. The sink already
 * swallows send failures; `buildAndEmit` closes the same guarantee at the build
 * step (the unguarded `emit(build(...))` pattern would re-open it).
 *
 * Decoupling note (Wave 0): this module does not read `exerciseId`, `timeZone`,
 * or `scenarioTime` from anywhere — it does not import `core/exerciseContext`
 * or `core/clock`. Callers assemble those values and pass them in.
 */

import { telemetryEventV0Schema, type TelemetryEventV0 } from './schema'
import { emitTelemetryEvent, noteTelemetryDrop } from './mockSink'

/**
 * Input to `buildTelemetryEvent`: the full v0 envelope minus the fields the
 * builder stamps itself (`eventId`, `emittedAt`). `schemaVersion` is optional
 * here — it defaults to the locked `'v0'` literal.
 */
export type BuildTelemetryEventInput = Omit<
  TelemetryEventV0,
  'eventId' | 'emittedAt' | 'schemaVersion'
> & {
  schemaVersion?: 'v0'
}

/** A single validation failure surfaced by `buildTelemetryEvent`. */
export interface TelemetryValidationIssue {
  /** Path segments into the event, e.g. `['actor', 'participantId']`. */
  path: PropertyKey[]
  message: string
}

/**
 * Thrown by `buildTelemetryEvent` when the assembled event fails v0 envelope
 * validation (e.g. a missing/empty `exerciseId`, an unknown `channel`, or a
 * conditional-attribution rule). A typed error so callers/tests can inspect
 * `issues` without re-parsing a message string.
 */
export class TelemetryValidationError extends Error {
  readonly issues: TelemetryValidationIssue[]

  constructor(message: string, issues: TelemetryValidationIssue[]) {
    super(message)
    this.name = 'TelemetryValidationError'
    this.issues = issues
  }
}

/**
 * Generates a unique event id. Prefers `crypto.randomUUID()`, but that is
 * **secure-context-only** — plain-HTTP LAN/venue deploys (COR-008/COR-009) may
 * not expose it — so it falls back to a `getRandomValues` UUIDv4 and, last, a
 * non-crypto id. Id availability must never depend on the deployment transport.
 */
export function generateEventId(): string {
  const c: Crypto | undefined = globalThis.crypto
  if (c?.randomUUID) return c.randomUUID()
  if (c?.getRandomValues) {
    const b = c.getRandomValues(new Uint8Array(16))
    b[6] = (b[6] & 0x0f) | 0x40 // version 4
    b[8] = (b[8] & 0x3f) | 0x80 // variant 10
    const hex = Array.from(b, byte => byte.toString(16).padStart(2, '0'))
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    )
  }
  // Last resort (no Web Crypto at all) — still unique enough for dedup.
  return `evt-${Date.now().toString(16)}-${Math.random().toString(16).slice(2, 10)}`
}

/**
 * Builds and validates a v0 telemetry event. Stamps `schemaVersion` (if not
 * supplied), a fresh `eventId`, and `emittedAt` (now, ISO-8601 UTC), then
 * validates the full envelope against `telemetryEventV0Schema`.
 *
 * @throws {TelemetryValidationError} if the assembled event is invalid. Prefer
 *   `buildAndEmit` in feature code — it never throws into the caller's action.
 */
export function buildTelemetryEvent(partial: BuildTelemetryEventInput): TelemetryEventV0 {
  const candidate = {
    ...partial,
    // Stamped AFTER the spread so an explicit `schemaVersion: undefined` in the
    // input can't overwrite the locked literal (as with eventId / emittedAt).
    schemaVersion: 'v0' as const,
    eventId: generateEventId(),
    emittedAt: new Date().toISOString(),
  }

  const result = telemetryEventV0Schema.safeParse(candidate)

  if (!result.success) {
    const issues: TelemetryValidationIssue[] = result.error.issues.map(issue => ({
      path: issue.path,
      message: issue.message,
    }))
    throw new TelemetryValidationError(
      'Invalid telemetry event: failed v0 envelope validation',
      issues,
    )
  }

  return result.data
}

/**
 * The blessed, caller-safe path: build + validate + emit, **never throwing**.
 * Returns the emitted event, or `null` if it could not be built/validated — the
 * failure is counted via `noteTelemetryDrop` so a dead pipeline is observable
 * (a telemetry failure must never surface to, or block, the caller's action).
 */
export function buildAndEmit(partial: BuildTelemetryEventInput): TelemetryEventV0 | null {
  let event: TelemetryEventV0
  try {
    event = buildTelemetryEvent(partial)
  } catch (error) {
    noteTelemetryDrop('build', error)
    return null
  }
  emitTelemetryEvent(event)
  return event
}
