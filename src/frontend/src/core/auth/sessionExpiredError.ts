/**
 * core/auth/sessionExpiredError.ts
 * ---------------------------------------------------------------------------
 * The one typed failure `resolveSession()` throws for a session the SERVER has confirmed
 * is over (easy-login Gate-2 W2-2): the `/session` request SUCCEEDED, the body is a
 * well-formed session, and its `expiresAt` is already in the past.
 *
 * ## Why it is a type of its own
 * `SessionProvider` shows a "Reconnecting..." screen, not the login page, when a
 * signed-in person's request merely did not get an answer (W-5). A malformed body is one
 * of those: a captive portal's HTML login page answers 200 to everything and parses as no
 * session at all, which says nothing about the person's sign-in, so retrying is right. An
 * expired session is the opposite: the server itself said the sign-in is over, retrying
 * can only get the same answer, and the person must sign in again. The provider tells the
 * two apart by this class (`instanceof`), never by the wording of a message.
 *
 * It is a leaf module on purpose, imported by both the resolver and the provider. Tests
 * mock `./sessionResolver` whole, and a class defined inside it would vanish with the mock.
 *
 * The message is fixed and secret-free. World: platform/foundation, no UI.
 */

/** Thrown when the server returned a well-formed session that is already expired. */
export class SessionExpiredError extends Error {
  constructor() {
    super('resolveSession: resolved session is already expired; re-auth required')
    this.name = 'SessionExpiredError'
  }
}
