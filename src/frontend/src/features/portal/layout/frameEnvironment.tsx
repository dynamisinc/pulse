/**
 * features/portal/layout/frameEnvironment.tsx
 * ---------------------------------------------------------------------------
 * The frame environment providers (see frameEnvironmentContext.ts):
 * `LivePortalFrameEnvironment` wires F08 enablement and PC-6 telemetry;
 * `PortalFrameEnvironmentProvider` supplies an explicit one (the subset
 * harness, tests). World: participant. No visible UI.
 */

import { useMemo, type ReactNode } from 'react'
import { useEnabledChannels } from '@/features/channels/routing'
import { PortalFrameEnvironmentContext, type PortalFrameEnvironment } from './frameEnvironmentContext'
import { usePortalModuleClickTelemetry } from './moduleClickTelemetry'

export interface PortalFrameEnvironmentProviderProps {
  readonly value: PortalFrameEnvironment
  readonly children: ReactNode
}

/** Provides an explicit environment (the subset harness, tests). */
export function PortalFrameEnvironmentProvider(
  { value, children }: PortalFrameEnvironmentProviderProps,
) {
  return (
    <PortalFrameEnvironmentContext.Provider value={value}>
      {children}
    </PortalFrameEnvironmentContext.Provider>
  )
}

/** The real environment: F08 enablement and PC-6 telemetry. */
export function LivePortalFrameEnvironment({ children }: { readonly children: ReactNode }) {
  const enabled = useEnabledChannels()
  const trackClick = usePortalModuleClickTelemetry()
  const value = useMemo<PortalFrameEnvironment>(() => ({
    isChannelEnabled: enabled.isEnabled,
    channelsKnown: enabled.status === 'ready',
    trackClick,
  }), [enabled, trackClick])
  return <PortalFrameEnvironmentProvider value={value}>{children}</PortalFrameEnvironmentProvider>
}
