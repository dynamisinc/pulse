/**
 * features/app-shell/routes.tsx
 * ---------------------------------------------------------------------------
 * The route-table CONTRIBUTION that replaces the five flat routes
 * (`/`, `/evaluator`, `/console`, `/shell`, `*`) with the role-aware entry
 * (feature: app-shell, story 01; COR-004/COR-005). It is a React Router 7
 * `RouteObject[]` factory the ORCHESTRATOR splices into `App.tsx`'s
 * `createBrowserRouter(...)`. This story does NOT edit `App.tsx` itself — that
 * route-table swap is the orchestrator-owned integration seam (implementation.md).
 *
 * ## Provider structure this contribution establishes (world-neutral at root)
 * The entry element mounts the two world-neutral core seams ABOVE
 * `RoleAwareEntry` so it can read the resolved role/scope to branch:
 *
 *     ExerciseContextProvider            (exercise scope — fail-closed, XC-001)
 *       > SessionProvider                (bound session — fail-closed, COR-012)
 *         > RoleAwareEntry               (branches on the resolved role only)
 *
 * Both providers are pure `core/` seams — NO COBRA, NO participant skin — so
 * mounting them at the root keeps the root theme-free (D0 §2). They also
 * fail closed to `null` while resolving / on hard failure, so an UNRESOLVED
 * session or scope can never render a default or cross-world surface; a
 * resolved-but-invalid case (expired / unsupported role) is redirected to the
 * login entry by `RoleAwareEntry`.
 *
 * ## Route matching
 *   - `/login` -> a minimal, world-neutral fail-closed placeholder (see below).
 *   - `*`      -> the role-aware entry. A catch-all so the browser routes on the
 *                 resolved ROLE, never on the typed path (COR-004): a participant
 *                 typing `/console` still lands on their participant surface, a
 *                 staff member typing `/shell` still lands on their staff surface.
 *
 * ## The `/login` placeholder (temporary)
 * The login page + its theming are owned by the login story (COR-030, out of
 * scope here). Until it lands, this mounts a bare, world-neutral notice at
 * `/login` so the fail-closed redirect (both `RoleAwareEntry`'s and the composed
 * `exercise-isolation/04` guard's) terminates at something visible instead of a
 * blank screen or a redirect loop. The orchestrator should DROP this route once
 * the real `/login` route exists.
 *
 * World: routing glue — world-neutral. The only world-specific mounting lives
 * inside `RoleAwareEntry` at the staff hand-off.
 */

import type { RouteObject } from 'react-router-dom'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { RoleAwareEntry, type RoleAwareEntryProps } from './RoleAwareEntry'
import { SignInFallback } from './SignInFallback'
import { LOGIN_PATH } from './constants'

/**
 * Builds the role-aware route table. The orchestrator passes the concrete
 * surfaces (which live in `App.tsx`) and spreads the result into
 * `createBrowserRouter([...])`.
 */
export function createRoleAwareRoutes(surfaces: RoleAwareEntryProps): RouteObject[] {
  return [
    {
      path: LOGIN_PATH,
      element: <SignInFallback />,
    },
    {
      path: '*',
      element: (
        <ExerciseContextProvider>
          <SessionProvider>
            <RoleAwareEntry {...surfaces} />
          </SessionProvider>
        </ExerciseContextProvider>
      ),
    },
  ]
}
