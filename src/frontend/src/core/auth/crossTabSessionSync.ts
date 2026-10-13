/**
 * core/auth/crossTabSessionSync.ts
 * ---------------------------------------------------------------------------
 * Keeps every tab of a browser showing the identity the shared token store
 * holds (easy-login story 07, M-2).
 *
 * WHY. A participant's tokens live in `localStorage` (EL-10), which every tab of
 * the origin shares. Testers will open two personal join links in one browser:
 * tab 2 signs in as Y and overwrites tab 1's pair, but tab 1's UI still shows X
 * (and its in-memory caches still hold X's data) while every request it makes
 * now goes out as Y. The same happens after a sign-out in another tab. So when
 * ANOTHER tab changes the session identity marker (`pulse.auth.session`, see
 * `tokenStore`), this tab RELOADS: the app boots again from whatever the store
 * holds now (the new user, or the login page after a sign-out).
 *
 * WHAT TRIGGERS A RELOAD. Only a `storage` event for the marker key (a new
 * sign-in, or a sign-out removing it) or a `localStorage.clear()` (key `null`).
 * NOT a refresh rotation: that rewrites the two token keys and leaves the marker
 * alone, so a participant's own silent refresh in one tab never reloads their
 * other tabs. Browsers deliver `storage` events to OTHER tabs only, so the tab
 * that signed in or out never reloads itself.
 *
 * WHAT NEVER TRIGGERS ONE. A page whose session lives in `sessionStorage`
 * (every staff session; `isSessionScoped()`) ignores the event outright: its
 * identity is private to its tab, so a participant link opened in the same
 * browser must not reload a staff console.
 *
 * WHERE IT IS INSTALLED. `core/services/api.ts` calls
 * `installCrossTabSessionSync()` once at module load. `api.ts` is imported by
 * every surface that can hold or acquire a session, so no component has to mount
 * it, and this module depends on `tokenStore` only, so `core/services ->
 * core/auth` stays a one-way edge with no import cycle.
 *
 * World: platform/foundation. No UI, no COBRA, no participant skin. Logs nothing.
 */
import { SESSION_MARKER_KEY, isSessionScoped } from './tokenStore'

/** The slice of `Window` this module needs (so a test can hand it any `EventTarget`). */
export interface StorageEventTarget {
  addEventListener(type: 'storage', listener: (event: Event) => void): void
  removeEventListener(type: 'storage', listener: (event: Event) => void): void
}

/**
 * Starts listening for another tab changing the session identity and calls
 * `reload` when it does. Returns a function that stops listening. A no-op
 * (returning a no-op) where there is no `window` to listen on.
 *
 * @param target  Where `storage` events arrive. Defaults to `window`; `null` listens to nothing.
 * @param reload  What to do on an identity change. Defaults to reloading the page.
 */
export function installCrossTabSessionSync(
  target: StorageEventTarget | null = typeof window === 'undefined' ? null : window,
  reload: () => void = () => window.location.reload(),
): () => void {
  if (!target) return () => undefined

  const onStorage = (event: Event): void => {
    if (!(event instanceof StorageEvent)) return
    // `key === null` is `localStorage.clear()` in another tab.
    const markerChanged =
      event.key === null ||
      (event.key === SESSION_MARKER_KEY && event.oldValue !== event.newValue)
    if (!markerChanged) return
    if (isSessionScoped()) return
    reload()
  }

  target.addEventListener('storage', onStorage)
  return () => target.removeEventListener('storage', onStorage)
}
