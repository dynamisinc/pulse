/**
 * features/app-shell/routes.tsx
 * ---------------------------------------------------------------------------
 * The route-table CONTRIBUTION that replaces the five flat routes
 * (`/`, `/evaluator`, `/console`, `/shell`, `*`) with the role-aware entry
 * (feature: app-shell, story 01; COR-004/COR-005) plus the two real login
 * routes (feature: login, story 04; see `docs/features/login/`). It is a
 * React Router 7 `RouteObject[]` factory the ORCHESTRATOR splices into
 * `App.tsx`'s `createBrowserRouter(...)`. This story does NOT edit `App.tsx`
 * itself — that route-table swap is the orchestrator-owned integration seam
 * (implementation.md).
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
 *   - `/login`       -> `ParticipantSignInPage` (feature: login, story 02) —
 *                        the participant sign-in form. Also the universal
 *                        fail-closed landing (see `constants.ts`'s
 *                        `LOGIN_PATH` doc comment for why it stays
 *                        world-neutral rather than role-aware).
 *   - `/staff/login` -> `StaffSignInPage` (feature: login, story 03) — the
 *                        staff/controller sign-in form, linked from
 *                        `ParticipantSignInPage`.
 *   - `*`            -> the role-aware entry. A catch-all so the browser
 *                        routes on the resolved ROLE, never on the typed path
 *                        (COR-004): a participant typing `/console` still
 *                        lands on their participant surface, a staff member
 *                        typing `/shell` still lands on their staff surface.
 *
 * ## The two login routes (pre-auth, PRE-`RoleAwareEntry`)
 * Both are SIBLINGS of the `*` catch-all, mounted OUTSIDE
 * `SessionProvider`/`ExerciseContextProvider` — they run before a session can
 * be resolved (that's the point: `/login` is where a fail-closed session
 * lands), so each page self-resolves whatever it needs (`resolveExerciseContext`
 * directly, never through the fail-closed providers hoisted below). Mounting
 * both a participant page and a staff page at this world-neutral layer does
 * NOT breach the two-worlds routing rule: each page encapsulates its own world
 * entirely on its own (`ParticipantSignInPage`'s CSS-module brand-neutral skin;
 * `StaffSignInPage`'s own `cobraTheme` mount) — this file itself imports no
 * COBRA and no participant skin, exactly as before.
 *
 * World: routing glue — world-neutral. The only world-specific mounting lives
 * inside `RoleAwareEntry` at the staff hand-off, and inside the two login pages
 * themselves.
 */

import type { RouteObject } from 'react-router-dom'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { RoleAwareEntry, type RoleAwareEntryProps } from './RoleAwareEntry'
import { ParticipantSignInPage } from '@/features/login/pages/ParticipantSignInPage'
import { StaffSignInPage } from '@/features/login/pages/StaffSignInPage'
import { LOGIN_PATH, STAFF_LOGIN_PATH } from './constants'

/**
 * Builds the role-aware route table. The orchestrator passes the concrete
 * surfaces (which live in `App.tsx`) and spreads the result into
 * `createBrowserRouter([...])`.
 */
export function createRoleAwareRoutes(surfaces: RoleAwareEntryProps): RouteObject[] {
  return [
    {
      path: LOGIN_PATH,
      element: <ParticipantSignInPage />,
    },
    {
      path: STAFF_LOGIN_PATH,
      element: <StaffSignInPage />,
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
