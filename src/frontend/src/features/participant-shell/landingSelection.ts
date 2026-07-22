/**
 * features/participant-shell/landingSelection.ts
 * ---------------------------------------------------------------------------
 * The participant landing-feed SELECTION contract (feature: exercise-isolation,
 * story 04; COR-015, COR-004; see
 * docs/features/exercise-isolation/04-no-exercise-selection-for-participants.md).
 *
 * `ParticipantLandingGuard` (`./ParticipantLandingGuard.tsx`) is the sole
 * producer of this value: once it admits a resolved participant/PIO session,
 * it resolves the session's `isReadOnly` flag into a `LandingSelection` and
 * provides it to the mounted landing surface via `LandingSelectionProvider`.
 *
 * This module owns the SELECTION only, not the feed switch itself. The All
 * Posts feed (feeds-discovery/01) is Complete and unconditional today; the
 * Following feed (feeds-discovery/02) has not been built yet. Building that
 * tab/switch is explicitly out of this story's scope ("the actual feed
 * components are E2 — build the guard's selection, not the feed"). This
 * contract exists so that story, whenever it lands, can call
 * `useLandingSelection()` to find out which feed a session should default to,
 * without this story reaching into `features/social` to wire a default itself.
 *
 * COR-015: a read-only (shared-credential) session ALWAYS resolves to
 * `'all-posts'` — the Following feed would be empty for an account that can
 * never follow anyone, so landing a passive viewer there would be a dead end.
 * Every other resolved participant/PIO session resolves to `'following'`, the
 * ordinary citizen default. The PIO-role exception (PIO also defaults to All
 * Posts, per feeds-discovery/01) is that story's own decision and is
 * deliberately NOT duplicated here — this module's one input is `isReadOnly`.
 *
 * World: participant. No COBRA, no UI — a pure contract module (types + a
 * React context), mirroring `mountContract.ts`'s provider/hook shape.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { Session } from '@/core/auth'

/** Which landing feed a resolved participant/PIO session lands on (COR-015). */
export type LandingSelection = 'all-posts' | 'following'

/**
 * Resolves the landing selection for a resolved participant/PIO session.
 * `isReadOnly` is the only input this story owns (COR-015) — see the module
 * header for why role-based defaults beyond that are left to feeds-discovery.
 */
export function resolveLandingSelection(session: Session): LandingSelection {
  return session.isReadOnly ? 'all-posts' : 'following'
}

const LandingSelectionContext = createContext<LandingSelection | undefined>(undefined)

export interface LandingSelectionProviderProps {
  value: LandingSelection;
  children: ReactNode;
}

/**
 * Binds the resolved landing selection for the subtree below it.
 * `ParticipantLandingGuard` is the only intended caller — a channel never
 * computes its own selection.
 *
 * A plain function component built with `createElement` (not JSX), so this
 * module can stay a `.ts` file — mirrors `mountContract.ts`'s
 * `ShellContextProvider`.
 */
export function LandingSelectionProvider({ value, children }: LandingSelectionProviderProps) {
  return createElement(LandingSelectionContext.Provider, { value }, children)
}

/**
 * Returns the current landing selection.
 *
 * Fail-closed: throws when called outside a `LandingSelectionProvider` rather
 * than returning a default selection a consumer could silently render
 * against (matches the `core/exerciseContext` / `mountContract` precedent).
 */
// Provider + hook intentionally colocated in one module (mirrors
// mountContract.ts). No `react-refresh/only-export-components` disable is
// needed here — like `ShellContextProvider`, `LandingSelectionProvider` is
// built with `createElement` rather than JSX, so the plugin does not treat
// this file as exporting a component in the first place.
export function useLandingSelection(): LandingSelection {
  const value = useContext(LandingSelectionContext)
  if (value === undefined) {
    throw new Error(
      'useLandingSelection() must be called within a <LandingSelectionProvider>. ' +
      'There is no default landing selection (COR-015).',
    )
  }
  return value
}
