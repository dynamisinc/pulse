/**
 * features/controller/services/storylineMock.ts
 * ---------------------------------------------------------------------------
 * The exercise-scoped MOCK storyline store (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2).
 * STAFF world — pure data/service module, no UI, no COBRA, never a participant
 * surface (XC-002; storylines are staff-only per `Storyline.cs`'s own header).
 *
 * FROZEN-CONTRACT MIRROR (do not deviate). This is a field-for-field TS mirror
 * of the backend `Storyline` aggregate (`Pulse.Core/Features/Storylines/Models/
 * Storyline.cs` + `StorylinePhase.cs` + `Services/StorylineBriefProjection.cs`),
 * the Phase-1 stand-in until the E8 engine (Phase 2) owns the real aggregate
 * server-side:
 *   - `intensity`      — int, 0-100, clamped (`Storyline.Intensity`).
 *   - `targetIntensity`— int | null, null = unset (`Storyline.TargetIntensity`).
 *   - `phase`          — mirrors `StorylinePhase`'s 7-state lifecycle exactly
 *                        (`Dormant | Seeded | Escalating | Peak | Addressed |
 *                        Decaying | Resolved`); `phaseLabel()` upper-cases it
 *                        exactly as `StorylineBriefProjection.PhaseLabel` does
 *                        (`phase.ToString().ToUpperInvariant()`).
 *   - `sentiment`      — double, -1.0..1.0 (`Storyline.Sentiment`). Carried for
 *                        future reuse (e.g. a Stories flyout sentiment bar) —
 *                        NO UI reads it this story.
 *   - `setTargetIntensity()` mirrors `Storyline.SetTargetIntensity(int?, int)`:
 *     clamps 0-100, records the change, and returns the exact
 *     `"{from} → {to}"` / `"none → {to}"` detail-string convention
 *     (`Storyline.FormatTarget`) the backend logs to `SteeringActionLogged`.
 *     This mock does NOT implement `Tick`/`TickTowardTarget` (Phase 2,
 *     server-side, out of scope here) — only the target-capture half of the
 *     contract this story owns.
 *
 * STORE SHAPE — deliberately mirrors `features/controller/engine/services/
 * reviewStore.ts`'s module-singleton pattern (`getStoryline`/mutator/
 * `subscribe`/`resetForTests`) so `useStorylineTarget` can read it with a
 * `useSyncExternalStore`-style subscription. Snapshot identity is swapped
 * (never mutated in place) on every change, so a subscriber can memoize on it.
 *
 * ISOLATION (COR-001) — exercise-scoped BY CONSTRUCTION: the seeded storyline
 * already carries its stamped `exerciseId`; this module introduces no client
 * `exerciseId` query-scoping parameter (that stays server-side when the real
 * engine lands).
 */

/**
 * Mirrors `Pulse.Core.Features.Storylines.Models.StorylinePhase` exactly
 * (canonical order `Dormant -> Seeded -> Escalating -> Peak -> Addressed ->
 * Decaying -> Resolved`, with a re-open back to `Escalating`). Staff-only.
 */
export type StorylinePhase =
  | 'Dormant'
  | 'Seeded'
  | 'Escalating'
  | 'Peak'
  | 'Addressed'
  | 'Decaying'
  | 'Resolved'

/** Matches the shipped mock exercise id used across the controller feature (COR-001). */
export const MOCK_EXERCISE_ID = 'ex-mock-0001'

/** The seeded mock storyline's stable id (referenced by `useStorylineTarget`'s default). */
export const MOCK_STORYLINE_ID = 'storyline-water-advisory'

/**
 * The TS mirror of the FROZEN `Storyline` aggregate's escalation-dial-relevant
 * fields (see module header). Immutable snapshot — the store swaps a new one
 * on every mutation rather than mutating fields in place.
 */
export interface StorylineActual {
  readonly id: string
  readonly exerciseId: string
  readonly title: string
  /** 0-100, clamped (`Storyline.Intensity`). */
  readonly intensity: number
  /** 0-100 or `null` when unset (`Storyline.TargetIntensity`). */
  readonly targetIntensity: number | null
  /** Mirrors `StorylinePhase` (`Storyline.Phase`). */
  readonly phase: StorylinePhase
  /** -1.0..1.0 (`Storyline.Sentiment`). Carried, no UI this story. */
  readonly sentiment: number
}

/**
 * The uppercase phase label exactly as `StorylineBriefProjection.PhaseLabel`
 * produces it (e.g. `ESCALATING`, `PEAK`) — text, never a color-only indicator.
 */
export function phaseLabel(phase: StorylinePhase): string {
  return phase.toUpperCase()
}

/** The before/after detail a target-intensity change records (XC-004 payload). */
export interface TargetIntensityChange {
  readonly from: number | null
  readonly to: number | null
  /** `"{from} -> {to}"` / `"none -> {to}"`, mirroring `Storyline.FormatTarget`. */
  readonly detail: string
}

function clampIntensity(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

/** Mirrors `Storyline.FormatTarget` — `null` renders as the literal `"none"`. */
function formatTarget(value: number | null): string {
  return value === null ? 'none' : String(value)
}

function seedStoryline(): StorylineActual {
  return {
    id: MOCK_STORYLINE_ID,
    exerciseId: MOCK_EXERCISE_ID,
    title: 'Water main contamination fears',
    intensity: 62,
    targetIntensity: null,
    phase: 'Escalating',
    sentiment: -0.35,
  }
}

/** The current storyline snapshot. Identity is swapped (never mutated) on every change. */
let storyline: StorylineActual = seedStoryline()

/** Active change listeners; notified on every mutation. */
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

/**
 * Returns the current storyline snapshot (the mock's only storyline this
 * story). The returned reference is STABLE until the next mutation.
 */
function getStoryline(): StorylineActual {
  return storyline
}

/**
 * Sets, changes, or clears (pass `null`) the controller's dial target,
 * mirroring `Storyline.SetTargetIntensity(int?, int)`: clamps 0-100, swaps
 * the snapshot, notifies subscribers, and returns the from/to detail (XC-004
 * payload convention). Setting the target does not move `intensity` itself —
 * only the deferred (Phase 2) engine-follow tick does that.
 */
function setTargetIntensity(target: number | null): TargetIntensityChange {
  const from = storyline.targetIntensity
  const to = target === null ? null : clampIntensity(target)

  storyline = { ...storyline, targetIntensity: to }
  notify()

  return { from, to, detail: `${formatTarget(from)} → ${formatTarget(to)}` }
}

/** Subscribes to store changes; returns an unsubscribe function. */
function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/**
 * Restores the seeded baseline and clears all listeners. Test-only —
 * prevents cross-test pollution.
 */
function resetForTests(): void {
  storyline = seedStoryline()
  listeners.clear()
}

/** The module-singleton mock storyline store. See the module header for the contract. */
export const storylineMock = {
  getStoryline,
  setTargetIntensity,
  subscribe,
  resetForTests,
}
