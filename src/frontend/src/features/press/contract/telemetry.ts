/**
 * features/press/contract/telemetry.ts
 * ---------------------------------------------------------------------------
 * PC-5, the press room's telemetry payload shapes (press-room story 01, #738).
 * The event-type STRINGS are registered once in `KNOWN_TELEMETRY_EVENT_TYPES`
 * (FC-6b); this file only declares, per event, who emits it and which keys its
 * `payload` carries, and edits neither list (`eventType` is typed as a
 * registered name, so an unregistered one is a type error). The TS twin of
 * `Features/Press/Contracts/PressTelemetry.cs`, both pinned to
 * `pressWireContract.json`.
 *
 * `press_release` is the shared funnel's event (one per publish); the others
 * are emitted by the press server slices. Nothing here is emitted from the
 * browser, and no payload carries release text or a wall-clock value.
 *
 * World: both (types only). No React, no MUI.
 */

import type { KnownTelemetryEventType } from '@/core/telemetry/schema'

export interface PressTelemetryShape {
  readonly eventType: KnownTelemetryEventType
  /** `funnel` is the shared content-publish funnel; `server` a press slice. */
  readonly emitter: 'server' | 'funnel'
  /** The keys `payload` may carry. */
  readonly payloadKeys: readonly string[]
}

/** Every press shape, in golden-file order. */
export const PRESS_TELEMETRY_SHAPES = [
  {
    eventType: 'press_release', emitter: 'funnel',
    payloadKeys: [
      'kind', 'inputPath', 'crossPost', 'embargoed', 'approvalRequired', 'draftStartedScenarioTime',
      'draftToPublishSec', 'revisionCountAtPublish', 'orgPersonaId',
    ],
  },
  { eventType: 'press_draft_created', emitter: 'server', payloadKeys: ['orgPersonaId', 'inputPath'] },
  { eventType: 'press_embargo_set', emitter: 'server', payloadKeys: ['scheduledScenarioTime', 'orgPersonaId'] },
  {
    eventType: 'press_embargo_cancelled', emitter: 'server',
    payloadKeys: ['scheduledScenarioTime', 'orgPersonaId', 'approversNotified'],
  },
  {
    eventType: 'press_approval_requested', emitter: 'server',
    payloadKeys: ['approvalId', 'approverHumanId', 'noteLength', 'latencySec'],
  },
  {
    eventType: 'press_approval_approved', emitter: 'server',
    payloadKeys: ['approvalId', 'approverHumanId', 'noteLength', 'latencySec'],
  },
  {
    eventType: 'press_approval_returned', emitter: 'server',
    payloadKeys: ['approvalId', 'approverHumanId', 'noteLength', 'latencySec'],
  },
] as const satisfies readonly PressTelemetryShape[]

export type PressTelemetryEventType = (typeof PRESS_TELEMETRY_SHAPES)[number]['eventType']
