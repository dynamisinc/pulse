/**
 * Telemetry emitter — v0 (XC-004)
 * ================================
 *
 * `buildTelemetryEvent` is the only supported way to construct a
 * `TelemetryEventV0`: it takes a caller-assembled partial event (everything
 * except the two fields the emitter itself stamps — `eventId` and
 * `emittedAt`), stamps them, validates the full envelope against
 * `telemetryEventV0Schema`, and either returns a valid `TelemetryEventV0` or
 * throws a `TelemetryValidationError`. It never hands back a malformed
 * event.
 *
 * Decoupling note (Wave 0): this module does not read `exerciseId`,
 * `timeZone`, or `scenarioTime` from anywhere — it does not import
 * `core/exerciseContext` or `core/clock` (the other two Wave-0 foundation
 * seams, built in parallel in isolated worktrees). Callers assemble those
 * values themselves (e.g. a future `PostCard`/compose action calls
 * `useExerciseContext()` and `scenarioNow()`/`formatScenarioTime()`) and
 * pass them into `buildTelemetryEvent`.
 */

import { telemetryEventV0Schema, type TelemetryEventV0 } from './schema'

/**
 * Input to `buildTelemetryEvent`: the full v0 envelope minus the fields the
 * builder stamps itself (`eventId`, `emittedAt`). `schemaVersion` is
 * optional here — it defaults to the locked `'v0'` literal — but may be
 * passed explicitly for clarity at call sites.
 */
export type BuildTelemetryEventInput = Omit<
  TelemetryEventV0,
  'eventId' | 'emittedAt' | 'schemaVersion'
> & {
  schemaVersion?: 'v0'
}

/** A single validation failure surfaced by `buildTelemetryEvent`. */
export interface TelemetryValidationIssue {
  /** Dot/bracket-free path segments into the event, e.g. `['actor', 'kind']`. */
  path: PropertyKey[]
  message: string
}

/**
 * Thrown by `buildTelemetryEvent` when the assembled event fails v0 envelope
 * validation (e.g. a missing/empty `exerciseId`, or an unknown `channel`).
 * A typed error rather than a bare `Error` so callers/tests can inspect
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
 * Builds and validates a v0 telemetry event.
 *
 * Stamps `schemaVersion: 'v0'` (if not already supplied), a fresh
 * `eventId` (`crypto.randomUUID()`), and `emittedAt` (now, ISO-8601 UTC),
 * then validates the full envelope against `telemetryEventV0Schema`.
 *
 * @throws {TelemetryValidationError} if the assembled event does not
 *   satisfy the v0 envelope (e.g. missing required `exerciseId`).
 */
export function buildTelemetryEvent(partial: BuildTelemetryEventInput): TelemetryEventV0 {
  const candidate = {
    schemaVersion: 'v0' as const,
    ...partial,
    eventId: crypto.randomUUID(),
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
