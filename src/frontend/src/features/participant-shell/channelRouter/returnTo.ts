/**
 * features/participant-shell/channelRouter/returnTo.ts
 * ---------------------------------------------------------------------------
 * Return-to-after-login for participant deep links (channels-foundation 12,
 * #708; PRT-020). A signed-out visitor who opens a shared permalink
 * (`/news/newsline-7/emergency-call-delays`, often on a phone) is sent to
 * `/login`; once they sign in they should arrive at that permalink, not at the
 * landing page.
 *
 *  - `rememberReturnTo(path)`: the session provider calls it on its signed-out
 *    redirect, with the path the visitor asked for.
 *  - `takeReturnTo()`: the participant sign-in pages call it on success; it
 *    returns the remembered path once and forgets it.
 *
 * **Why `localStorage`, with a short lifetime.** The visitor may sign in on the
 * same tab (today's word, a pasted link) or by tapping their personal join link,
 * which a phone opens in a new tab; `sessionStorage` would lose the path there.
 * The entry expires after {@link RETURN_TO_TTL_MS}, so a stale link never
 * hijacks a later, unrelated sign-in. Auth lifetime is a real-time concern, so
 * the timestamp is wall-clock through the one documented seam
 * (`wallClockNowIso`), never scenario time, and it is never shown.
 *
 * **Never an open redirect.** Only a same-origin, host-relative participant path
 * is kept, and it is re-checked on read (storage can be edited): it must start
 * with a single `/`, carry no scheme, backslash or control character, stay under
 * {@link RETURN_TO_MAX_LENGTH}, and not be a sign-in, join or staff path. The
 * path names nothing private: the server still decides what the signed-in
 * account may read, and a disabled channel or a missing item lands on the
 * participant `ChannelNotFound`.
 *
 * World: participant (the only world with deep links into the fiction). No UI.
 */

import { wallClockNowIso } from '@/core/time/wallClock'

/** The storage key. */
export const RETURN_TO_STORAGE_KEY = 'pulse.participant.returnTo'

/** How long a remembered path survives (a sign-in takes minutes, not hours). */
export const RETURN_TO_TTL_MS = 30 * 60 * 1000

/** The longest path kept. */
export const RETURN_TO_MAX_LENGTH = 512

/** First segments that are never a participant destination. */
const EXCLUDED_SEGMENTS: readonly string[] = ['login', 'join', 'staff']

interface StoredReturnTo {
  readonly path: string
  readonly savedAt: number
}

function nowMs(): number {
  return Date.parse(wallClockNowIso())
}

/** Whether `path` is a participant path we may send a signed-in visitor to. */
export function isSafeReturnToPath(path: unknown): path is string {
  if (typeof path !== 'string') return false
  if (path.length < 2 || path.length > RETURN_TO_MAX_LENGTH) return false
  if (!path.startsWith('/') || path.startsWith('//')) return false
  // eslint-disable-next-line no-control-regex
  if (/[\\\u0000-\u001f\u007f]/.test(path)) return false
  if (/^\/[^/?#]*:/.test(path)) return false
  const segment = (path.slice(1).split(/[/?#]/)[0] ?? '').toLowerCase()
  return !EXCLUDED_SEGMENTS.includes(segment)
}

function storage(): Storage | undefined {
  try {
    return window.localStorage
  } catch {
    return undefined
  }
}

/**
 * Remembers `path` (pathname + search + hash) as the destination after the
 * next participant sign-in. An unsafe path or `/` (the landing entry) is not
 * kept, and clears any older entry.
 */
export function rememberReturnTo(path: string): void {
  const store = storage()
  if (store === undefined) return
  try {
    if (!isSafeReturnToPath(path)) {
      store.removeItem(RETURN_TO_STORAGE_KEY)
      return
    }
    const entry: StoredReturnTo = { path, savedAt: nowMs() }
    store.setItem(RETURN_TO_STORAGE_KEY, JSON.stringify(entry))
  } catch {
    // Storage full or blocked: the visitor lands on the landing page instead.
  }
}

/**
 * Returns the remembered destination once, then forgets it. `null` when there
 * is none, it has expired, or it fails the safety check.
 */
export function takeReturnTo(): string | null {
  const store = storage()
  if (store === undefined) return null
  try {
    const raw = store.getItem(RETURN_TO_STORAGE_KEY)
    store.removeItem(RETURN_TO_STORAGE_KEY)
    if (raw === null) return null
    const entry = JSON.parse(raw) as Partial<StoredReturnTo> | null
    if (entry === null || typeof entry.savedAt !== 'number') return null
    const age = nowMs() - entry.savedAt
    if (!(age >= 0 && age <= RETURN_TO_TTL_MS)) return null
    return isSafeReturnToPath(entry.path) ? entry.path : null
  } catch {
    return null
  }
}
