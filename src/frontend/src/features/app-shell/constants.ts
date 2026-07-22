/**
 * features/app-shell/constants.ts
 * ---------------------------------------------------------------------------
 * Shared constants for the role-aware app shell (feature: app-shell, story 01
 * — role-aware global nav; COR-004/COR-005). Kept in their own tiny module so
 * both `RoleAwareEntry.tsx` (which redirects here on a fail-closed decision)
 * and `routes.tsx` (which mounts the temporary fail-closed landing at this
 * path) can import them without a `RoleAwareEntry <-> routes` import cycle, and
 * so `RoleAwareEntry.tsx` stays a component-only module (react-refresh clean).
 *
 * World: routing glue — world-neutral, no COBRA, no participant skin.
 */

/**
 * Where every fail-closed routing decision lands (an unresolved / expired
 * session, an unsupported role, or a staff role with no built surface). Matches
 * the destination the composed participant guard (`exercise-isolation/04`) and
 * the login story (COR-030, out of scope here) use, so the whole app fails
 * closed to ONE entry. The login page itself is owned by the login story; until
 * it lands, `routes.tsx` mounts a minimal, world-neutral placeholder here.
 */
export const LOGIN_PATH = '/login'
