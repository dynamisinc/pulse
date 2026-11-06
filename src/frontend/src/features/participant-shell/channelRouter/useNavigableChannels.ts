/**
 * features/participant-shell/channelRouter/useNavigableChannels.ts
 * ---------------------------------------------------------------------------
 * The channels the shell's `ChannelNav` may offer, and where each goes
 * (channels-foundation 12, nav-agreement AC; COR-060). One rule for the nav
 * and the router: a channel is navigable when it is ENABLED (the shell nav
 * config, the same cache entry `useEnabledChannels` reads) AND REGISTERED (a
 * route exists for it). A disabled channel is in neither; an enabled channel
 * whose feature has not registered is left out of the nav rather than offered
 * as a door to a not-found.
 *
 * Before any channel registers (a unit test of the nav alone; nothing composes
 * the router there) the nav keeps its config-only behaviour: every enabled
 * channel, no destination.
 *
 * World: participant. No UI.
 */

import { useMemo } from 'react'
import {
  channelNavPath,
  useRegisteredChannels,
  type ChannelRegistration,
} from '@/features/channels/routing'
import type { ChannelNavChannel } from '../channelNavConfig'
import { resolveChannelPath } from './resolveChannelPath'

/** A nav entry: the config channel plus its destination (`undefined`: not routable). */
export interface NavigableChannel extends ChannelNavChannel {
  readonly navPath: string | undefined
}

/** Filters the enabled `channels` to the registered ones, with their nav paths. */
export function toNavigableChannels(
  channels: readonly ChannelNavChannel[],
  registered: readonly ChannelRegistration[],
): readonly NavigableChannel[] {
  if (registered.length === 0) return channels.map(channel => ({ ...channel, navPath: undefined }))
  const byId = new Map<string, ChannelRegistration>(registered.map(r => [r.id, r]))
  return channels.flatMap(channel => {
    const registration = byId.get(channel.id)
    return registration ? [{ ...channel, navPath: channelNavPath(registration) }] : []
  })
}

/** What the nav renders. */
export interface NavigableChannels {
  readonly channels: readonly NavigableChannel[]
  /** `true` once channels are registered: entries navigate and the URL marks the current one. */
  readonly routed: boolean
  /** Routed only: the channel the URL is in (`undefined` on the landing entry or a not-found). */
  readonly currentChannelId: string | undefined
}

/** The enabled, registered channels for the nav at `pathname` (see the module header). */
export function useNavigableChannels(
  channels: readonly ChannelNavChannel[],
  pathname: string,
): NavigableChannels {
  const registered = useRegisteredChannels()
  return useMemo(() => {
    const resolution = resolveChannelPath(pathname, registered)
    return {
      channels: toNavigableChannels(channels, registered),
      routed: registered.length > 0,
      currentChannelId: resolution.kind === 'channel' ? resolution.channel.id : undefined,
    }
  }, [channels, registered, pathname])
}
