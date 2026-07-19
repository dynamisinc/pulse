/**
 * features/controller/identity/controllerIdentity.ts
 * ---------------------------------------------------------------------------
 * The controller console's PHASE-1 MOCK identity seam (feature: console-shell,
 * story 01 — "Toolstrip + flyouts"; COR-018 attribution; see
 * docs/features/console-shell/01-toolstrip-flyouts.md AC "Mock controller
 * identity" and its rationale note).
 *
 * `useControllerIdentity()` returns the operating controller's exercise-scoped
 * identity — `{ actingHumanId, callSign, role: 'controller' }` — that every
 * console action attributes itself to (COR-018: the acting human is stamped on
 * every persona-op post and its XC-004 telemetry actor). Other Wave-1 stories
 * (persona-operation/01's composer) consume this as an INPUT passed in as
 * props at integration; they never import this module (parallel-build
 * contract).
 *
 * ## Why a mock, and why it lives HERE (not in core/auth)
 * Staff routes do not currently mount `SessionProvider`, and the one mock
 * `resolveSession()` (`@/core/auth`) returns a single fixed *participant*
 * session (Dana Reyes) — there is no controller-session mock. Forking
 * `core/auth`'s resolver to be surface-aware mid-wave is a shared-foundation
 * change owned by no single story and a merge hazard across all five Wave-1
 * builders. So the controller identity is a small, staff-feature-owned mock
 * for now; the real controller-session endpoint is the deferred backend edge
 * (no `.NET` backend exists yet). When it lands, this hook swaps its body for
 * a `useSession()`-derived read with no change to its signature or consumers.
 *
 * ## Exercise-scoped, mirroring `useExerciseContext()` (COR-001)
 * The identity is derived from the exercise scope read via
 * `useExerciseContext()` — so a remount for a DIFFERENT exercise re-scopes the
 * identity by construction (a controller's per-human attribution is a
 * per-exercise assignment, COR-010/COR-018), with no module-global state that
 * could leak an identity across exercises. Calling this hook outside an
 * `<ExerciseContextProvider>` throws (via `useExerciseContext()`, fail-closed).
 *
 * World: staff (COBRA/Cadence). Pure hook — no UI, no participant surface
 * (XC-002).
 */

import { useMemo } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'

/**
 * The operating controller's identity for a given exercise (COR-018). `role`
 * is fixed `'controller'` — this is the console operator's own identity, not a
 * persona they post as (that persona is `authorPersonaId` on a post, a
 * separate concept).
 */
export interface ControllerIdentity {
  /**
   * The individual human operating the console — stamped as `actingHumanId` on
   * every persona-op post (`createPost`) and its XC-004 telemetry actor
   * (COR-018 per-human attribution). NEVER participant-visible (SOC-003/XC-002).
   */
  readonly actingHumanId: string
  /** The operator/cell call sign shown on the console chrome (e.g. 'SIMCELL-1'). */
  readonly callSign: string
  /** Always `'controller'` — the console operator role (COR-010). */
  readonly role: 'controller'
}

/**
 * Phase-1 mock lookup — a fixed controller identity per exercise. The mock
 * exercise (`ex-mock-0001`, the one `exerciseContextResolver` resolves to) gets
 * a named operator; any other exercise id derives a distinct, exercise-scoped
 * mock so the exercise-scoping is observable (a different exercise yields a
 * different `actingHumanId`). Replaced wholesale by the real
 * controller-session read when the backend lands.
 */
const MOCK_CONTROLLER_IDENTITIES: Readonly<Record<string, ControllerIdentity>> = {
  'ex-mock-0001': {
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
  },
}

/**
 * Resolves the Phase-1 mock identity for `exerciseId`. Deterministic + pure so
 * the same exercise always yields the same identity, and a different exercise
 * yields a different one (exercise-scoping, COR-001).
 */
export function resolveMockControllerIdentity(exerciseId: string): ControllerIdentity {
  return (
    MOCK_CONTROLLER_IDENTITIES[exerciseId] ?? {
      actingHumanId: `human-controller-${exerciseId}`,
      callSign: 'SIMCELL-1',
      role: 'controller',
    }
  )
}

/**
 * Returns the operating controller's exercise-scoped identity (COR-018).
 * Phase-1 mock — see module header. Bound to the exercise scope, so a remount
 * for a new exercise re-scopes it; throws outside an `<ExerciseContextProvider>`
 * (fail-closed, via `useExerciseContext()`).
 */
export function useControllerIdentity(): ControllerIdentity {
  const { exerciseId } = useExerciseContext()
  return useMemo(() => resolveMockControllerIdentity(exerciseId), [exerciseId])
}
