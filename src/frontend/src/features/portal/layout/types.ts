/**
 * features/portal/layout/types.ts
 * ---------------------------------------------------------------------------
 * The portal layout seam (exercise-portal story 07, #772; PC-5). Module stories
 * 09-15 build against these types, so they are STABLE: change them additively
 * only (a new optional field), never by renaming or narrowing.
 *
 * World: participant (types only). No React runtime, no MUI.
 */

import type { ComponentType } from 'react'
import type { PortalModuleChannelId, PortalModuleId } from '../contract'

/**
 * The `anchor` layout's two regions (D2-003): `lead` is the hero + card grid
 * column, `rail` the 336 px right rail (folded under the lead below 1024 px).
 */
export const PORTAL_REGIONS = ['lead', 'rail'] as const
export type PortalRegion = (typeof PORTAL_REGIONS)[number]

/**
 * What a module link activation reports (PC-6 `portal_module_click`). The
 * module id is the event's `target.entityId`; `contentId` (when the link opens
 * one content item) becomes `payload.contentId`. Nothing else is sent.
 */
export interface PortalModuleClickTarget {
  readonly contentId?: string
}

/** The props `PortalLayout` passes every registered module component. */
export interface PortalModuleProps {
  readonly moduleId: PortalModuleId
  /** The region the module is mounted in (a module may render denser in the rail). */
  readonly region: PortalRegion
  /**
   * Reports one activation of a link or control inside this module (PC-6).
   * Bound to `moduleId`. `ModuleLink` calls it for you; call it directly only
   * for a non-link control. Modules never call the telemetry emitter themselves.
   */
  readonly trackClick: (target?: PortalModuleClickTarget) => void
}

/**
 * One module's registration (`registerPortalModule`, PC-5). Each module
 * story registers exactly one from its `modules/<id>/register.ts`.
 */
export type PortalModuleRegistration = {
  readonly [M in PortalModuleId]: {
    readonly id: M
    /** Must equal the module's PC-1 source channel (checked at registration). */
    readonly channelId: PortalModuleChannelId<M>
    readonly region: PortalRegion
    /**
     * The module's default position (lower first), used where no stored order
     * exists (`listPortalModules`, the console's defaults). On a page the
     * stored order in `PortalDto.modules` always wins.
     */
    readonly order: number
    /** Renders the module. It must render through `ModuleFrame`. */
    readonly Component: ComponentType<PortalModuleProps>
    /** Optional kiosk slide rendering (the slides player is Deferred, Q-35). */
    readonly DisplaySlide?: ComponentType<PortalModuleProps>
  }
}[PortalModuleId]

/**
 * The state a module hands `ModuleFrame`. `empty` and `error` hide the whole
 * module, heading and "See all" link included (D2-005, fail closed).
 */
export const MODULE_FRAME_STATUSES = ['loading', 'ready', 'empty', 'error'] as const
export type ModuleFrameStatus = (typeof MODULE_FRAME_STATUSES)[number]
