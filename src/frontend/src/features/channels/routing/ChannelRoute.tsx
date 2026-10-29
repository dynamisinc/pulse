/**
 * features/channels/routing/ChannelRoute.tsx
 * ---------------------------------------------------------------------------
 * `<ChannelRoute channelId>` — the client route guard of the channel
 * enablement gate (channels-foundation 08, #704; PRT-003, D2-005). Wraps a
 * channel's route element: an enabled channel renders its children, a
 * disabled one renders the participant-world `ChannelNotFound`, never a COBRA
 * 404 and never a blank page. "Disabled" means unreachable, not merely hidden:
 * the server gate (`RequireChannelEnabled`) 404s the channel's API the same way.
 *
 * While the enabled set is still loading it renders a quiet, accessible busy
 * placeholder rather than a premature not-found, so a deep link to an enabled
 * channel never flashes "Page not found".
 *
 * World: participant. No COBRA, no MUI.
 */

import type { ReactNode } from 'react'
import { ChannelNotFound } from './ChannelNotFound'
import { useEnabledChannels } from './enabled'

export interface ChannelRouteProps {
  /** The `ChannelCatalog` id this route belongs to (`news`, `press`, `weather`, `portal`, ...). */
  readonly channelId: string
  /** The channel's route element, rendered only when the channel is enabled. */
  readonly children: ReactNode
}

/** Renders `children` only when `channelId` is enabled for the resolved exercise. */
export function ChannelRoute({ channelId, children }: ChannelRouteProps) {
  const { status, isEnabled } = useEnabledChannels()

  if (status === 'loading') {
    return (
      <div role="status" aria-busy="true" aria-live="polite" style={{ minHeight: '50vh', padding: '48px 16px' }}>
        <span style={visuallyHidden}>Loading…</span>
      </div>
    )
  }

  return isEnabled(channelId) ? <>{children}</> : <ChannelNotFound />
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const
