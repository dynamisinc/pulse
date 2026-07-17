/**
 * Telemetry — public barrel (XC-004 v0)
 * =======================================
 *
 * Pure `core/` module: the v0 telemetry envelope (schema), an emitter that
 * builds + validates an event, and a mock sink (buffer + dev-console log +
 * best-effort mocked POST). No UI, no COBRA, no participant skin, no
 * participant-facing read path. See `docs/features/telemetry/` for the
 * feature/story docs this implements.
 *
 * Typical usage (from a future caller, e.g. a compose action) — use the
 * caller-safe `buildAndEmit`, which never throws into the caller's action:
 *
 * ```ts
 * import { buildAndEmit } from '@/core/telemetry'
 *
 * buildAndEmit({
 *   exerciseId,               // from useExerciseContext() — not this module's concern
 *   eventType: 'post',
 *   channel: 'social',
 *   actor: { kind: 'participant', participantId },
 *   wallClockTime: new Date().toISOString(),
 *   scenarioTime,              // from scenarioNow() — not this module's concern
 *   timeZone,                  // from useExerciseContext() — not this module's concern
 *   target: { entityType: 'post', entityId: postId },
 * })
 * ```
 *
 * `buildTelemetryEvent` + `emitTelemetryEvent` remain exported for callers that
 * want the throwing build (e.g. tests). Do NOT use the unguarded
 * `emitTelemetryEvent(buildTelemetryEvent(...))` form in feature code — a build
 * error would surface into the caller's action; use `buildAndEmit` instead.
 */

export {
  telemetryEventV0Schema,
  telemetryChannelSchema,
  telemetryActorKindSchema,
  telemetryOriginSchema,
  telemetryActorSchema,
  telemetryTargetSchema,
  KNOWN_TELEMETRY_EVENT_TYPES,
} from './schema'
export type {
  TelemetryEventV0,
  TelemetryChannel,
  TelemetryActorKind,
  TelemetryOrigin,
  TelemetryActor,
  TelemetryTarget,
  KnownTelemetryEventType,
} from './schema'

export {
  buildTelemetryEvent,
  buildAndEmit,
  generateEventId,
  TelemetryValidationError,
} from './emitter'
export type { BuildTelemetryEventInput, TelemetryValidationIssue } from './emitter'

export {
  emitTelemetryEvent,
  getEmittedTelemetryEvents,
  resetTelemetryBuffer,
  getTelemetryHealth,
  noteTelemetryDrop,
} from './mockSink'
export type { TelemetryHealth } from './mockSink'
