/**
 * features/personas/personaService.ts
 * ---------------------------------------------------------------------------
 * The read seam for exercise-scoped persona INSTANCES (feature:
 * persona-management, story 02). `resolvePersonas()` is routed through the
 * shared axios client with a dev mock adapter (mirroring
 * `exerciseContextResolver`): in the current no-backend scaffold it returns the
 * Fairhaven baseline cast seeded for the mock exercise, so a Pulse feed has
 * believable authors; swapping the adapter for a live `/personas` endpoint
 * needs no consumer change.
 *
 * PRECEDENT — `resolvePersonas()` takes NO client `exerciseId` param: query
 * isolation is server-side (COR-001); the session already binds the exercise.
 * The mock resolves the ONE exercise's cast.
 *
 * `usePersonaTemplates()` exposes the org-library templates (NOT
 * exercise-scoped, story 01). Staff/data world — no UI, no COBRA.
 */

import { useEffect, useState } from 'react'
import type { AxiosAdapter } from 'axios'
import { api } from '@/core/services/api'
import { USE_MOCK_DATA } from '@/core/config/mockData'
import { PERSONA_TEMPLATES } from './personaTemplates'
import { FAIRHAVEN_BASELINE } from './casts'
import { seedCast } from './seedCast'
import type { Persona, PersonaTemplate } from './types'

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
export const SEEDED_PERSONAS: readonly Persona[] = seedCast(
  FAIRHAVEN_BASELINE,
  MOCK_EXERCISE_ID,
  PERSONA_TEMPLATES,
)

/**
 * Look up a seeded persona instance by id (undefined if absent). MOCK SCAFFOLD
 * — same caveat as {@link SEEDED_PERSONAS}: mock fixtures + tests only, never a
 * shipped participant surface (use `usePersonas()` there).
 */
export function personaById(id: string): Persona | undefined {
  return SEEDED_PERSONAS.find(p => p.id === id)
}

/** Short-circuits the network with the seeded cast, exercising the axios pipeline. */
const mockAdapter: AxiosAdapter = config => Promise.resolve({
  data: SEEDED_PERSONAS,
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
    typeof p.verified === 'boolean'
  )
}

function isPersonaArray(data: unknown): data is Persona[] {
  return Array.isArray(data) && data.every(isValidPersona)
}

/**
 * Resolves the current exercise's seeded persona instances. Throws on request
 * failure or a malformed body (fail-closed — no default/empty author set is
 * silently substituted).
 */
export async function resolvePersonas(): Promise<Persona[]> {
  const response = await api.get<Persona[]>(
    '/personas',
    USE_MOCK_PERSONAS ? { adapter: mockAdapter } : undefined,
  )
  if (!isPersonaArray(response.data)) {
    throw new Error('resolvePersonas: resolution returned a malformed persona set')
  }
  return response.data
}

export interface UsePersonasResult {
  readonly personas: readonly Persona[]
  readonly loading: boolean
  readonly error: unknown
}

/**
 * Resolves the exercise's persona instances for a component. A thin
 * useState/useEffect wrapper over `resolvePersonas()` — the feed maps posts to
 * their authors from this set. (Ordinary cacheable data; a later refactor may
 * move it to React Query, the project default.)
 */
export function usePersonas(): UsePersonasResult {
  const [personas, setPersonas] = useState<readonly Persona[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(undefined)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    resolvePersonas()
      .then(resolved => {
        if (cancelled) return
        setPersonas(resolved)
        setError(undefined)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  return { personas, loading, error }
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
