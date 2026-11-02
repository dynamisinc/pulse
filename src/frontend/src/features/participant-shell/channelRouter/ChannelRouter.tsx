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
 *  - `/display` and below: reserved for the login-free display route, which
 *    lives outside the session shell (portal FU-3, deferred post-December) as a
 *    sibling of `/login`, so it never reaches the router. Until it exists the
 *    path is the participant not-found, never a blank shell.
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
 * otherwise the root channel. It waits for the enabled set here only when a
 * portal is registered. The root channel still passes its own `ChannelRoute`
 * like every channel, so on a cold cache Social shows the quiet pending
 * placeholder until the nav config answers (a request the nav makes anyway).
 * With Social disabled and no portal registered, `/` is the not-found: an
 * exercise with no reachable channel is story 08's call, not the router's.
 */
function landingView(
  registered: readonly ChannelRegistration[],
  enabled: Pick<EnabledChannels, 'status' | 'isEnabled'>,
  carry: string,
): RouterView {
  const portal = registered.find(channel => channel.id === LANDING_CHANNEL_ID)
  if (portal !== undefined) {
    if (enabled.status === 'loading') return { kind: 'pending' }
    // The query carries through: December's kiosk-lite is `/portal?display=1`.
    if (enabled.isEnabled(portal.id)) {
      return { kind: 'redirect', to: `${channelNavPath(portal)}${carry}` }
    }
  }
  const root = registered.find(channel => channel.pathPrefix === '/')
  return root === undefined ? { kind: 'not-found' } : { kind: 'channel', channel: root }
}

/** Mounts the participant channel for the current URL. See the module header. */
export function ChannelRouter() {
  const { pathname, search, hash } = useLocation()
  const registered = useRegisteredChannels()
  const enabled = useEnabledChannels()
  const resolution = resolveChannelPath(pathname, registered)

  const view: RouterView = resolution.kind === 'landing'
    ? landingView(registered, enabled, `${search}${hash}`)
    : resolution
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
