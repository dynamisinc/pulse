/**
 * features/portal/layout/frameEnvironmentContext.ts
 * ---------------------------------------------------------------------------
 * The two things a module frame needs from outside the portal: whether a
 * channel is enabled (for the "See all" link, F08) and how to report a click
 * (PC-6 `portal_module_click`). Both sit behind one context so the subset
 * harness can supply a fake and module tests need no global mocks.
 *
 *  - `LivePortalFrameEnvironment` (frameEnvironment.tsx) is the real one.
 *    `PortalLayout` mounts it itself when no environment is above it.
 *  - Outside any environment the frame fails closed: no "See all" link and no
 *    telemetry, never a link to a channel that may be off.
 *
 * World: participant. No UI.
 */

import { createContext, useContext } from 'react'
import type { PortalModuleChannelId, PortalModuleId } from '../contract'
import type { PortalModuleClickTarget } from './types'

export interface PortalFrameEnvironment {
  /** Whether `channelId` is enabled now. `false` while unknown (fail closed). */
  readonly isChannelEnabled: (channelId: PortalModuleChannelId) => boolean
  /** `true` once the enabled set is known (before that, trust the server's module list). */
  readonly channelsKnown: boolean
  /** `ModuleFrame.trackClick(moduleId, target)`: one PC-6 event per call. */
  readonly trackClick: (moduleId: PortalModuleId, target?: PortalModuleClickTarget) => void
}

export const PortalFrameEnvironmentContext =
  createContext<PortalFrameEnvironment | undefined>(undefined)

const CLOSED_ENVIRONMENT: PortalFrameEnvironment = {
  isChannelEnabled: () => false,
  channelsKnown: false,
  trackClick: () => {},
}

/** The surrounding environment, or `undefined` when none is mounted. */
export function useOptionalPortalFrameEnvironment(): PortalFrameEnvironment | undefined {
  return useContext(PortalFrameEnvironmentContext)
}

/** The surrounding environment, or the fail-closed one. */
export function usePortalFrameEnvironment(): PortalFrameEnvironment {
  return useContext(PortalFrameEnvironmentContext) ?? CLOSED_ENVIRONMENT
}
