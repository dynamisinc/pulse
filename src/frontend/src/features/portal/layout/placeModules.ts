/**
 * features/portal/layout/placeModules.ts
 * ---------------------------------------------------------------------------
 * Which modules `PortalLayout` mounts, and where (story 07, #772; D2-005):
 * the stored order of `PortalDto.modules`, an id listed twice once, an id
 * with no registered module skipped, and (once the enabled set is known) a
 * module whose source channel is off dropped. World: participant. No UI.
 */

import type { PortalModuleDto, PortalModuleId } from '../contract'
import type { PortalModuleRegistry } from './registry'
import type { PortalModuleRegistration, PortalRegion } from './types'

export interface PlacedPortalModule {
  readonly registration: PortalModuleRegistration
  readonly region: PortalRegion
}

/**
 * The modules to mount, per region, in stored order. Pass `null` for
 * `isChannelEnabled` while the enabled set is unknown (trust the server list).
 */
export function placePortalModules(
  modules: readonly PortalModuleDto[],
  registry: PortalModuleRegistry,
  isChannelEnabled: ((channelId: string) => boolean) | null,
): Readonly<Record<PortalRegion, readonly PlacedPortalModule[]>> {
  const placed: Record<PortalRegion, PlacedPortalModule[]> = { lead: [], rail: [] }
  const seen = new Set<PortalModuleId>()
  for (const entry of modules) {
    if (seen.has(entry.id)) continue
    seen.add(entry.id)
    const registration = registry.get(entry.id)
    if (!registration) continue
    if (isChannelEnabled && !isChannelEnabled(registration.channelId)) continue
    placed[registration.region].push({ registration, region: registration.region })
  }
  return placed
}
