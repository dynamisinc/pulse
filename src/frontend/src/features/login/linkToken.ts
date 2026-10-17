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
 *   2. A bare token: the trimmed input, when it is EXACTLY a real token's shape,
 *      22 base64url characters (`ParticipantLinkTokens.TokenLength` on the server).
 * The two paths are strict in different ways (Gate-1 W-1). Text containing
 * `/join/` was clearly pasted from a link, so its token only has to be base64url
 * and `MIN_TOKEN_LENGTH`..`MAX_TOKEN_LENGTH` long. A BARE value must be exactly 22
 * characters. The link field is the default one, so someone will type today's word
 * or their sign-in name into it, and a looser rule would post that word to
 * `/auth/join`. Each such post spends the venue's shared per-IP join allowance.
 * In mock mode (`allowLooseBareToken`) a bare value may be any length, so the
 * `demo-…` / `slow-…` tokens keep working.
 * Matching `/join/` ignores case (some mail clients rewrite it); the token never
 * does.
 *
 * The HOST is deliberately ignored. Links are scoped by hostname on the SERVER, so
 * a link copied from another exercise simply gets the generic 401, the same as any
 * refused link (NFR-009). Nothing here tells the participant which exercise a link
 * belongs to.
 */

/** Length of a real link token (`ParticipantLinkTokens.TokenLength`). */
export const TOKEN_LENGTH = 22

/** Shortest token accepted from a pasted LINK (a real token is 22 characters). */
export const MIN_TOKEN_LENGTH = 8

/** Longest input accepted as a token: bounds what is ever posted. */
export const MAX_TOKEN_LENGTH = 256

const TOKEN_CHARS = '[A-Za-z0-9_-]'
const JOIN_SEGMENT = new RegExp(`/join/(${TOKEN_CHARS}+)`, 'i')
const BARE_TOKEN = new RegExp(`^${TOKEN_CHARS}+$`)

/** True when `candidate` has the token's shape and a sane length. */
function isTokenShaped(candidate: string): boolean {
  return candidate.length >= MIN_TOKEN_LENGTH
    && candidate.length <= MAX_TOKEN_LENGTH
    && BARE_TOKEN.test(candidate)
}

export interface ExtractJoinTokenOptions {
  /** Mock mode only: accept a bare value of any sane length (`demo-…`), not just 22. */
  readonly allowLooseBareToken?: boolean
}

/**
 * Returns the join token in `pasted`, or `null` when there is none (empty, a
 * link to some other page, or text that is not token-shaped). Never throws.
 */
export function extractJoinToken(
  pasted: string,
  { allowLooseBareToken = false }: ExtractJoinTokenOptions = {},
): string | null {
  const text = pasted.trim()
  if (text === '') return null

  const fromLink = JOIN_SEGMENT.exec(text)?.[1]
  if (fromLink !== undefined) return isTokenShaped(fromLink) ? fromLink : null

  if (!isTokenShaped(text)) return null
  return allowLooseBareToken || text.length === TOKEN_LENGTH ? text : null
}
