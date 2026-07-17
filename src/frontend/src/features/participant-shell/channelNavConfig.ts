/**
 * features/participant-shell/channelNavConfig.ts
 * ---------------------------------------------------------------------------
 * The channel-nav CONFIG mock seam (feature: participant-shell, story 03;
 * COR-061/062, D7-001; see docs/features/participant-shell/03-channel-nav.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Channel nav").
 *
 * Mirrors `chromeConfig.ts` / `shellState.ts`'s "mock behind the shared axios
 * client" pattern: every request routes through `api` so the request shape
 * (method, URL, base URL, headers) matches the future `/channel-nav-config`
 * endpoint, with mock data swapped at exactly ONE env-guarded flip point
 * (WAVE0-REVIEW precedent 15) rather than per call — a production build
 * without a backend fails CLOSED (the query errors; `useChannelNav` never
 * invents a channel set beyond the documented, safe-default fallback below).
 *
 * **Config-driven visibility is enforced structurally, not by convention.**
 * The WIRE shape (`ChannelNavConfigResponseBody`) carries the full channel
 * CATALOG with a per-channel `enabled` flag — a real deployment can toggle a
 * channel without a frontend redeploy. `fetchChannelNavConfig` filters to
 * enabled-only channels before it ever returns; the resolved
 * `ChannelNavConfig.channels` array (and therefore `ChannelNav.tsx`, which
 * never sees the wire shape) simply cannot contain a disabled channel — "no
 * dangling doors" (D2-005) is a property of the data a consumer can observe,
 * not a filter a component remembers to apply.
 *
 * `icon` on the wire is a closed identifier (`ChannelIconId`), never a FA icon
 * object — those aren't serializable, and a closed enum is also the
 * content-security posture: the resolved config can only ever select from a
 * fixed set of icons `ChannelNav.tsx` maps internally, never render arbitrary
 * server-supplied icon markup.
 *
 * Exercise-scoped (XC-001): the React Query key includes the resolved
 * exercise's `exerciseId`, read from `useExerciseContext()` for KEYING only
 * (WAVE0-REVIEW precedent 13) — it is never sent to the server as a
 * client-supplied scoping parameter (the mock ignores it entirely; a real
 * endpoint scopes by the authenticated session, server-side).
 *
 * World: participant. No COBRA, no UI — a pure data hook.
 */

import { useQuery } from '@tanstack/react-query'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'

/**
 * The closed set of channel icon identifiers `ChannelNav.tsx` knows how to
 * render. Deliberately NOT the full participant channel catalog's freeform
 * strings — a fixed union so an out-of-set value fails the runtime guard
 * below rather than silently rendering no icon.
 */
export type ChannelIconId = 'social' | 'portal' | 'news' | 'press' | 'weather'

const CHANNEL_ICON_IDS: readonly ChannelIconId[] = [
  'social',
  'portal',
  'news',
  'press',
  'weather',
]

function isChannelIconId(value: unknown): value is ChannelIconId {
  return typeof value === 'string' && (CHANNEL_ICON_IDS as readonly string[]).includes(value)
}

/** One enabled channel, as `ChannelNav.tsx` consumes it — already filtered (see module header). */
export interface ChannelNavChannel {
  readonly id: string
  readonly label: string
  readonly icon: ChannelIconId
}

/**
 * The resolved, mount-ready channel-nav config. `channels` is enabled-only.
 * `initialChannelId` seeds `ChannelNav.tsx`'s local "current channel" state on
 * mount; switching after that is local UI state the component owns per
 * instance (the story's AC — Phase 1 has no cross-channel routing yet).
 */
export interface ChannelNavConfig {
  readonly channels: readonly ChannelNavChannel[]
  readonly initialChannelId: string
  /**
   * When `true` and there is at most one enabled channel, `ChannelNav`
   * renders nothing at all — neither the desktop strip nor the mobile tab
   * bar (story AC: "a single-channel deployment may hide the strip
   * entirely"). A one-item switcher has nothing to switch between, so the
   * config can retire the whole container rather than ship dead chrome
   * (D0 §1 "every screen earns its elements").
   */
  readonly hideWhenSingleChannel: boolean
}

/** One catalog entry on the wire — the FULL catalog, enabled or not. */
interface ChannelNavChannelWire {
  readonly id: string
  readonly label: string
  readonly icon: ChannelIconId
  readonly enabled: boolean
}

/** Wire shape of the (future) `/channel-nav-config` response body. */
interface ChannelNavConfigResponseBody {
  readonly channels: readonly ChannelNavChannelWire[]
  readonly currentChannelId: string
  readonly hideWhenSingleChannel: boolean
}

function isChannelNavChannelWire(value: unknown): value is ChannelNavChannelWire {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.id === 'string' && candidate.id.length > 0 &&
    typeof candidate.label === 'string' && candidate.label.length > 0 &&
    isChannelIconId(candidate.icon) &&
    typeof candidate.enabled === 'boolean'
  )
}

/**
 * Runtime guard so this seam swaps to a live endpoint with no consumer
 * change: an out-of-shape response must fail closed, not be cast blindly to
 * `ChannelNavConfigResponseBody`.
 */
function isChannelNavConfigResponseBody(value: unknown): value is ChannelNavConfigResponseBody {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    Array.isArray(candidate.channels) &&
    candidate.channels.every(isChannelNavChannelWire) &&
    typeof candidate.currentChannelId === 'string' &&
    typeof candidate.hideWhenSingleChannel === 'boolean'
  )
}

/**
 * The Phase-1 pilot catalog (feature.md: "the world is effectively
 * single-channel (Social)"): all five participant channels are named in the
 * catalog so the shell contract stays stable as E4/E5/E6 land (Phase 3), but
 * only `social` is enabled today — the rest are simply absent from what
 * `useChannelNav()` resolves (see module header).
 */
const MOCK_CHANNEL_NAV_CONFIG: ChannelNavConfigResponseBody = {
  channels: [
    { id: 'social', label: 'Social', icon: 'social', enabled: true },
    { id: 'portal', label: 'Portal', icon: 'portal', enabled: false },
    { id: 'news', label: 'News', icon: 'news', enabled: false },
    { id: 'press', label: 'Press Room', icon: 'press', enabled: false },
    { id: 'weather', label: 'Weather', icon: 'weather', enabled: false },
  ],
  currentChannelId: 'social',
  // false: Phase 1 keeps the strip visible (degenerate, one link) so the
  // container is exercised now rather than hidden until Phase 3 multi-channel
  // lands — a deployment can still opt into hiding it via config.
  hideWhenSingleChannel: false,
}

/**
 * Short-circuits the network layer with a canned response so resolution is
 * instant in the current no-backend scaffold, while still exercising the
 * shared axios client's request pipeline (base URL, headers, interceptors)
 * exactly as a live endpoint call would.
 */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: MOCK_CHANNEL_NAV_CONFIG,
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/**
 * The SINGLE mock/live flip point (WAVE0-REVIEW precedent 15) — mirrors
 * `chromeConfig.ts`'s `USE_MOCK_CHROME_CONFIG`. Mock in dev/test; a
 * production build without a backend fails closed (the query errors rather
 * than serving a canned config).
 */
const USE_MOCK_CHANNEL_NAV_CONFIG = import.meta.env.DEV

/**
 * The AC-canonical safe-default fallback `useChannelNav()` returns while the
 * query has no resolved data yet (loading/error) — a single enabled channel
 * (`social`), strip visible. A participant shell always has a complete,
 * enabled-only channel set to render against; it never renders against a
 * partial/undefined value.
 */
const DEFAULT_CHANNEL_NAV_CONFIG: ChannelNavConfig = {
  channels: [{ id: 'social', label: 'Social', icon: 'social' }],
  initialChannelId: 'social',
  hideWhenSingleChannel: false,
}

/** Filters the wire catalog to enabled-only channels — see module header. */
function toResolvedConfig(body: ChannelNavConfigResponseBody): ChannelNavConfig {
  const channels: ChannelNavChannel[] = body.channels
    .filter(channel => channel.enabled)
    .map(({ id, label, icon }) => ({ id, label, icon }))

  const initialChannelId = channels.some(channel => channel.id === body.currentChannelId)
    ? body.currentChannelId
    : (channels[0]?.id ?? '')

  return {
    channels,
    initialChannelId,
    hideWhenSingleChannel: body.hideWhenSingleChannel,
  }
}

async function fetchChannelNavConfig(): Promise<ChannelNavConfig> {
  const response = await api.get<ChannelNavConfigResponseBody>(
    '/channel-nav-config',
    USE_MOCK_CHANNEL_NAV_CONFIG ? { adapter: mockAdapter } : undefined,
  )

  if (!isChannelNavConfigResponseBody(response.data)) {
    throw new Error(
      'fetchChannelNavConfig: mock resolution returned a missing or invalid ChannelNavConfigResponseBody',
    )
  }

  return toResolvedConfig(response.data)
}

/**
 * Resolves the current exercise's channel-nav config (enabled channels +
 * initial current channel + strip-visibility flag).
 *
 * Exercise-scoped via the React Query key (see module header). Falls back to
 * `DEFAULT_CHANNEL_NAV_CONFIG` whenever the query has no resolved data yet —
 * while loading, on error, or absent — so `ChannelNav` always has a complete,
 * enabled-only config to render against.
 */
export function useChannelNav(): ChannelNavConfig {
  const { exerciseId } = useExerciseContext()

  const { data } = useQuery({
    queryKey: ['participant-shell', 'channel-nav-config', exerciseId],
    queryFn: fetchChannelNavConfig,
  })

  return data ?? DEFAULT_CHANNEL_NAV_CONFIG
}
