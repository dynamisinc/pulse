/**
 * features/portal/layout/registry.ts
 * ---------------------------------------------------------------------------
 * The portal module registry (exercise-portal story 07, #772; PRT-003, PC-5).
 *
 * A module story registers itself once (`registerPortalModule` from its
 * `modules/<id>/register.ts`) and `PortalLayout` mounts it with no change to
 * layout code. Registering a second module for an id throws: two modules fighting over
 * one slot is a wiring bug, never a runtime choice. So does a `channelId`
 * that is not the module's PC-1 source channel, because enablement (F08)
 * hides a module by that channel.
 *
 * `createPortalModuleRegistry()` builds an isolated registry (the test harness
 * uses one so tests never touch the app's). World: participant. No UI.
 */

import { PORTAL_MODULE_CHANNELS, isPortalModuleId, type PortalModuleId } from '../contract'
import { PORTAL_REGIONS, type PortalModuleRegistration } from './types'

export interface PortalModuleRegistry {
  /** Adds a module. Throws on a duplicate id or a malformed registration. */
  readonly register: (registration: PortalModuleRegistration) => void
  readonly get: (id: PortalModuleId) => PortalModuleRegistration | undefined
  /** Every registration, by `order` (then id, so ties are stable). */
  readonly list: () => readonly PortalModuleRegistration[]
}

function assertValid(registration: PortalModuleRegistration): void {
  const { id, channelId, region, order } = registration
  if (!isPortalModuleId(id)) {
    throw new Error(`registerPortalModule: '${String(id)}' is not a portal module id (PC-1)`)
  }
  if (PORTAL_MODULE_CHANNELS[id] !== channelId) {
    throw new Error(
      `registerPortalModule: '${id}' must use channel '${PORTAL_MODULE_CHANNELS[id]}', not '${String(channelId)}'`,
    )
  }
  if (!(PORTAL_REGIONS as readonly string[]).includes(region)) {
    throw new Error(`registerPortalModule: '${id}' has unknown region '${String(region)}'`)
  }
  if (!Number.isFinite(order)) {
    throw new Error(`registerPortalModule: '${id}' needs a finite order`)
  }
}

export interface PortalModuleRegistryOptions {
  /**
   * Replace an existing id instead of throwing. Only for the dev server's hot
   * reload, which re-runs a `register.ts` with a fresh component.
   */
  readonly replaceDuplicates?: boolean
}

export function createPortalModuleRegistry(
  options: PortalModuleRegistryOptions = {},
): PortalModuleRegistry {
  const entries = new Map<PortalModuleId, PortalModuleRegistration>()
  return {
    register: registration => {
      assertValid(registration)
      const existing = entries.get(registration.id)
      if (existing) {
        // The very same component again (one module reached by two import paths) is a no-op.
        if (existing.Component === registration.Component) return
        if (!options.replaceDuplicates) {
          throw new Error(`registerPortalModule: module '${registration.id}' is already registered`)
        }
      }
      entries.set(registration.id, registration)
    },
    get: id => entries.get(id),
    list: () => [...entries.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id)),
  }
}

/**
 * The app's registry, the one `PortalLayout` uses unless given another. Under
 * the dev server's hot reload a re-run `register.ts` replaces its entry;
 * everywhere else (build, tests) a second module for one id throws.
 */
export const portalModuleRegistry: PortalModuleRegistry = createPortalModuleRegistry({
  replaceDuplicates: import.meta.hot !== undefined && import.meta.env.MODE !== 'test',
})

/** Registers a module in the app registry (PC-5). Throws on a duplicate id. */
export function registerPortalModule(registration: PortalModuleRegistration): void {
  portalModuleRegistry.register(registration)
}

/** Every module registered in the app registry, by default order. */
export function listPortalModules(): readonly PortalModuleRegistration[] {
  return portalModuleRegistry.list()
}
