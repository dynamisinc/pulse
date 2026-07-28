/**
 * features/personas/personaService.test.ts
 * ---------------------------------------------------------------------------
 * Boundary-mocked + shipped-path coverage for the persona read seam. The axios
 * client is mocked at the boundary to exercise the resolvers' validation (a
 * malformed body fails closed); separate no-mock blocks exercise the ACTUAL
 * wired mock adapters (Wave-0 precedent 19), so the default author set is
 * really tested. Also covers `personaById` and `usePersonaTemplates`.
 *
 * THE WORLD SPLIT (SOC-052 / D1-008; profiles-social-graph backend story 06)
 * is the load-bearing thing here: `GET /personas` projects `personaType` for a
 * live STAFF session and omits it for everyone else. These tests pin both
 * halves — the participant read never carries the archetype tell (not even
 * when the wire body does), and the staff read FAILS CLOSED rather than hand
 * back personas whose `personaType` is `undefined`.
 *
 * The final block covers WR-005 (#88/#121): the mock adapter composes
 * `followerCount` from the LIVE mock follow-edge store on every request, the
 * way the live server composes it, instead of serving the frozen seed-time
 * number `SEEDED_PERSONAS` computed once at module load.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { api } from '@/core/services/api'
import {
  followPersona,
  unfollowPersona,
  resetMockFollowEdges,
} from '@/features/social/services/followService'
import {
  resolvePersonas,
  resolveStaffPersonas,
  toParticipantPersona,
  personaById,
  usePersonaTemplates,
  usePersonas,
  useStaffPersonas,
  SEEDED_PERSONAS,
} from './personaService'
import { isPersonaType, type StaffPersona } from './types'

/** A single wire-shaped STAFF persona (what a live staff session receives). */
const STAFF_WIRE_PERSONA: StaffPersona = {
  id: 'persona-wire',
  exerciseId: 'ex-wire-0001',
  templateId: 'tmpl-wire',
  displayName: 'Wire Persona',
  handle: 'wirepersona',
  kind: 'org',
  personaType: 'bad-actor',
  verified: false,
  avatarColor: '#334455',
  initials: 'WP',
  bio: 'Wire fixture.',
  audienceBand: 'micro',
  followerCount: 12,
  joinedAt: '2026-01-01T00:00:00.000Z',
}

/** Casts an arbitrary body into the shape `api.get`'s mock return expects. */
function apiBody(data: unknown): Awaited<ReturnType<typeof api.get>> {
  return { data } as Awaited<ReturnType<typeof api.get>>
}

describe('resolvePersonas (shipped mock path)', () => {
  it('resolves the seeded Fairhaven cast with the verified/unverified pair present', async () => {
    const personas = await resolvePersonas()
    expect(personas.length).toBe(SEEDED_PERSONAS.length)

    const real = personas.find(p => p.handle === 'FairhavenWater')
    const fake = personas.find(p => p.handle === 'FairhavenWaterUpd')
    expect(real?.verified).toBe(true)
    expect(fake?.verified).toBe(false)
  })

  it('never carries personaType — the impersonator is identifiable only by the missing seal', async () => {
    const personas = await resolvePersonas()

    for (const persona of personas) {
      expect(persona).not.toHaveProperty('personaType')
    }

    // The SOC-052 point, concretely: the seeded cast DOES contain a bad actor
    // (the staff projection proves it), and the participant read still hands
    // back nothing that distinguishes it beyond `verified`.
    const badActor = SEEDED_PERSONAS.find(p => p.personaType === 'bad-actor')
    expect(badActor).toBeDefined()
    const asParticipantSees = personas.find(p => p.id === badActor?.id)
    expect(asParticipantSees).toBeDefined()
    expect(asParticipantSees).not.toHaveProperty('personaType')
    expect(asParticipantSees?.verified).toBe(false)
  })
})

describe('resolvePersonas (world split at the wire)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('strips personaType even when the response body carries it', async () => {
    // e.g. a staff-token browser rendering a participant preview: the endpoint
    // answers with the staff projection, but nothing participant-facing may
    // ever see the archetype.
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([STAFF_WIRE_PERSONA]))

    const [persona] = await resolvePersonas()
    // Guard rather than `!` — keeps the rest of the assertions strictly typed.
    if (!persona) throw new Error('expected the mocked body to resolve one persona')

    expect(persona).not.toHaveProperty('personaType')
    // …while every participant-safe field survives intact.
    expect(persona.id).toBe('persona-wire')
    expect(persona.handle).toBe('wirepersona')
    expect(persona.verified).toBe(false)
    expect(persona.bio).toBe('Wire fixture.')
    expect(persona.followerCount).toBe(12)
    expect(persona.joinedAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('toParticipantPersona', () => {
  it('omits personaType structurally rather than blanking it', () => {
    const narrowed = toParticipantPersona(STAFF_WIRE_PERSONA)
    expect(narrowed).not.toHaveProperty('personaType')
    expect(Object.keys(narrowed)).not.toContain('personaType')
  })

  it('omits an absent optional bio rather than emitting an undefined key', () => {
    const { bio: _bio, ...withoutBio } = STAFF_WIRE_PERSONA
    const narrowed = toParticipantPersona(withoutBio)
    expect(narrowed).not.toHaveProperty('bio')
  })
})

describe('resolveStaffPersonas', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('resolves the seeded cast WITH an in-vocabulary personaType (shipped mock path)', async () => {
    const personas = await resolveStaffPersonas()
    expect(personas.length).toBe(SEEDED_PERSONAS.length)
    for (const persona of personas) {
      expect(isPersonaType(persona.personaType)).toBe(true)
    }
    expect(personas.some(p => p.personaType === 'bad-actor')).toBe(true)
  })

  it('fails closed when the endpoint answers with the PARTICIPANT projection', async () => {
    // The tokenless / non-staff-session case: every element is a valid
    // participant persona, but none carries an archetype. Returning these
    // would leave `personaType` undefined — the picker's type filter would
    // match nothing and the category chip would render unlabeled.
    const participantShaped = SEEDED_PERSONAS.map(toParticipantPersona)
    vi.spyOn(api, 'get').mockResolvedValue(apiBody(participantShaped))

    await expect(resolveStaffPersonas()).rejects.toThrow(/personaType/)
  })

  it('fails closed on an out-of-vocabulary personaType', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      apiBody([{ ...STAFF_WIRE_PERSONA, personaType: 'sock-puppet' }]),
    )

    await expect(resolveStaffPersonas()).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting a default cast', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolveStaffPersonas()).rejects.toThrow('network down')
  })
})

describe('resolvePersonas (validation boundary)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('fails closed when the resolved body is not a persona array', async () => {
    vi.spyOn(api, 'get').mockResolvedValue({ data: { nope: true } } as Awaited<ReturnType<typeof api.get>>)
    await expect(resolvePersonas()).rejects.toThrow()
  })

  it('propagates a request failure rather than substituting a default cast', async () => {
    vi.spyOn(api, 'get').mockRejectedValue(new Error('network down'))
    await expect(resolvePersonas()).rejects.toThrow('network down')
  })
})

describe('the two hooks (world split, fail-closed)', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('usePersonas exposes the participant projection (no personaType)', async () => {
    const { result } = renderHook(() => usePersonas())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeUndefined()
    expect(result.current.personas.length).toBeGreaterThan(0)
    for (const persona of result.current.personas) {
      expect(persona).not.toHaveProperty('personaType')
    }
  })

  it('useStaffPersonas exposes the archetype for staff consumers', async () => {
    const { result } = renderHook(() => useStaffPersonas())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.error).toBeUndefined()
    expect(result.current.personas.length).toBeGreaterThan(0)
    for (const persona of result.current.personas) {
      expect(isPersonaType(persona.personaType)).toBe(true)
    }
  })

  it('useStaffPersonas reports an error and an EMPTY list on a participant-shaped read', async () => {
    // The scenario the type split exists to make impossible-by-construction:
    // a staff surface reaching `/personas` without a live staff session. It
    // must fail closed and VISIBLY (empty list + error), never hand back
    // personas whose archetype is silently `undefined`.
    vi.spyOn(api, 'get').mockResolvedValue(apiBody(SEEDED_PERSONAS.map(toParticipantPersona)))

    const { result } = renderHook(() => useStaffPersonas())
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.personas).toEqual([])
    expect(result.current.error).toBeInstanceOf(Error)
  })
})

describe('personaById', () => {
  it('finds a seeded instance by its stable id', () => {
    expect(personaById('persona-fulcoem')?.handle).toBe('FulcoEM')
  })

  it('returns undefined for an unknown id', () => {
    expect(personaById('persona-nobody')).toBeUndefined()
  })
})

describe('mock adapter — follower count composed from the live edge store (WR-005)', () => {
  /** NANO-band citizen: a sub-1,000 seed count, so a ±1 is unambiguous. */
  const TARGET_ID = 'persona-tbrandt41'

  beforeEach(() => {
    vi.restoreAllMocks()
    resetMockFollowEdges()
  })

  afterEach(() => {
    resetMockFollowEdges()
  })

  /** The seed-time magnitude, guarded rather than `!`-asserted. */
  function seededMagnitude(): number {
    const persona = personaById(TARGET_ID)
    if (!persona) throw new Error(`expected seeded persona fixture: ${TARGET_ID}`)
    return persona.audienceMagnitude ?? persona.followerCount
  }

  /** The participant-projection read of `TARGET_ID`, guarded. */
  async function readTarget() {
    const persona = (await resolvePersonas()).find(p => p.id === TARGET_ID)
    if (!persona) throw new Error(`expected ${TARGET_ID} in the resolved cast`)
    return persona
  }

  it('recomposes followerCount as a mock follow lands and is undone', async () => {
    // Before WR-005 this number was frozen for the whole page session (and
    // across a reload): `SEEDED_PERSONAS` is computed once at module load, and
    // the mock follow write only mutates `followEdgeStore`. Live mode
    // recomposed on every read (`GetEdgeCountsAsync`), so the two modes
    // disagreed — and `VITE_USE_MOCK_DATA=true` is UAT's own setting, i.e. the
    // frozen half was the one being demoed.
    const magnitude = seededMagnitude()
    expect(await readTarget()).toMatchObject({ followerCount: magnitude })

    await followPersona(TARGET_ID)
    expect(await readTarget()).toMatchObject({ followerCount: magnitude + 1 })

    await unfollowPersona(TARGET_ID)
    expect(await readTarget()).toMatchObject({ followerCount: magnitude })
  })

  it('leaves audienceMagnitude RAW — only the composed total moves', async () => {
    // `audienceMagnitude` is carried separately precisely so nothing recomposes
    // it and double-counts the edges (see `social/services/audience.ts`).
    const magnitude = seededMagnitude()
    await followPersona(TARGET_ID)

    const persona = await readTarget()
    expect(persona.audienceMagnitude).toBe(magnitude)
    expect(persona.followerCount).toBe(magnitude + 1)
  })

  it('composes the STAFF projection the same way', async () => {
    const magnitude = seededMagnitude()
    await followPersona(TARGET_ID)

    const persona = (await resolveStaffPersonas()).find(p => p.id === TARGET_ID)
    expect(persona?.followerCount).toBe(magnitude + 1)
    expect(persona?.audienceMagnitude).toBe(magnitude)
  })
})

describe('usePersonaTemplates', () => {
  it('returns the org-library templates (reusable, not exercise-scoped)', () => {
    const templates = usePersonaTemplates()
    expect(templates.length).toBeGreaterThan(0)
    // Templates carry no exercise binding.
    for (const t of templates) {
      expect(t).not.toHaveProperty('exerciseId')
    }
  })
})
