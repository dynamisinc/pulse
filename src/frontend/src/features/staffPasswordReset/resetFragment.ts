/**
 * features/staffPasswordReset/resetFragment.ts
 * ---------------------------------------------------------------------------
 * Reads the one-time token from the URL FRAGMENT (`#token=...`) and strips the fragment
 * from the address bar. The fragment is never sent to a server or in a Referer, which is
 * why the link uses it (never a query string). The token is never logged.
 */

/** Returns the token in `#token=...`, or null when absent/empty. Pure read. */
export function readResetToken(hash: string = window.location.hash): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, '')).get('token')
  return token !== null && token.trim().length > 0 ? token.trim() : null
}

/** Removes the fragment from the address bar without navigating. Idempotent. */
export function stripResetFragment(): void {
  if (window.location.hash === '') return
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  )
}
