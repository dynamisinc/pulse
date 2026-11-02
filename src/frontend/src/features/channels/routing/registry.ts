/**
 * features/channels/routing/registry.ts
 * ---------------------------------------------------------------------------
 * The participant channel registry (channels-foundation 12, #708; PRT-003,
 * COR-060, D7-001). A channel feature registers itself once, from its own
 * folder, and `<ChannelRouter>` (`features/participant-shell/channelRouter`)
 * mounts it at its prefix. Adding a channel is a `registerChannel()` call in
 * that channel's feature, never an edit to the router or the shell.
 *
 *   registerChannel({
 *     id: 'news',
 *     pathPrefix: '/news',
 *     element: <NewsChannel />,
 *     themeScope: NewsThemeScope,
 *   })
 *
 * **Prefixes (FC-4).** Social owns `/` (and keeps its own sub-routes); every
 * other channel owns `/{id}` and every path below it (`/portal/resources`,
 * `/weather/zones/:zoneSlug`), because a permalink is always
 * `/{channelId}/{outletSlug}/{contentSlug}`. Any other prefix is refused.
 *
 * **Theme scope.** `themeScope` wraps the channel's element inside its own
 * route subtree (Social: `SocialBrandScope`; an outlet channel: a component
 * that mounts `OutletSkinScope`). The router mounts the enablement guard
 * OUTSIDE it, so the guard's loading and not-found screens keep the
 * exercise's brand and never take a channel's or an outlet's skin.
 *
 * **Root claims.** The channel at `/` may pass `claimsPath`: the router renders
 * the participant `ChannelNotFound` for a path it does not claim (WR-002), so
 * a mistyped URL stays in the fiction. A prefixed channel owns every path below
 * its prefix and renders its own not-found from its pages (press FU-6), so the
 * router never pre-empts it; `claimsPath` is ignored there.
 *
 * Invalid or conflicting registrations are refused with a console error,
 * never a throw at import time (a bad channel must not take the shell down).
 *
 * World: participant. No COBRA, no MUI, no UI.
 */

import { useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { HotModule } from '@/core/auth/sessionReset'
import { isChannelId, type ChannelId } from '../contract'

/** The channel mounted at the site root. */
export const ROOT_CHANNEL_ID: ChannelId = 'social'

/** One registered participant channel. */
export interface ChannelRegistration {
  /** The `ChannelCatalog` id (`social`, `portal`, `news`, `press`, `weather`). */
  readonly id: ChannelId
  /** `/` for Social, `/{id}` for every other channel (FC-4). */
  readonly pathPrefix: string
  /**
   * Where the shell's channel nav sends a participant (defaults to
   * `pathPrefix`). Social uses `/home`: its `/` is the landing entry, which
   * goes to the portal when the portal is enabled (PRT-001).
   */
  readonly navPath?: string
  /** The channel's root element; it routes its own sub-paths. */
  readonly element: ReactNode
  /** The channel's theme/skin scope, mounted inside its route subtree only. */
  readonly themeScope: ComponentType<{ readonly children: ReactNode }>
  /** Root channel only: whether the channel serves `pathname` (see the header). */
  readonly claimsPath?: (pathname: string) => boolean
}

const channels = new Map<ChannelId, ChannelRegistration>()
const listeners = new Set<() => void>()
let snapshot: readonly ChannelRegistration[] = []

function changed(): void {
  snapshot = [...channels.values()]
  for (const listener of listeners) listener()
}

function registryError(message: string): void {
  console.error(`[channels/routing] ${message}`)
}

/** The prefix a channel id must register at (FC-4). */
export function channelPathPrefix(id: ChannelId): string {
  return id === ROOT_CHANNEL_ID ? '/' : `/${id}`
}

const NAV_PATH = /^\/[a-z0-9-]*(?:\/[a-z0-9-]+)*$/

/** A nav path is a plain path under the channel's own prefix (Social: any root path). */
function isOwnNavPath(id: ChannelId, navPath: string): boolean {
  if (!NAV_PATH.test(navPath)) return false
  const prefix = channelPathPrefix(id)
  if (prefix === '/') {
    const segment = navPath.split('/')[1] ?? ''
    return !isChannelId(segment) || segment === ROOT_CHANNEL_ID
  }
  return navPath === prefix || navPath.startsWith(`${prefix}/`)
}

/**
 * Registers a participant channel. Call once, at module scope, from the
 * channel's own feature folder. A second registration of the same id with a
 * different element is refused; re-registering the same registration is a
 * no-op. Pass the registering module's `import.meta.hot` as `hot` (the
 * `registerSessionReset` pattern): when Vite hot-replaces that module its old
 * entry is dropped first, so the re-evaluated registration takes effect.
 */
export function registerChannel(registration: ChannelRegistration, hot?: HotModule): void {
  const { id, pathPrefix, navPath } = registration
  if (!isChannelId(id)) {
    registryError(`"${String(id)}" is not a catalogued channel id`)
    return
  }
  if (pathPrefix !== channelPathPrefix(id)) {
    registryError(`channel "${id}" must register at "${channelPathPrefix(id)}", not "${pathPrefix}"`)
    return
  }
  if (navPath !== undefined && !isOwnNavPath(id, navPath)) {
    registryError(`channel "${id}" has an invalid navPath "${navPath}"`)
    return
  }
  const existing = channels.get(id)
  if (existing !== undefined) {
    const same =
      existing.element === registration.element && existing.themeScope === registration.themeScope
    if (!same) {
      registryError(`channel "${id}" is already registered`)
    }
    return
  }
  channels.set(id, registration)
  changed()
  hot?.dispose(() => {
    if (channels.get(id) !== registration) return
    channels.delete(id)
    changed()
  })
}

/** The registered channels, in registration order. */
export function getRegisteredChannels(): readonly ChannelRegistration[] {
  return snapshot
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The registered channels; re-renders when a channel registers late. */
export function useRegisteredChannels(): readonly ChannelRegistration[] {
  return useSyncExternalStore(subscribe, getRegisteredChannels, getRegisteredChannels)
}

/** Where the channel nav sends a participant for `registration`. */
export function channelNavPath(registration: ChannelRegistration): string {
  return registration.navPath ?? registration.pathPrefix
}

/**
 * The registered channel that owns `pathname`, by its first segment: `/news/…`
 * is News's, anything else falls to the root channel. `undefined` when the
 * owner is not registered (including a catalogued channel id that is not).
 * Pure: the router and the nav both resolve through it, so they agree.
 */
export function findChannelForPath(
  pathname: string,
  registered: readonly ChannelRegistration[],
): ChannelRegistration | undefined {
  // Case-insensitive, like React Router's own matching: `/News/x` is News's.
  const segment = (pathname.split('/')[1] ?? '').toLowerCase()
  const prefixed = registered.find(
    channel => channel.pathPrefix !== '/' && channel.pathPrefix === `/${segment}`,
  )
  if (prefixed !== undefined) return prefixed
  if (isChannelId(segment) && segment !== ROOT_CHANNEL_ID) return undefined
  return registered.find(channel => channel.pathPrefix === '/')
}

/** Test-only: forget every registration. */
export function resetChannelRegistryForTests(): void {
  channels.clear()
  changed()
}
