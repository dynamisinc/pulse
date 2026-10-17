/**
 * features/login/linkToken.ts
 * ---------------------------------------------------------------------------
 * Pulls the personal-link token out of whatever a participant PASTED into the
 * "Sign-in link" field (#606, iOS home-screen sign-in). Pure: no React, no I/O,
 * and no console output (the token is a bearer credential, EL-7).
 *
 * WHY THIS EXISTS. An app added to the iOS home screen keeps its own storage, apart
 * from Safari's, so it always opens signed out. Tapping the `/join/<token>` link
 * in Mail or Messages opens Safari, not the app. So the standalone sign-in page
 * lets the participant paste that same link, and the page exchanges its token
 * through the existing `POST /auth/join`. It is the same credential and the same
 * transport (body only), so nothing new is exposed.
 *
 * WHAT IT ACCEPTS, in order:
 *   1. Any text containing `/join/<token>`: the full URL (any host, with or without
 *      a query string, hash or trailing slash), a bare path, or the whole sentence
 *      of an invitation message ("Your link: https://.../join/abc…").
 *   2. A bare token, that is, the trimmed input when it has the token's shape.
 * The token shape is base64url (`A-Z a-z 0-9 _ -`). Real tokens are 22 characters
 * (`ParticipantLinkTokens.TokenLength` on the server); the length is NOT pinned
 * here, so the mock-mode `demo-…` / `slow-…` tokens keep working. A floor of
 * `MIN_TOKEN_LENGTH` stops a stray word from being sent as a credential.
 *
 * The HOST is deliberately ignored. Links are scoped by hostname on the SERVER, so
 * a link copied from another exercise simply gets the generic 401, the same as any
 * refused link (NFR-009). Nothing here tells the participant which exercise a link
 * belongs to.
 */

/** Shortest input accepted as a token (a real token is 22 characters). */
export const MIN_TOKEN_LENGTH = 8

/** Longest input accepted as a token: bounds what is ever posted. */
export const MAX_TOKEN_LENGTH = 256

const TOKEN_CHARS = '[A-Za-z0-9_-]'
const JOIN_SEGMENT = new RegExp(`/join/(${TOKEN_CHARS}+)`)
const BARE_TOKEN = new RegExp(`^${TOKEN_CHARS}+$`)

/** True when `candidate` has the token's shape and a sane length. */
function isTokenShaped(candidate: string): boolean {
  return candidate.length >= MIN_TOKEN_LENGTH
    && candidate.length <= MAX_TOKEN_LENGTH
    && BARE_TOKEN.test(candidate)
}

/**
 * Returns the join token in `pasted`, or `null` when there is none (empty, a
 * link to some other page, or text that is not token-shaped). Never throws.
 */
export function extractJoinToken(pasted: string): string | null {
  const text = pasted.trim()
  if (text === '') return null

  const fromLink = JOIN_SEGMENT.exec(text)?.[1]
  if (fromLink !== undefined) return isTokenShaped(fromLink) ? fromLink : null

  return isTokenShaped(text) ? text : null
}
