/**
 * features/app-shell/constants.ts
 * ---------------------------------------------------------------------------
 * Shared constants for the role-aware app shell (feature: app-shell, story 01
 * — role-aware global nav; COR-004/COR-005). Kept in their own tiny module so
 * both `RoleAwareEntry.tsx` (which redirects here on a fail-closed decision)
 * and `routes.tsx` (which mounts the real login routes at these paths) can
 * import them without a `RoleAwareEntry <-> routes` import cycle, and so
 * `RoleAwareEntry.tsx` stays a component-only module (react-refresh clean).
 *
 * World: routing glue — world-neutral, no COBRA, no participant skin.
 */

/**
 * Where every fail-closed routing decision lands (an unresolved / expired
 * session, an unsupported role, or a staff role with no built surface). Matches
 * the destination the composed participant guard (`exercise-isolation/04`) and
 * the login feature (`docs/features/login/`) use, so the whole app fails closed
 * to ONE entry. `routes.tsx` mounts the real participant sign-in page here
 * (feature: login, story 02, wired by story 04) — the majority-case form; a
 * staff/controller signs in at {@link STAFF_LOGIN_PATH} instead (see
 * `ParticipantSignInPage`'s link to it).
 */
export const LOGIN_PATH = '/login'

/**
 * Where a staff/controller member signs in (feature: login, story 03, wired by
 * story 04). Deliberately a SEPARATE path from {@link LOGIN_PATH} rather than a
 * role-aware redirect target: a fail-closed case fires precisely when the role
 * can no longer be trusted, so `/login` stays the one universal fail-closed
 * landing (hosting the participant form directly, the majority case) with a
 * single, clearly-labelled link to this path for the staff minority — see
 * `docs/features/login/04-wire-login-routes-and-logout.md`'s "Why `/login`
 * stays world-neutral" note.
 */
export const STAFF_LOGIN_PATH = '/staff/login'
