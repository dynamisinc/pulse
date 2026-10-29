/**
 * features/portal/contract/telemetry.ts
 * ---------------------------------------------------------------------------
 * PC-6, the portal's telemetry target and payload shapes (exercise-portal
 * story 02, #768). The event-type STRINGS are registered once by
 * channels-foundation story 02 in `KNOWN_TELEMETRY_EVENT_TYPES` (FC-6b); this
 * file only declares, per event, who emits it and what `target` / `payload`
 * carry, and edits neither list (`eventType` is typed as a registered name,
 * so an unregistered one is a type error). The TS twin of
 * `Features/Portal/Contracts/PortalTelemetry.cs`, both pinned to
 * `portalWireContract.json`.
 *
 * The v0 envelope is unchanged; `channel` is `portal` for all of them. The two
 * `display_*` events are Deferred with the display sessions (Q-35): nothing
 * emits them in December.
 *
 * World: both (types only). No React, no MUI.
 */

import type { KnownTelemetryEventType } from '@/core/telemetry/schema'

export interface PortalTelemetryShape {
  readonly eventType: KnownTelemetryEventType
  readonly emitter: 'client' | 'server'
  /** The `target.entityType`. */
  readonly entityType: 'portal' | 'portal_module' | 'portal_resource' | 'display'
  /** Whether `target.entityId` is set. */
  readonly hasEntityId: boolean
  /** The keys `payload` may carry; none means `payload` is omitted. */
  readonly payloadKeys: readonly string[]
  /** Registered but not emitted in December (Q-35). */
  readonly deferred: boolean
}

/** Every PC-6 shape, in PC-6 order. */
export const PORTAL_TELEMETRY_SHAPES = [
  // client (17): once per mount per session
  { eventType: 'portal_view', emitter: 'client', entityType: 'portal', hasEntityId: false, payloadKeys: [], deferred: false },
  // client (07 `trackClick`): entityId = the module id; payload.contentId optional
  {
    eventType: 'portal_module_click', emitter: 'client', entityType: 'portal_module', hasEntityId: true,
    payloadKeys: ['contentId'], deferred: false,
  },
  // client (15): entityId = the resource id
  {
    eventType: 'resource_view', emitter: 'client', entityType: 'portal_resource', hasEntityId: true,
    payloadKeys: [], deferred: false,
  },
  // server (03): actor = the staff human; entityId = the PortalConfig row id;
  // payload.fields = changed field NAMES, never values
  {
    eventType: 'portal_config_changed', emitter: 'server', entityType: 'portal', hasEntityId: true,
    payloadKeys: ['fields'], deferred: false,
  },
  // Deferred (08): payload.command
  {
    eventType: 'display_command', emitter: 'server', entityType: 'display', hasEntityId: true,
    payloadKeys: ['command'], deferred: true,
  },
  // Deferred (05): no person attribution (PRT-041); needs a `display` actor kind the
  // v0 envelope does not have yet, so story 05 adds it first
  {
    eventType: 'display_session_started', emitter: 'server', entityType: 'display', hasEntityId: true,
    payloadKeys: [], deferred: true,
  },
] as const satisfies readonly PortalTelemetryShape[]

export type PortalTelemetryEventType = (typeof PORTAL_TELEMETRY_SHAPES)[number]['eventType']

/** The payload a portal CLIENT event carries (undefined = no payload). */
export interface PortalClientTelemetryPayloads {
  readonly portal_view: undefined
  readonly portal_module_click: { readonly contentId?: string } | undefined
  readonly resource_view: undefined
}
