/**
 * features/participant-shell/ParticipantLandingGuard.tsx
 * ---------------------------------------------------------------------------
 * The participant landing ROUTE GUARD (feature: exercise-isolation, story 04;
 * COR-004, XC-002, COR-015; see
 * docs/features/exercise-isolation/04-no-exercise-selection-for-participants.md).
 *
 * Phase B2 make-real: participants never choose or perceive an exercise
 * (COR-004). This component is the participant arm of role-aware nav —
 * `app-shell/01` composes it — and it gates entry to the participant landing
 * surface (the Social feed in pilot mode; the Portal once E3 lands — this
 * guard never hard-codes which one) using the LIVE `useSession()` /
 * `useRole()` (identity-auth-roles/03, `@/core/auth`) and
 * `useExerciseContext()` (exercise-isolation/08, `@/core/exerciseContext`):
 *
 *  - **participant/PIO role, a scope that matches the session's bound
 *    exercise, and a non-expired session** → renders `children` (the landing
 *    surface), wrapped in a `LandingSelectionProvider` carrying the COR-015
 *    read-only default (`./landingSelection.ts`).
 *  - **staff role (controller/evaluator/planner), `orgAdmin`, a session/scope
 *    MISMATCH ("unresolved scope" — see below), or an expired session** →
 *    FAILS CLOSED: redirects to the login entry rather than ever rendering
 *    the participant fiction or a staff surface.
 *
 * "Unresolved scope": `useSession()` and `useExerciseContext()` each already
 * throw when their OWN provider is missing (fail-closed at that layer), so by
 * the time this guard runs, both hooks have resolved to SOME value. The one
 * unresolved-ness this guard can still observe is a MISMATCH between the
 * session's bound exercise and the host-resolved scope — exactly the
 * precedence-model invariant `identity-auth-roles/implementation.md` documents
 * ("For a participant, the session's exercise must equal the host's resolved
 * exercise; a mismatch fails closed"). This is defense-in-depth: the backend
 * enforces the same invariant server-side (story 08's precedence model); this
 * is the client-side mirror so a stale/mismatched scope is never rendered into
 * even transiently.
 *
 * No client-supplied `exerciseId` anywhere here — both values this guard
 * compares come from the resolved session/scope, never a prop or query param
 * (COR-001, COR-004).
 *
 * A11y / no-flash: the fail-closed branch returns BEFORE `children` is ever
 * reached, in the same render pass — there is no intermediate frame where
 * participant content is visible and then swapped out.
 *
 * World: participant. No COBRA, no default MUI look — this file renders no UI
 * of its own beyond the `<Navigate>` redirect (react-router, the same library
 * already used at the composition root, `App.tsx`).
 */

import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { isParticipantRole, isSessionExpired, useRole, useSession } from '@/core/auth'
import type { Session } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { wallClockNowIso } from '@/core/time/wallClock'
import { LandingSelectionProvider, resolveLandingSelection } from './landingSelection'

export interface ParticipantLandingGuardProps {
  /** The participant landing surface to render once session/scope are admitted. */
  children: ReactNode;
}

/**
 * Where a denied session (staff role, unresolved scope, or expired session)
 * is sent (COR-004, XC-002). The login page itself is a separate story
 * (exercise-configuration COR-030, out of scope here); this is the fail-closed
 * target regardless of whether that route exists yet.
 */
export const PARTICIPANT_FAIL_CLOSED_REDIRECT = '/login'

/**
 * True only when the session's bound exercise and the host-resolved scope
 * agree, and neither is empty. See the module header ("Unresolved scope").
 */
function isScopeResolved(session: Session, scope: ExerciseScope): boolean {
  return (
    session.exerciseId.length > 0 &&
    scope.exerciseId.length > 0 &&
    session.exerciseId === scope.exerciseId
  )
}

/**
 * Gates entry to the participant landing surface. See the module header for
 * the full fail-closed contract.
 */
export function ParticipantLandingGuard({ children }: ParticipantLandingGuardProps) {
  const session = useSession()
  const role = useRole()
  const scope = useExerciseContext()

  // Auth lifetime is a REAL-time concern, not scenario time (mirrors
  // `sessionResolver.ts`'s own `expiresAt` rationale) — but this file lives
  // under `features/participant-shell/**`, where the COR-053 lint ban ("no
  // bare `new Date()`/`Date.now()`") applies to every call site regardless of
  // intent. Route through `wallClockNowIso()` (`@/core/time/wallClock`), the
  // ONE documented real-wall-clock seam, rather than adding a second
  // lint-exception call site.
  const wallClockNow = new Date(wallClockNowIso())

  const admitted =
    isParticipantRole(role) &&
    isScopeResolved(session, scope) &&
    !isSessionExpired(session, wallClockNow)

  if (!admitted) {
    // Fail-closed (COR-004, XC-002): never the participant fiction, never a
    // staff surface — just the login entry. `replace` so the denied entry
    // does not linger in browser history.
    return <Navigate to={PARTICIPANT_FAIL_CLOSED_REDIRECT} replace />
  }

  return (
    <LandingSelectionProvider value={resolveLandingSelection(session)}>
      {children}
    </LandingSelectionProvider>
  )
}
