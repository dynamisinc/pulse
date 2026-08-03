/**
 * features/app-shell/staffNavigationContext.tsx
 * ---------------------------------------------------------------------------
 * Publishes the RESOLVED staff navigation scope — the injected route registry
 * plus the resolved staff role — to staff chrome rendered *inside* a surface
 * (feature: staff-navigation, story 02; COR-070/COR-071).
 *
 * ## Why a context and not a prop
 * `SurfaceLauncher` lives in `StaffHeader`, which every staff surface
 * composition mounts. It cannot import the concrete registry
 * (`@/features/staff/staffRouteRegistry`) directly: that table imports each
 * surface's route composition, and those compositions import `StaffHeader` —
 * a direct import would close a real cycle.
 *
 * Prop-drilling is the other way out, and it is the WRONG one here: it would
 * make every composition responsible for forwarding `registry`/`role` into its
 * own header, so a new surface that forgets silently renders a launcher that
 * goes nowhere. With three surfaces that is a latent bug; at the ~40 planned
 * staff surfaces it is a certainty. The failure is invisible because the
 * launcher's degrade path (`entries.length <= 1` → the static lockup) is also
 * its correct single-surface behaviour, so "unwired" and "correctly degraded"
 * look identical on screen.
 *
 * `StaffRouteTree` already holds both values and already wraps every staff
 * surface, so publishing them there wires all present AND future surfaces once.
 * A new registry entry needs no header wiring at all.
 *
 * This module imports ONLY types from `./staffRouting` — no registry, no
 * surface, no theme — so it is safely importable from either direction.
 *
 * World: routing glue — world-neutral. Contains no COBRA and no participant
 * skin; it is a value carrier, not chrome.
 */

import { createContext, useContext, useMemo, type ReactNode } from 'react'
import type { StaffRouteRegistry, StaffSurfaceRole } from './staffRouting'

/** The resolved staff navigation scope, or `null` outside a staff route tree. */
export interface StaffNavigationScope {
  /** The injected registry — the single source of navigable staff surfaces. */
  readonly registry: StaffRouteRegistry
  /** The RESOLVED staff role. Never read from the URL. */
  readonly role: StaffSurfaceRole
}

/**
 * Defaults to `null` rather than throwing: staff chrome is also rendered by
 * tests and by compositions mounted directly (e.g. `App.integration.test.tsx`),
 * and a launcher with no scope must degrade to the static lockup, not crash a
 * whole surface. Absence is a supported state here, unlike the fail-closed
 * `useSession()` / `useExerciseContext()` seams where absence is a security
 * question. Nothing is *authorized* by this context — `StaffRouteTree` remains
 * the only thing that decides which surfaces may render, and `allowedRoles`
 * still gates visibility downstream.
 */
const StaffNavigationContext = createContext<StaffNavigationScope | null>(null)

export function StaffNavigationProvider({
  registry,
  role,
  children,
}: StaffNavigationScope & { children: ReactNode }) {
  // Memoised on the two primitives so the provider does not re-render every
  // consumer (potentially every staff surface) on each parent render.
  const value = useMemo<StaffNavigationScope>(() => ({ registry, role }), [registry, role])

  return (
    <StaffNavigationContext.Provider value={value}>{children}</StaffNavigationContext.Provider>
  )
}

/**
 * Reads the resolved staff navigation scope. Returns `null` outside a staff
 * route tree — callers degrade, they do not throw. See the context's doc
 * comment for why absence is supported here.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useStaffNavigation(): StaffNavigationScope | null {
  return useContext(StaffNavigationContext)
}
