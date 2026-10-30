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
 * Until the guard has a current answer it renders a quiet, accessible busy
 * placeholder rather than a premature not-found: on a cold cache, and when the
 * cached set says "disabled" while the mount's refetch is still in flight (a
 * planner may just have enabled it). A cached "enabled" renders at once; if the
 * refetch says otherwise the guard switches to not-found, and the server 404s
 * the channel's API meanwhile.
 *
 * **Staff preview passes** (AC "staff are not blocked"): inside a staged staff
 * "Preview as participant" (`useOptionalPreview()`), the channel renders
 * whatever the enabled set, matching the server filter's staff bypass, so a
 * planner can preview a channel before enabling it. Only the preview context is
 * read; nothing staff-world is rendered.
 *
 * World: participant. No COBRA, no MUI.
 */

import type { ReactNode } from 'react'
import { useOptionalPreview } from '@/features/staffShell/previewContext'
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
  const preview = useOptionalPreview()
  const { status, isEnabled, isRefreshing } = useEnabledChannels()

  if (preview?.active) return <>{children}</>

  const enabled = isEnabled(channelId)
  const pending = status === 'loading' || (!enabled && isRefreshing)

  if (pending) {
    return (
      <div role="status" style={{ minHeight: '50vh', padding: '48px 16px' }}>
        <span style={visuallyHidden}>Loading…</span>
      </div>
    )
  }

  return enabled ? <>{children}</> : <ChannelNotFound />
}

const visuallyHidden = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
} as const
