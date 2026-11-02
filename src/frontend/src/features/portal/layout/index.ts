/**
 * features/portal/layout — PC-5 `layout/` (exercise-portal story 07, #772):
 * the module registry, the `anchor` grid and the section frame every module
 * renders through. See README.md for the module contract.
 *
 * The subset harness is test-only and NOT exported here: import it from
 * `@/features/portal/layout/testing`.
 */

export { PortalLayout } from './PortalLayout'
export { placePortalModules } from './placeModules'
export type { PlacedPortalModule } from './placeModules'
export type { PortalLayoutProps } from './PortalLayout'
export { ModuleFrame } from './ModuleFrame'
export type { ModuleFrameProps } from './ModuleFrame'
export { ModuleLink } from './ModuleLink'
export type { ModuleLinkProps } from './ModuleLink'
export {
  createPortalModuleRegistry,
  listPortalModules,
  portalModuleRegistry,
  registerPortalModule,
} from './registry'
export type { PortalModuleRegistry } from './registry'
export { LivePortalFrameEnvironment, PortalFrameEnvironmentProvider } from './frameEnvironment'
export type { PortalFrameEnvironmentProviderProps } from './frameEnvironment'
export { usePortalFrameEnvironment } from './frameEnvironmentContext'
export type { PortalFrameEnvironment } from './frameEnvironmentContext'
export { usePortalModuleClickTelemetry } from './moduleClickTelemetry'
export { PORTAL_CHANNEL_HOME_PATHS, channelHomePath } from './channelHome'
export { MODULE_FRAME_STATUSES, PORTAL_REGIONS } from './types'
export type {
  ModuleFrameStatus,
  PortalModuleClickTarget,
  PortalModuleProps,
  PortalModuleRegistration,
  PortalRegion,
} from './types'
