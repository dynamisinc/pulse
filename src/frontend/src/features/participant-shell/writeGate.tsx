/**
 * features/participant-shell/writeGate.tsx
 * ---------------------------------------------------------------------------
 * The ONE write-affordance seam for the participant world (exercise-ended
 * read-only review; the 2026-10-19 "Widened" note in
 * docs/features/exercise-configuration/03-exercise-lifecycle.md).
 *
 * WHY A SEAM, NOT A VARIANT. After EndEx (lifecycle `completed`) participants may still READ
 * everything, including their PERSONAL views: notifications, the Following and Pinned tabs and
 * their own-profile cues. Those views are gated today on `affordancesAvailable(variant)` and on
 * `session.isReadOnly` / `session.personaId`. Routing "ended" into the shell variant
 * (`readOnly`) or into `ReadOnlySessionScope` (which also drops `personaId`) would switch every
 * one of them off. So "ended" is a SEPARATE answer, and only WRITE affordances ask it:
 *
 *   canWrite = !ended && !session.isReadOnly
 *
 * - `ExerciseEndedProvider` (mounted once by `ShellLayout`, around the channel) publishes `ended`.
 *   It is a plain context value: flipping it re-renders consumers but never remounts the channel,
 *   so scroll position and open threads survive the EndEx flip.
 * - `useCanWrite()` is what composer, Post, reply, like, repost, pin, follow, edit and media
 *   attach consult (directly, or through the hooks that own them).
 * - `useExerciseEndedFlag()` is the raw flag, for choosing the "exercise has ended" wording when
 *   a write is refused with 403 (a composer that was open at EndEx).
 *
 * With no provider (staff preview, tests) `ended` is false: behaviour is unchanged.
`useCanWrite` needs a SessionProvider, like every write hook that calls it already does.
 * World: participant. No UI here.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { isAxiosError } from 'axios'
import { useSession } from '@/core/auth'

const ExerciseEndedContext = createContext<boolean>(false)

export interface ExerciseEndedProviderProps {
  readonly ended: boolean
  readonly children: ReactNode
}

export function ExerciseEndedProvider({ ended, children }: ExerciseEndedProviderProps) {
  return <ExerciseEndedContext.Provider value={ended}>{children}</ExerciseEndedContext.Provider>
}

/** True once the exercise has ended (read-only review). False with no provider. */
// eslint-disable-next-line react-refresh/only-export-components
export function useExerciseEndedFlag(): boolean {
  return useContext(ExerciseEndedContext)
}

/** False when the exercise has ended OR the session is read-only. Gates WRITE affordances only. */
// eslint-disable-next-line react-refresh/only-export-components
export function useCanWrite(): boolean {
  const ended = useContext(ExerciseEndedContext)
  const session = useSession()
  return !ended && !session.isReadOnly
}

/** Out-of-fiction wording for a write refused (403) because the exercise has ended. */
export const EXERCISE_ENDED_WRITE_MESSAGE =
  'This exercise has ended. Nothing new can be posted.'

/**
 * True when `failure` is the gate's 403 for a write attempted while the exercise has ended
 * (e.g. a composer that was open at EndEx). Callers then show
 * {@link EXERCISE_ENDED_WRITE_MESSAGE} instead of a generic failure.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function isEndedRefusal(failure: unknown, ended: boolean): boolean {
  return ended && isAxiosError(failure) && failure.response?.status === 403
}
