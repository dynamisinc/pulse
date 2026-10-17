/**
 * core/auth/worldSync.ts
 * ---------------------------------------------------------------------------
 * Receiving half of "one world per browser origin, across tabs"
 * (docs/design/ADMIN-IDENTITY-MODEL.md section 1.2; identity-auth-roles/16). The sender is
 * `worldBroadcast.announceWorldSignIn`, called by `tokenStore.setTokens`.
 *
 * WHY. Staff tokens live in each tab's own `sessionStorage` and `crossTabSessionSync` ignores
 * storage changes in staff tabs, so a participant sign-in in tab B cannot reach staff tab A (and
 * vice versa) through the token store. This listener closes that gap: when a sign-in of the OTHER
 * world is announced, this tab (if it holds a session) POSTs `/api/auth/logout` with its own
 * token, clears ITS OWN token store only, and goes to its world's sign-in page.
 *
 * EXCEPTION, STAFF SIGN-IN OVER A PARTICIPANT (W-1). The signing-in staff tab's `setTokens` removes
 * the shared `localStorage` pair BEFORE it announces, so participant tabs find no session
 * (`currentWorld() === null`) and return early: they never POST a logout. Instead the SIGNING-IN
 * tab POSTs `/auth/logout` with the outgoing participant access token itself
 * (`tokenStore.postDisplacedLogout`). Participant tabs still hear the signal but hold nothing, so
 * the server-side logout happens exactly once. The other direction (participant sign-in over a
 * staff tab) works as described above, because staff tokens live in that tab's own store.
 *
 * WHICH WORLD AM I. A page whose session lives in `sessionStorage` is a staff page
 * (`isSessionScoped()`); one holding a persistent (`localStorage`) pair is a participant page.
 * A tab with no session has nothing to sign out and ignores the signal. That includes a staff tab
 * whose tokens were cleared (the sticky record keeps `isSessionScoped()` true): with no access and
 * no refresh token it ignores the signal, so half-typed credentials on /staff/login survive (W-2).
 * Same-world signals are
 * ignored (`crossTabSessionSync` already handles participant-to-participant).
 *
 * ONLY OWN STORE. It uses `clearActiveTokens`, never `clearTokens`: the signing-in tab has just
 * written the new world's pair into the other store, and a full clear would wipe it.
 *
 * INSTALLED once from `core/services/api.ts` (beside `installCrossTabSessionSync`). The logout
 * request goes through `api` via a dynamic import so this module has no static cycle with it.
 *
 * World: platform/foundation. No UI, no COBRA. Never logs a token.
 */
import {
  WORLD_CHANNEL_NAME,
  TAB_ID,
  WORLD_SIGNAL_KEY,
  parseWorldSignal,
  type World,
  type WorldSignal,
} from './worldBroadcast'
import {
  clearActiveTokens,
  getAccessToken,
  getRefreshToken,
  isPersistentSession,
  isSessionScoped,
} from './tokenStore'

/** Sign-in pages by world (mirrors `features/app-shell/constants`; core cannot import features). */
export const WORLD_SIGN_IN_PATHS: Readonly<Record<World, string>> = {
  staff: '/staff/login',
  participant: '/login',
}

/** The slice of `BroadcastChannel` this module uses. */
export interface WorldChannelLike {
  onmessage: ((event: MessageEvent) => void) | null
  close(): void
}

/** Seams for tests; every one defaults to the real browser behaviour. */
export interface WorldSyncOptions {
  readonly createChannel?: () => WorldChannelLike | null
  readonly storageTarget?: Pick<Window, 'addEventListener' | 'removeEventListener'> | null
  /** Best-effort server logout with the captured token. */
  readonly postLogout?: (token: string) => Promise<void>
  /** Navigate (hard) to the given sign-in path. */
  readonly navigate?: (path: string) => void
}

/** The world THIS tab's session belongs to, or `null` when it holds none. */
export function currentWorld(): World | null {
  if (isSessionScoped()) return 'staff'
  if (isPersistentSession()) return 'participant'
  return null
}

async function defaultPostLogout(token: string): Promise<void> {
  const { api } = await import('../services/api')
  await api.post(
    '/auth/logout',
    undefined,
    { headers: { Authorization: `Bearer ${token}` } },
  )
}

function defaultCreateChannel(): WorldChannelLike | null {
  return typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(WORLD_CHANNEL_NAME)
}

/** Installs the listener; returns an uninstaller. A no-op where nothing can be listened to. */
export function installWorldSync(options: WorldSyncOptions = {}): () => void {
  const createChannel = options.createChannel ?? defaultCreateChannel
  const storageTarget = options.storageTarget !== undefined
    ? options.storageTarget
    : typeof window === 'undefined' ? null : window
  const postLogout = options.postLogout ?? defaultPostLogout
  const navigate = options.navigate ?? ((path: string) => window.location.assign(path))

  const handle = (signal: WorldSignal | null): void => {
    if (!signal || signal.source === TAB_ID) return
    const mine = currentWorld()
    if (mine === null || mine === signal.world) return

    const token = getAccessToken()
    // A cleared-but-still-"staff" tab (sticky record) holds nothing to sign out (W-2).
    if (token === null && getRefreshToken() === null) return
    clearActiveTokens()
    // Best effort: the local sign-out has already happened whatever the network does.
    // No token to present (refresh-only pair): nothing to POST (S-4).
    if (token !== null) void postLogout(token).catch(() => undefined)
    navigate(WORLD_SIGN_IN_PATHS[mine])
  }

  let channel: WorldChannelLike | null = null
  try {
    channel = createChannel()
  } catch {
    channel = null
  }
  if (channel) channel.onmessage = event => handle(parseWorldSignal(event.data))

  // The sender uses the channel when it exists, otherwise the storage event: listen to the
  // storage event only when there is no channel here either.
  const onStorage = (event: Event): void => {
    if (!(event instanceof StorageEvent)) return
    if (event.key !== WORLD_SIGNAL_KEY || event.newValue === null) return
    handle(parseWorldSignal(event.newValue))
  }
  const listensToStorage = channel === null
  if (listensToStorage) storageTarget?.addEventListener('storage', onStorage)

  return () => {
    if (channel) {
      channel.onmessage = null
      channel.close()
    }
    if (listensToStorage) storageTarget?.removeEventListener('storage', onStorage)
  }
}
