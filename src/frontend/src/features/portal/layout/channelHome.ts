/**
 * features/portal/layout/channelHome.ts
 * ---------------------------------------------------------------------------
 * Where a module's "See all" link goes: its source channel's home (PRT-020,
 * conflict C-1). Host-relative paths only (FC-9.3). Social is mounted at `/`
 * (channels-foundation 12); every other channel at `/{channelId}` (FC-4).
 *
 * World: participant. No UI.
 */

import type { PortalModuleChannelId } from '../contract'

export const PORTAL_CHANNEL_HOME_PATHS = {
  news: '/news',
  social: '/',
  press: '/press',
  weather: '/weather',
} as const satisfies Record<PortalModuleChannelId, string>

export function channelHomePath(channelId: PortalModuleChannelId): string {
  return PORTAL_CHANNEL_HOME_PATHS[channelId]
}
