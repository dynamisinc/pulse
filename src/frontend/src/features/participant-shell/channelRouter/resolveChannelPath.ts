/**
 * features/participant-shell/channelRouter/resolveChannelPath.ts
 * ---------------------------------------------------------------------------
 * The pure path resolution behind `<ChannelRouter>` (channels-foundation 12,
 * #708), shared with the shell nav (`useNavigableChannels`) so the routes and
 * the nav cannot disagree about which channel a URL is in. See
 * `ChannelRouter.tsx` for what each resolution renders.
 *
 * World: participant. No UI.
 */

import { findChannelForPath, type ChannelRegistration } from '@/features/channels/routing'

/** First segments the router leaves alone: they live outside the session shell. */
export const OUTSIDE_SHELL_SEGMENTS: readonly string[] = ['display']

/** What a participant path resolves to. Pure, so the nav and the tests share it. */
export type ChannelPathResolution =
  | { readonly kind: 'outside-shell' }
  | { readonly kind: 'landing' }
  | { readonly kind: 'channel'; readonly channel: ChannelRegistration }
  | { readonly kind: 'not-found' }

/** Resolves `pathname` against the registered channels (see the module header). */
export function resolveChannelPath(
  pathname: string,
  registered: readonly ChannelRegistration[],
): ChannelPathResolution {
  const segment = (pathname.split('/')[1] ?? '').toLowerCase()
  if (OUTSIDE_SHELL_SEGMENTS.includes(segment)) return { kind: 'outside-shell' }
  if (pathname === '/' || pathname === '') return { kind: 'landing' }
  const channel = findChannelForPath(pathname, registered)
  if (channel === undefined) return { kind: 'not-found' }
  if (channel.pathPrefix === '/' && channel.claimsPath && !channel.claimsPath(pathname)) {
    return { kind: 'not-found' }
  }
  return { kind: 'channel', channel }
}
