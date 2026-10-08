/**
 * features/personas/personaService.v2.test.ts
 * ---------------------------------------------------------------------------
 * CONTRACT v2 on the persona read seam (demo-polish F0, implementation.md
 * §1.5.6 / §1.11):
 *  - `avatarUrl` / `bannerUrl` / `location` are OPTIONAL: accepted when absent
 *    (every pre-v2 body), forwarded by `toParticipantPersona` when present, and a
 *    present-but-wrong-typed value fails CLOSED;
 *  - the seeded mock cast carries them (and the participant read still has NO
 *    `personaType` — SOC-052/D1-008 is unchanged);
 *  - `invalidatePersonas()` makes every mounted `usePersonas`/`useStaffPersonas`
 *    refetch (they are useState/useEffect hooks, not React Query), keeping the
 *    previous list on screen while it does.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import {
  invalidatePersonas,
  resolvePersonas,
  resolveStaffPersonas,
  SEEDED_PERSONAS,
  toParticipantPersona,
  usePersonas,
  useStaffPersonas,
} from './personaService'
import type { Persona, StaffPersona } from './types'

const WIRE: Persona = {
  id: 'persona-wire',
  exerciseId: 'ex-wire-0001',
  templateId: 'tmpl-wire',
  displayName: 'Wire Persona',
  handle: 'wirepersona',
  kind: 'org',
  verified: false,
  avatarColor: '#334455',
  initials: 'WP',
  audienceBand: 'micro',
  followerCount: 12,
  joinedAt: '2026-01-01T00:00:00.000Z',
}

function apiBody(data: unknown): Awaited<ReturnType<typeof api.get>> {
  return { data } as Awaited<ReturnType<typeof api.get>>
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('Persona v2 fields — read seam', () => {
  it('accepts a persona with avatarUrl / bannerUrl / location', async () => {
    const v2 = { ...WIRE, avatarUrl: 'https://blob/a.png', bannerUrl: 'https://blob/b.png', location: 'Fairhaven' }
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([v2]))

    const [persona] = await resolvePersonas()

    expect(persona).toMatchObject({
      avatarUrl: 'https://blob/a.png',
      bannerUrl: 'https://blob/b.png',
      location: 'Fairhaven',
    })
  })

  it('accepts a pre-v2 persona with none of them, leaving the keys genuinely absent', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([WIRE]))

    const [persona] = await resolvePersonas()

    expect(persona).not.toHaveProperty('avatarUrl')
    expect(persona).not.toHaveProperty('bannerUrl')
    expect(persona).not.toHaveProperty('location')
  })

  it.each([
    ['avatarUrl', { avatarUrl: 42 }],
    ['bannerUrl', { bannerUrl: { url: 'x' } }],
    ['location', { location: ['Fairhaven'] }],
  ])('fails closed when %s has the wrong type', async (_name, patch) => {
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([{ ...WIRE, ...patch }]))

    await expect(resolvePersonas()).rejects.toThrow(/malformed persona set/)
  })

  it('toParticipantPersona forwards them only when present', () => {
    const decorated = toParticipantPersona({ ...WIRE, avatarUrl: '/a.svg', location: 'Fulton County' })

    expect(decorated.avatarUrl).toBe('/a.svg')
    expect(decorated.location).toBe('Fulton County')
    expect(decorated).not.toHaveProperty('bannerUrl')
  })

  it('still keeps personaType off the participant read, v2 fields or not (SOC-052)', async () => {
    const staff: StaffPersona = { ...WIRE, personaType: 'bad-actor', avatarUrl: '/a.svg' }
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([staff]))

    const [persona] = await resolvePersonas()

    expect(persona).not.toHaveProperty('personaType')
    expect(persona?.avatarUrl).toBe('/a.svg')
  })

  it('carries the v2 fields on the staff read too', async () => {
    const staff: StaffPersona = { ...WIRE, personaType: 'agency', bannerUrl: '/b.svg', location: 'X' }
    vi.spyOn(api, 'get').mockResolvedValue(apiBody([staff]))

    const [persona] = await resolveStaffPersonas()

    expect(persona).toMatchObject({ personaType: 'agency', bannerUrl: '/b.svg', location: 'X' })
  })
})

describe('Persona v2 fields — the seeded mock cast', () => {
  it('serves avatars and banners through the participant mock read', async () => {
    const personas = await resolvePersonas()

    expect(personas.filter(p => p.avatarUrl !== undefined).length).toBeGreaterThanOrEqual(6)
    expect(personas.every(p => !('personaType' in p))).toBe(true)
    expect(personas.length).toBe(SEEDED_PERSONAS.length)
  })
})

describe('invalidatePersonas — the refetch signal for the useState/useEffect hooks', () => {
  it('refetches every mounted usePersonas() hook, without a loading flash', async () => {
    const get = vi.spyOn(api, 'get')
    const { result } = renderHook(() => usePersonas())
    await waitFor(() => expect(result.current.loading).toBe(false))
    const loadedList = result.current.personas
    expect(loadedList.length).toBeGreaterThan(0)
    const callsBefore = get.mock.calls.length

    act(() => {
      invalidatePersonas()
    })

    await waitFor(() => expect(get.mock.calls.length).toBe(callsBefore + 1))
    // The previous list stays on screen while the refetch is in flight.
    expect(result.current.personas.length).toBeGreaterThan(0)
    expect(result.current.loading).toBe(false)
    await waitFor(() => expect(result.current.personas).not.toBe(loadedList))
  })

  it('shows an updated persona after the refetch lands', async () => {
    const first = [{ ...WIRE, displayName: 'Before' }]
    const second = [{ ...WIRE, displayName: 'After' }]
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(apiBody(first)).mockResolvedValueOnce(apiBody(second))
    const { result } = renderHook(() => usePersonas())
    await waitFor(() => expect(result.current.personas[0]?.displayName).toBe('Before'))

    act(() => {
      invalidatePersonas()
    })

    await waitFor(() => expect(result.current.personas[0]?.displayName).toBe('After'))
    expect(get).toHaveBeenCalledTimes(2)
  })

  it('refetches the staff hook as well, and several mounted hooks at once', async () => {
    const get = vi.spyOn(api, 'get')
    const staff = renderHook(() => useStaffPersonas())
    const participant = renderHook(() => usePersonas())
    await waitFor(() => expect(staff.result.current.loading).toBe(false))
    await waitFor(() => expect(participant.result.current.loading).toBe(false))
    const callsBefore = get.mock.calls.length

    act(() => {
      invalidatePersonas()
    })

    await waitFor(() => expect(get.mock.calls.length).toBe(callsBefore + 2))
  })

  it('is a safe no-op with no hook mounted', () => {
    expect(() => invalidatePersonas()).not.toThrow()
  })

  it('does not refetch after the hook unmounts', async () => {
    const get = vi.spyOn(api, 'get')
    const { result, unmount } = renderHook(() => usePersonas())
    await waitFor(() => expect(result.current.loading).toBe(false))
    unmount()
    const callsBefore = get.mock.calls.length

    act(() => {
      invalidatePersonas()
    })

    expect(get.mock.calls.length).toBe(callsBefore)
  })
})
