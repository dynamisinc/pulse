/**
 * core/auth/worldBroadcast.ts
 * ---------------------------------------------------------------------------
 * Sender half of the "one world per browser origin, across tabs" rule
 * (docs/design/ADMIN-IDENTITY-MODEL.md section 1.2 / 9; identity-auth-roles/16).
 *
 * A sign-in announces `{ world, at }` on `BroadcastChannel('pulse-world')`. Where
 * `BroadcastChannel` is missing (older Safari, some test envs) it falls back to a
 * `localStorage` write on `WORLD_SIGNAL_KEY`, which browsers deliver as a `storage`
 * event to OTHER tabs only. `core/auth/worldSync` is the receiving half: tabs of the
 * OTHER world sign themselves out.
 *
 * This is a dependency-free leaf (like `tokenStore`, which calls it from `setTokens`),
 * so no import cycle with `core/services`. It never throws and never carries a token.
 *
 * World: platform/foundation. No UI, no COBRA.
 */

/** The broadcast channel name. */
export const WORLD_CHANNEL_NAME = 'pulse-world'

/** `localStorage` key used by the storage-event fallback. */
export const WORLD_SIGNAL_KEY = 'pulse.auth.worldSignal'

/** Which world a sign-in belongs to. */
export type World = 'staff' | 'participant'

/** The message posted on a sign-in. `at` is an ISO-8601 wall-clock stamp (telemetry only). */
export interface WorldSignal {
  readonly world: World
  readonly at: string
  /** The announcing tab's id, so a tab can ignore its own echo (same-context channels deliver). */
  readonly source?: string
}

/** A random id for this tab/page load. */
export const TAB_ID: string = Math.random().toString(36).slice(2)

/** Narrowing parser for a received message (channel data or storage value). */
export function parseWorldSignal(value: unknown): WorldSignal | null {
  let candidate: unknown = value
  if (typeof value === 'string') {
    try {
      candidate = JSON.parse(value)
    } catch {
      return null
    }
  }
  if (typeof candidate !== 'object' || candidate === null) return null
  const { world, at, source } = candidate as Record<string, unknown>
  if ((world !== 'staff' && world !== 'participant') || typeof at !== 'string') return null
  return { world, at, source: typeof source === 'string' ? source : undefined }
}

/** Announces that this tab just signed in as `world`. Best effort; never throws. */
export function announceWorldSignIn(world: World): void {
  const signal: WorldSignal = { world, at: new Date().toISOString(), source: TAB_ID }
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      const channel = new BroadcastChannel(WORLD_CHANNEL_NAME)
      channel.postMessage(signal)
      channel.close()
      return
    }
  } catch {
    // Fall through to the storage-event fallback.
  }
  try {
    // A random nonce makes consecutive identical sign-ins still change the value.
    globalThis.localStorage.setItem(
      WORLD_SIGNAL_KEY,
      JSON.stringify({ ...signal, nonce: Math.random().toString(36).slice(2) }),
    )
  } catch {
    // Storage blocked: the server backstop (revoking the other world's sessions) still applies.
  }
}
