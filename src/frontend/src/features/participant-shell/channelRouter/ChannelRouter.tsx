/**
 * features/participant-shell/channelRouter/ChannelRouter.tsx
 * ---------------------------------------------------------------------------
 * `<ChannelRouter>`: mounts the participant channel for the URL
 * (channels-foundation 12, #708; PRT-001, PRT-003, PRT-020, COR-060, XC-002).
 * It replaces the single hard-coded `<SocialChannel />` inside `ShellLayout`.
 * Channels register themselves (`registerChannel`,
 * `features/channels/routing/registry.ts`); adding one never edits this file.
 *
 * What a path resolves to:
 *
 *  - `/display` and below: nothing. The login-free display route lives outside
 *    the session shell (portal FU-3, deferred post-December), so the router
 *    neither mounts nor 404s it.
 *  - `/` (the landing entry, PRT-001): the portal when it is registered and
 *    enabled (`/portal`, replacing the entry), otherwise the root channel
 *    (Social, which sends `/` on to its home exactly as in pilot mode). A
 *    read-only session is no different here; its feed default is still the
 *    guard's `landingSelection`.
 *  - `/{channelId}/…`: that channel, which owns every path below its prefix
 *    and renders its own not-found on a final 404 (press FU-6). A catalogued
 *    channel that is not registered renders the participant `ChannelNotFound`.
 *  - anything else: the root channel if it claims the path, otherwise
 *    `ChannelNotFound` (WR-002 / #238): brand-skinned, fiction-safe, inside
 *    the shell, never the COBRA 404.
 *
 * **Composition, and why the guard sits outside the theme scope.** A mounted
 * channel is
 *
 *   <ChannelRoute channelId>      enabled set: loading / not-found / children
 *     <ThemeScope>                the channel's own skin (SocialBrandScope, OutletSkinScope …)
 *       {element}
 *
 * so the guard's loading and not-found screens sit under the exercise brand
 * (`BrandThemeProvider`, above `ShellLayout`) and never take a channel's or an
 * outlet's skin. Nothing is applied above `ShellLayout`; this module imports no
 * COBRA theme (`ChannelRouter.test.tsx` scans it).
 *
 * **Shell containment.** The router renders inside `ShellLayout`'s content
 * region and only there. A registration carries an element and a theme scope,
 * nothing else, so a channel has no way to contribute nav or a layer above
 * the overlay; cross-channel nav is the shell's `ChannelNav`, which resolves
 * through the same registry and enabled set (`useNavigableChannels`).
 *
 * **Focus.** When the mounted channel changes (or a not-found replaces it),
 * focus moves to the new content's heading (`useChannelSwitchFocus`). Moves
 * inside one channel are that channel's own (Social's `useRouteFocus`), and
 * each channel sets its own `document.title` (`useChannelTitle`).
 *
 * World: participant. No COBRA, no MUI.
 */

import { useRef, type ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import {
  ChannelNotFound,
  ChannelPending,
  ChannelRoute,
  channelNavPath,
  useEnabledChannels,
  useRegisteredChannels,
  type ChannelRegistration,
  type EnabledChannels,
} from '@/features/channels/routing'
import { resolveChannelPath } from './resolveChannelPath'
import { useChannelSwitchFocus } from './useChannelSwitchFocus'

/** The landing channel when it is enabled (PRT-001). */
const LANDING_CHANNEL_ID = 'portal'

/** What the router renders for a resolved path. */
type RouterView =
  | { readonly kind: 'channel'; readonly channel: ChannelRegistration }
  | { readonly kind: 'redirect'; readonly to: string }
  | { readonly kind: 'pending' }
  | { readonly kind: 'not-found' }

/**
 * The landing entry (PRT-001): the portal when it is registered and enabled,
 * otherwise the root channel. Waits for the enabled set only when a portal is
 * registered (pilot mode, Social only, renders at once, exactly as before).
 */
function landingView(
  registered: readonly ChannelRegistration[],
  enabled: Pick<EnabledChannels, 'status' | 'isEnabled'>,
): RouterView {
  const portal = registered.find(channel => channel.id === LANDING_CHANNEL_ID)
  if (portal !== undefined) {
    if (enabled.status === 'loading') return { kind: 'pending' }
    if (enabled.isEnabled(portal.id)) return { kind: 'redirect', to: channelNavPath(portal) }
  }
  const root = registered.find(channel => channel.pathPrefix === '/')
  return root === undefined ? { kind: 'not-found' } : { kind: 'channel', channel: root }
}

/** Mounts the participant channel for the current URL. See the module header. */
export function ChannelRouter() {
  const { pathname } = useLocation()
  const registered = useRegisteredChannels()
  const enabled = useEnabledChannels()
  const resolution = resolveChannelPath(pathname, registered)

  if (resolution.kind === 'outside-shell') return null

  const view: RouterView = resolution.kind === 'landing' ? landingView(registered, enabled) : resolution
  if (view.kind === 'redirect') return <Navigate to={view.to} replace />

  // The landing entry resolves to a channel too, so `/` -> Social -> `/home` keeps ONE
  // Social mount (same key, same position) rather than remounting it on the redirect.
  const switchKey =
    view.kind === 'channel' ? view.channel.id : view.kind === 'pending' ? null : view.kind
  return (
    <ChannelSwitchScope switchKey={switchKey}>
      {view.kind === 'pending' && <ChannelPending />}
      {view.kind === 'not-found' && <ChannelNotFound />}
      {view.kind === 'channel' && <MountedChannel key={view.channel.id} channel={view.channel} />}
    </ChannelSwitchScope>
  )
}

/** One channel: the enablement guard OUTSIDE the channel's own theme scope. */
function MountedChannel({ channel }: { readonly channel: ChannelRegistration }) {
  const { id, element, themeScope: ThemeScope } = channel
  return (
    <ChannelRoute channelId={id}>
      <ThemeScope>{element}</ThemeScope>
    </ChannelRoute>
  )
}

/** The focus wrapper: moves focus to the new heading when `switchKey` changes. */
function ChannelSwitchScope({
  switchKey,
  children,
}: {
  readonly switchKey: string | null
  readonly children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  useChannelSwitchFocus(ref, switchKey)
  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-channel-router-scope={switchKey ?? 'pending'}
      style={{ outline: 'none' }}
    >
      {children}
    </div>
  )
}
