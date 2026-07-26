/**
 * features/personas/personaService.ts
 * ---------------------------------------------------------------------------
 * The read seam for exercise-scoped persona INSTANCES (feature:
 * persona-management, story 02; profiles-social-graph backend story 06). Routed
 * through the shared axios client with a dev mock adapter (mirroring
 * `exerciseContextResolver`): in the current no-backend scaffold it returns the
 * Fairhaven baseline cast seeded for the mock exercise, so a Pulse feed has
 * believable authors; swapping the adapter for a live `/personas` endpoint
 * needs no consumer change.
 *
 * ## TWO READS, ONE ENDPOINT (SOC-052 / D1-008)
 * `GET /personas` projects by WORLD, mirroring the backend's two DTOs:
 *
 *   - `resolvePersonas()` / `usePersonas()` -> `Persona[]` — the PARTICIPANT
 *     projection (`PersonaResponseDto`). No `personaType`, structurally. This
 *     read additionally re-narrows every element through
 *     `toParticipantPersona()`, so even if the CALLER happens to hold a staff
 *     token (e.g. a staff browser rendering a participant preview) the objects
 *     handed to a participant surface carry no archetype tell at runtime
 *     either — belt and braces on top of the type-level omission.
 *
 *   - `resolveStaffPersonas()` / `useStaffPersonas()` -> `StaffPersona[]` — the
 *     STAFF projection (`StaffPersonaResponseDto`), which the backend serves
 *     ONLY to a live staff-kind session. The staff bearer token is attached by
 *     `core/services/api.ts`'s request interceptor, so this needs no extra
 *     request wiring — but it VALIDATES `personaType` and throws when it is
 *     absent/out-of-vocabulary. That is the fail-closed answer to "what if a
 *     staff path calls this before a token exists": the picker surfaces an
 *     error instead of silently showing every persona under an unfiltered
 *     "all" and rendering an unlabeled category chip.
 *
 * PRECEDENT — neither read takes a client `exerciseId` param: query isolation
 * is server-side (COR-001); the session already binds the exercise. The mock
 * resolves the ONE exercise's cast, and composes `followerCount` from the live
 * mock follow-edge store on every request rather than serving the frozen
 * seed-time number (WR-005 — see `withMockFollowEdges`).
 *
 * `usePersonaTemplates()` exposes the org-library templates (NOT
 * exercise-scoped, story 01). Staff/data world — no UI, no COBRA.
 */

import { useEffect, useState } from 'react'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
// MOCK-SCAFFOLD-ONLY dependency (WR-005 — see `withMockFollowEdges` below). It
// is consumed exclusively inside the `USE_MOCK_PERSONAS` adapters, mirroring
// the LIVE path where the server (`GetEdgeCountsAsync`, backend story 07)
// composes the same number; no shipped/live read path in this module touches it.
import { mockFollowerIdsOf } from '@/features/social/services/followEdgeStore'
import { PERSONA_TEMPLATES } from './personaTemplates'
import { FAIRHAVEN_BASELINE } from './casts'
import { seedCast } from './seedCast'
import { isPersonaType, type Persona, type PersonaTemplate, type StaffPersona } from './types'

/** The mock exercise this scaffold resolves against (matches the session/exercise mocks). */
const MOCK_EXERCISE_ID = 'ex-mock-0001'

/**
 * MOCK SCAFFOLD — dev/test + mock-fixture use ONLY. The seeded instances for
 * the mock exercise, computed once (seeding is pure + deterministic) so
 * `personaById` and the mock adapter share one stable set.
 *
 * A shipped participant surface must NOT import this array (or `personaById`)
 * directly: unlike `resolvePersonas()` these are NOT behind the
 * `USE_MOCK_PERSONAS` flip point, so importing them into production code would
 * ship canned mock authors instead of failing closed (the fail-open-to-mock
 * shape WAVE0-REVIEW precedent 15 forbids). The real read path is
 * `usePersonas()` / `resolvePersonas()`. These exist for the mock adapter, unit
 * tests, and other mock fixtures (e.g. mock post authorship) only.
 */
export const SEEDED_PERSONAS: readonly StaffPersona[] = seedCast(
  FAIRHAVEN_BASELINE,
  MOCK_EXERCISE_ID,
  PERSONA_TEMPLATES,
)

/**
 * Look up a seeded persona instance by id (undefined if absent). Returns the
 * FULL (staff) shape — it is a fixture accessor, not a wire read, and a
 * `StaffPersona` is usable anywhere a `Persona` is expected. MOCK SCAFFOLD —
 * same caveat as {@link SEEDED_PERSONAS}: mock fixtures + tests only, never a
 * shipped participant surface (use `usePersonas()` there).
 */
export function personaById(id: string): StaffPersona | undefined {
  return SEEDED_PERSONAS.find(p => p.id === id)
}

/**
 * The ONLY sanctioned way to hand a persona to a participant surface. Builds a
 * fresh object literal from participant-safe fields only, so `personaType` is
 * genuinely ABSENT from the result rather than merely unread (SOC-052/D1-008)
 * — mirroring `postService.toParticipantView`'s XC-002 guarantee.
 *
 * Takes a `Persona` (not a `StaffPersona`) so it accepts BOTH: a staff
 * instance narrows down, and a wire object that is already participant-shaped
 * is stripped of any unexpected extra keys the transport may have carried.
 * Never hand-pick persona fields elsewhere; always route through this.
 */
export function toParticipantPersona(persona: Persona): Persona {
  return {
    id: persona.id,
    exerciseId: persona.exerciseId,
    templateId: persona.templateId,
    displayName: persona.displayName,
    handle: persona.handle,
    kind: persona.kind,
    verified: persona.verified,
    avatarColor: persona.avatarColor,
    initials: persona.initials,
    audienceBand: persona.audienceBand,
    followerCount: persona.followerCount,
    joinedAt: persona.joinedAt,
    ...(persona.bio !== undefined ? { bio: persona.bio } : {}),
    // Optional follow-graph counts (profiles-social-graph/02+07) — forwarded
    // only when present, mirroring `bio`'s pattern, so an absent value stays
    // genuinely absent rather than becoming an `undefined` key.
    ...(persona.followingCount !== undefined ? { followingCount: persona.followingCount } : {}),
    ...(persona.audienceMagnitude !== undefined
      ? { audienceMagnitude: persona.audienceMagnitude }
      : {}),
  }
}

/**
 * MOCK ONLY (WR-005, #88/#121) — recomposes `followerCount` at READ time the
 * way the live server does: `audienceMagnitude + real inbound follow edges`
 * (backend story 07's `GetEdgeCountsAsync`).
 *
 * WHY. `SEEDED_PERSONAS` is computed ONCE at module load, and the mock
 * follow/unfollow write only mutates `followEdgeStore`'s edge set — so before
 * this, a mock-mode follow moved the button to "Following" while the target's
 * `persona.followerCount` never budged, not even across a reload. Live mode
 * recomposed on every read. That is exactly the mock-says-one-thing/
 * live-says-another divergence this feature keeps having to design against
 * (and `VITE_USE_MOCK_DATA=true` is UAT's own setting, so the wrong half is
 * the one that gets demoed). Composing here makes the two modes agree.
 *
 * `audienceMagnitude` is the RAW magnitude and is passed through untouched —
 * only the composed total moves (see `services/audience.ts`'s "WHICH PERSONA
 * FIELD IS THE MAGNITUDE" note). A seeded instance always carries it; the
 * `??` fallback covers only a hypothetical fixture that predates the field.
 */
function withMockFollowEdges<T extends Persona>(persona: T): T {
  const magnitude = persona.audienceMagnitude ?? persona.followerCount
  return {
    ...persona,
    followerCount: magnitude + mockFollowerIdsOf(persona.id).length,
    audienceMagnitude: magnitude,
  }
}

/**
 * Short-circuits the network with the PARTICIPANT projection of the seeded
 * cast — the mock is honest about the world split, so a dev/UAT participant
 * surface never receives a `personaType` over the wire either. Composed per
 * REQUEST (not at module load) so a follow made during the session is
 * reflected on the next read, exactly like live (see `withMockFollowEdges`).
 */
const participantMockAdapter: AxiosAdapter = config => Promise.resolve({
  data: SEEDED_PERSONAS.map(persona => toParticipantPersona(withMockFollowEdges(persona))),
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/** Short-circuits the network with the STAFF projection (archetype included). */
const staffMockAdapter: AxiosAdapter = config => Promise.resolve({
  data: SEEDED_PERSONAS.map(withMockFollowEdges),
  status: 200,
  statusText: 'OK',
  headers: {},
  config,
})

/** Single env-guarded mock/live flip point (mirrors exerciseContextResolver). */
const USE_MOCK_PERSONAS = USE_MOCK_DATA

function isValidPersona(value: unknown): value is Persona {
  if (!value || typeof value !== 'object') return false
  const p = value as Persona
  return (
    typeof p.id === 'string' && p.id.length > 0 &&
    typeof p.displayName === 'string' && p.displayName.length > 0 &&
    typeof p.handle === 'string' && p.handle.length > 0 &&
    (p.kind === 'human' || p.kind === 'org') &&
    // `verified` drives the SOC-052 trust signal PostCard renders — an
    // undefined/coerced value would silently misrender it, so validate it
    // strictly rather than accept any element with a string id.
    typeof p.verified === 'boolean' &&
    // `followingCount`/`audienceMagnitude` (profiles-social-graph/02+07) are
    // OPTIONAL (see types.ts's module header) — validated only when present,
    // same treatment as `bio`, so this never rejects the still-current mock
    // fixtures that omit them, but a present-and-wrong-typed value still
    // fails closed rather than silently misrendering a follow count.
    (p.followingCount === undefined || typeof p.followingCount === 'number') &&
    (p.audienceMagnitude === undefined || typeof p.audienceMagnitude === 'number')
  )
}

function isPersonaArray(data: unknown): data is Persona[] {
  return Array.isArray(data) && data.every(isValidPersona)
}

/**
 * The staff guard: everything `isValidPersona` requires, PLUS an in-vocabulary
 * `personaType`. A body that satisfies the first but not the second is the
 * PARTICIPANT projection — i.e. the backend did not see a live staff-kind
 * session on this call — and must fail loudly here (see
 * `resolveStaffPersonas`), never flow on as `undefined`.
 */
function isValidStaffPersona(value: unknown): value is StaffPersona {
  return isValidPersona(value) && isPersonaType((value as StaffPersona).personaType)
}

function isStaffPersonaArray(data: unknown): data is StaffPersona[] {
  return Array.isArray(data) && data.every(isValidStaffPersona)
}

/**
 * Resolves the current exercise's seeded persona instances in the PARTICIPANT
 * projection. Throws on request failure or a malformed body (fail-closed — no
 * default/empty author set is silently substituted).
 *
 * Every element is re-narrowed through `toParticipantPersona`, so the result
 * carries no staff-only field at runtime regardless of what the caller's token
 * earned from the endpoint.
 */
export async function resolvePersonas(): Promise<Persona[]> {
  const response = await api.get<Persona[]>(
    '/personas',
    USE_MOCK_PERSONAS ? { adapter: participantMockAdapter } : undefined,
  )
  if (!isPersonaArray(response.data)) {
    throw new Error('resolvePersonas: resolution returned a malformed persona set')
  }
  return response.data.map(toParticipantPersona)
}

/**
 * Resolves the current exercise's persona instances in the STAFF projection
 * (archetype included). Staff surfaces that read `personaType` MUST use this
 * rather than casting the participant read.
 *
 * Fails closed and VISIBLY when the body is the participant projection: that
 * means this call reached the endpoint without a live staff-kind session (no
 * bearer token attached, an expired/read-only session, …). Returning the
 * personas anyway would leave `personaType` `undefined`, which silently
 * degrades the console — the picker's type filter would match nothing and the
 * "POSTING AS {category}" chip would hit its exhaustiveness guard.
 */
export async function resolveStaffPersonas(): Promise<StaffPersona[]> {
  const response = await api.get<StaffPersona[]>(
    '/personas',
    USE_MOCK_PERSONAS ? { adapter: staffMockAdapter } : undefined,
  )
  if (!isStaffPersonaArray(response.data)) {
    throw new Error(
      'resolveStaffPersonas: resolution returned a malformed or participant-shaped persona ' +
      'set (no personaType). A staff persona read requires a live staff session — failing ' +
      'closed rather than rendering an unfiltered, uncategorized persona list.',
    )
  }
  return response.data
}

export interface UsePersonasResult {
  readonly personas: readonly Persona[]
  readonly loading: boolean
  readonly error: unknown
}

export interface UseStaffPersonasResult {
  readonly personas: readonly StaffPersona[]
  readonly loading: boolean
  readonly error: unknown
}

/**
 * Shared body for the two persona hooks: a thin useState/useEffect wrapper
 * over the supplied resolver (ordinary cacheable data; a later refactor may
 * move both to React Query, the project default). `resolve` must be a stable
 * module-level function reference — both call sites pass one.
 */
function usePersonaResolution<T extends Persona>(resolve: () => Promise<T[]>): {
  readonly personas: readonly T[]
  readonly loading: boolean
  readonly error: unknown
} {
  const [personas, setPersonas] = useState<readonly T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    resolve()
      .then(resolved => {
        if (cancelled) return
        setPersonas(resolved)
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        // Fail closed: the list stays EMPTY (it is never populated before a
        // successful resolve) and the error is surfaced to the caller.
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [resolve])

  return { personas, loading, error }
}

/**
 * Resolves the exercise's persona instances (PARTICIPANT projection) for a
 * component — the feed maps posts to their authors from this set. Staff
 * components that need only the common fields (name/handle/avatar/verified)
 * may use this too; anything that reads the archetype must use
 * {@link useStaffPersonas}.
 */
export function usePersonas(): UsePersonasResult {
  return usePersonaResolution(resolvePersonas)
}

/**
 * Resolves the exercise's persona instances in the STAFF projection. Staff
 * world only. On a tokenless/participant-shaped response the hook reports an
 * error with an EMPTY persona list (fail-closed + visible), instead of a list
 * whose `personaType` is silently `undefined`.
 */
export function useStaffPersonas(): UseStaffPersonasResult {
  return usePersonaResolution(resolveStaffPersonas)
}

/**
 * The org-library persona templates (story 01). Reusable across exercises, so
 * this is a static read of the library, not an exercise-scoped resolution.
 *
 * MOCK SCAFFOLD — returns the canned seed library directly (not behind the
 * `USE_MOCK_PERSONAS` flip point). Fine for the current no-backend scaffold and
 * for staff/authoring tooling that is itself mock; the real library read lands
 * with the backend. Not a participant-surface read path.
 */
export function usePersonaTemplates(): readonly PersonaTemplate[] {
  return PERSONA_TEMPLATES
}
