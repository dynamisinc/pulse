/**
 * features/controller/engine/hooks/useEngineSettings.test.ts
 * ---------------------------------------------------------------------------
 * Covers the engine SETTINGS read/write hook (feature: autonomy-safety, story
 * 06 — rebuilt on the AWAIT-THEN-APPLY model; see the hook's own module header
 * for the full rebuild history):
 *  - MOCK mode renders a plausible static snapshot with NO network call, and
 *    a mutation applies instantly (there is no server to race);
 *  - LIVE mode fetches `GET /api/engine/settings` once per exercise and
 *    reflects loading/error states honestly;
 *  - `setAutonomyDefault`/`setTierPolicyMode` write NO speculative value —
 *    the clicked control's own `pending*` flag flips true while its POST is
 *    outstanding, `settings` is untouched until a response lands, the FULL
 *    authoritative DTO is applied verbatim on success, and on rejection the
 *    pending flag clears + the error surfaces with `settings` UNCHANGED
 *    (proved by reference equality — there is no revert, because nothing was
 *    ever asserted);
 *  - a 403 flips `forbidden` (STICKY — a later successful GET never clears
 *    it) rather than just showing a failed action;
 *  - SERIALIZATION: at most one request (the GET or either mutation) is ever
 *    outstanding per exercise — a mutation attempted while another request is
 *    in flight is a no-op (the UI already disables both controls whenever
 *    anything is in flight), and an explicit `refetch()` that arrives while a
 *    request is in flight is QUEUED, never dropped, firing once the
 *    in-flight one settles. This is what makes the historical "two mutations
 *    racing to overwrite each other's field, losing a genuinely successful
 *    change" Critical structurally UNREPRESENTABLE, not merely guarded;
 *  - per-exercise scoping (COR-001): a different exercise never observes
 *    another exercise's settings.
 *
 * `@/core/exerciseContext`, the sibling `controllerIdentity` module, and
 * `../services/engineSettingsActions` are mocked at the module boundary
 * (mirrors `useEngineControl.test.ts`). `@/core/config/mockData` is mocked via
 * a GETTER so the same file can toggle `USE_MOCK_DATA` between describe
 * blocks.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { useControllerIdentity, type ControllerIdentity } from '../../identity/controllerIdentity'
import * as engineSettingsActions from '../services/engineSettingsActions'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { engineSettingsStore, useEngineSettings } from './useEngineSettings'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))

let useMockData = true
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return useMockData
  },
}))

vi.mock('../services/engineSettingsActions', async () => {
  const actual = await vi.importActual<typeof import('../services/engineSettingsActions')>(
    '../services/engineSettingsActions',
  )
  return {
    ...actual,
    getSettings: vi.fn(),
    setAutonomyDefault: vi.fn(),
    setTierPolicyMode: vi.fn(),
  }
})

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)
const mockedGetSettings = vi.mocked(engineSettingsActions.getSettings)
const mockedSetAutonomyDefault = vi.mocked(engineSettingsActions.setAutonomyDefault)
const mockedSetTierPolicyMode = vi.mocked(engineSettingsActions.setTierPolicyMode)

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function identity(overrides: Partial<ControllerIdentity> = {}): ControllerIdentity {
  return {
    actingHumanId: 'human-controller-01',
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
    ...overrides,
  }
}

function dto(overrides: Partial<EngineSettingsDto> = {}): EngineSettingsDto {
  return {
    provider: 'Fake',
    tiers: [{ tier: 'Ambient', model: 'fake-ambient', deployment: 'ambient', zdrCapable: false }],
    autonomy: {
      swampedMode: false,
      generationStopped: false,
      safetyClampActive: false,
      degradedReason: null,
      exerciseDefaultLevel: 'suggest',
      effectiveLevel: 'suggest',
    },
    tierPolicyMode: 'auto',
    inMemoryState: true,
    inMemoryStateNote: 'reset on restart',
    ...overrides,
  }
}

beforeEach(() => {
  engineSettingsStore.resetForTests()
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  mockedUseControllerIdentity.mockReturnValue(identity())
  useMockData = true
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useEngineSettings — mock mode (USE_MOCK_DATA=true, the default)', () => {
  it('renders a plausible static snapshot with NO network call', () => {
    const { result } = renderHook(() => useEngineSettings())

    expect(result.current.loading).toBe(false)
    expect(result.current.settings).not.toBeNull()
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('suggest')
    expect(result.current.settings?.tierPolicyMode).toBe('auto')
    expect(mockedGetSettings).not.toHaveBeenCalled()
  })

  it('setAutonomyDefault flips the base default (and mirrors effectiveLevel, unclamped) with no live POST', () => {
    const { result } = renderHook(() => useEngineSettings())

    act(() => result.current.setAutonomyDefault('delayed-auto'))

    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('delayed-auto')
    expect(mockedSetAutonomyDefault).not.toHaveBeenCalled()
  })

  it('setTierPolicyMode flips the mode with no live POST', () => {
    const { result } = renderHook(() => useEngineSettings())

    act(() => result.current.setTierPolicyMode('standard'))

    expect(result.current.settings?.tierPolicyMode).toBe('standard')
    expect(mockedSetTierPolicyMode).not.toHaveBeenCalled()
  })

  it('is a no-op when the requested level/mode already matches', () => {
    const { result } = renderHook(() => useEngineSettings())
    const before = result.current.settings

    act(() => result.current.setAutonomyDefault('suggest'))
    act(() => result.current.setTierPolicyMode('auto'))

    expect(result.current.settings).toBe(before)
  })

  it('refetch() is a no-op under mock — no network call (there is nothing to refetch)', () => {
    const { result } = renderHook(() => useEngineSettings())

    act(() => result.current.refetch())

    expect(mockedGetSettings).not.toHaveBeenCalled()
  })
})

describe('useEngineSettings — per-exercise scoping (COR-001)', () => {
  it('a different exercise never observes another exercise\'s mutation', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-alpha'))
    const alpha = renderHook(() => useEngineSettings())
    act(() => alpha.result.current.setAutonomyDefault('delayed-auto'))
    expect(alpha.result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    alpha.unmount()

    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-bravo'))
    const bravo = renderHook(() => useEngineSettings())
    expect(bravo.result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
  })
})

describe('useEngineSettings — live mode (USE_MOCK_DATA=false)', () => {
  beforeEach(() => {
    useMockData = false
  })

  it('fetches GET /api/engine/settings once per exercise, reflecting loading then ready', async () => {
    let resolveGet: (value: EngineSettingsDto) => void = () => {}
    mockedGetSettings.mockReturnValue(new Promise(resolve => { resolveGet = resolve }))

    const { result } = renderHook(() => useEngineSettings())
    expect(result.current.loading).toBe(true)
    expect(result.current.settings).toBeNull()

    act(() => resolveGet(dto()))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.settings?.provider).toBe('Fake')
    expect(mockedGetSettings).toHaveBeenCalledTimes(1)
  })

  it('a second hook instance for the SAME exercise does not refire the GET', async () => {
    mockedGetSettings.mockResolvedValue(dto())

    renderHook(() => useEngineSettings())
    renderHook(() => useEngineSettings())

    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(1))
  })

  it('a failed GET records the error message and leaves settings null (fail-closed)', async () => {
    mockedGetSettings.mockRejectedValue(new Error('network down'))

    const { result } = renderHook(() => useEngineSettings())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.settings).toBeNull()
    expect(result.current.error).toMatch(/could not be applied/i)
  })

  it('setForTests genuinely bypasses the live fetch (Copilot review finding): mounting AFTER it does not fire the mount-effect GET', () => {
    // Before the fix, `setForTests` never recorded this exercise as
    // "already fetched", so `ensureLiveFetchStarted`'s mount effect would
    // still issue a real GET behind the seam's back — exactly the leak the
    // seam's own docs claimed did not exist.
    engineSettingsStore.setForTests('ex-mock-0001', dto({ tierPolicyMode: 'standard' }))

    const { result } = renderHook(() => useEngineSettings())

    expect(result.current.settings?.tierPolicyMode).toBe('standard')
    expect(result.current.loading).toBe(false)
    expect(mockedGetSettings).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------------
  // AWAIT, THEN APPLY — the headline behaviour this rebuild exists to prove.
  // -----------------------------------------------------------------------

  it('setAutonomyDefault writes NO speculative value: settings is untouched while the POST is outstanding, pendingAutonomyDefault is true, and the FULL authoritative response is applied verbatim on success', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    const settingsBeforeClick = result.current.settings

    let resolvePost: (value: EngineSettingsDto) => void = () => {}
    mockedSetAutonomyDefault.mockReturnValue(new Promise(resolve => { resolvePost = resolve }))

    act(() => result.current.setAutonomyDefault('delayed-auto'))

    // NOT optimistic — the displayed settings is EXACTLY what it was before
    // the click (same object), while the control shows in-flight.
    expect(result.current.settings).toBe(settingsBeforeClick)
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.pendingAutonomyDefault).toBe(true)
    expect(mockedSetAutonomyDefault).toHaveBeenCalledWith('delayed-auto', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })

    await act(async () => {
      resolvePost(
        dto({
          autonomy: {
            swampedMode: false,
            generationStopped: false,
            safetyClampActive: false,
            degradedReason: null,
            exerciseDefaultLevel: 'delayed-auto',
            effectiveLevel: 'delayed-auto',
          },
        }),
      )
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.pendingAutonomyDefault).toBe(false)
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('delayed-auto')
  })

  it('on rejection: there is NO revert (settings is untouched, same reference), the control re-enables, and the 400 body is surfaced verbatim', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    const settingsBeforeClick = result.current.settings

    const rejection = Object.assign(new Error('Bad Request'), {
      isAxiosError: true,
      response: { status: 400, data: 'delayed-auto is not selectable in v1' },
    })
    mockedSetAutonomyDefault.mockRejectedValue(rejection)

    await act(async () => {
      result.current.setAutonomyDefault('delayed-auto')
      await Promise.resolve()
      await Promise.resolve()
    })

    // Nothing was ever asserted, so there is nothing to revert — `settings`
    // is the EXACT SAME OBJECT it was before the click.
    expect(result.current.settings).toBe(settingsBeforeClick)
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.pendingAutonomyDefault).toBe(false)
    expect(result.current.error).toBe('delayed-auto is not selectable in v1')
    expect(result.current.forbidden).toBe(false)
  })

  it('pendingTierPolicy is completely unaffected by an autonomy-default mutation, and vice versa — independent per-control UI flags, not a reconciliation mechanism', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    mockedSetAutonomyDefault.mockReturnValue(new Promise(() => {})) // never resolves in this test
    act(() => result.current.setAutonomyDefault('delayed-auto'))

    expect(result.current.pendingAutonomyDefault).toBe(true)
    expect(result.current.pendingTierPolicy).toBe(false)
  })

  it('a 403 flips `forbidden` — the panel renders read-only rather than a failed action', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    const rejection = Object.assign(new Error('Forbidden'), {
      isAxiosError: true,
      response: { status: 403, data: 'Forbidden' },
    })
    mockedSetTierPolicyMode.mockRejectedValue(rejection)

    await act(async () => {
      result.current.setTierPolicyMode('ambient')
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.settings?.tierPolicyMode).toBe('auto')
    expect(result.current.forbidden).toBe(true)
  })

  it('WR-102: forbidden is STICKY — a later successful GET never clears it', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    mockedSetTierPolicyMode.mockRejectedValueOnce(
      Object.assign(new Error('Forbidden'), { isAxiosError: true, response: { status: 403, data: 'Forbidden' } }),
    )
    await act(async () => {
      result.current.setTierPolicyMode('standard')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.forbidden).toBe(true)

    // A subsequent refetch (e.g. re-opening the panel) succeeds — story 05's
    // GET stays 200 even for a non-controller (AC6), so a naive
    // `forbidden: false` on every GET success would silently re-enable the
    // controls here.
    act(() => result.current.refetch())
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(2))

    expect(result.current.forbidden).toBe(true)
  })

  // -----------------------------------------------------------------------
  // SERIALIZATION — the mechanism that makes the historical Criticals
  // (a shared sequence across two mutations losing a genuinely successful
  // change; a GET stealing ownership from an in-flight mutation) structurally
  // unrepresentable, rather than merely guarded after the fact.
  // -----------------------------------------------------------------------

  it('a mutation attempted while ANOTHER request is already in flight is a no-op (defensive — the UI already disables both controls whenever anything is in flight)', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    mockedSetAutonomyDefault.mockReturnValue(new Promise(() => {})) // never resolves
    act(() => result.current.setAutonomyDefault('delayed-auto'))
    expect(result.current.pendingAutonomyDefault).toBe(true)

    // Attempting the OTHER mutation while the first is still outstanding must
    // not issue a second concurrent request — this is the invariant that
    // makes "two mutations racing to overwrite each other's field" impossible.
    act(() => result.current.setTierPolicyMode('standard'))

    expect(mockedSetTierPolicyMode).not.toHaveBeenCalled()
    expect(result.current.pendingTierPolicy).toBe(false)
  })

  it('an explicit refetch() that arrives while a MUTATION is in flight is QUEUED (never dropped) and fires once the mutation settles', async () => {
    mockedGetSettings.mockResolvedValueOnce(dto()) // initial load
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())
    expect(mockedGetSettings).toHaveBeenCalledTimes(1)

    let resolvePost: (value: EngineSettingsDto) => void = () => {}
    mockedSetAutonomyDefault.mockReturnValue(new Promise(resolve => { resolvePost = resolve }))
    act(() => result.current.setAutonomyDefault('delayed-auto'))

    // A background refetch arrives (e.g. the kill switch settling elsewhere)
    // WHILE the mutation is outstanding — it must queue, not fire
    // concurrently (which would otherwise race the mutation's own landing).
    // Its OWN response (once it eventually fires, after the mutation has
    // already committed server-side) consistently reflects delayed-auto too
    // — a real server's GET would never contradict its own already-applied
    // mutation.
    mockedGetSettings.mockResolvedValueOnce(
      dto({
        tierPolicyMode: 'standard',
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: false,
          degradedReason: null,
          exerciseDefaultLevel: 'delayed-auto',
          effectiveLevel: 'delayed-auto',
        },
      }),
    )
    act(() => result.current.refetch())
    // still just the initial GET — queued, not fired
    expect(mockedGetSettings).toHaveBeenCalledTimes(1)

    act(() => {
      resolvePost(
        dto({
          autonomy: {
            swampedMode: false,
            generationStopped: false,
            safetyClampActive: false,
            degradedReason: null,
            exerciseDefaultLevel: 'delayed-auto',
            effectiveLevel: 'delayed-auto',
          },
        }),
      )
    })

    // The mutation's own success is applied first...
    await waitFor(() => expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto'))
    // ...and the QUEUED refetch then fires on its own (from the mutation's
    // `.finally`), never silently dropped.
    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.settings?.tierPolicyMode).toBe('standard'))
  })

  it('CR-101: a refetch() that arrives while ANOTHER GET is already in flight is QUEUED, never silently dropped', async () => {
    let resolveFirst: (value: EngineSettingsDto) => void = () => {}
    mockedGetSettings.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))

    const { result } = renderHook(() => useEngineSettings())
    expect(mockedGetSettings).toHaveBeenCalledTimes(1) // the initial mount GET, still in flight

    mockedGetSettings.mockResolvedValueOnce(dto({ tierPolicyMode: 'standard' }))
    act(() => result.current.refetch())
    expect(mockedGetSettings).toHaveBeenCalledTimes(1) // queued, not fired concurrently

    await act(async () => {
      resolveFirst(dto({ tierPolicyMode: 'auto' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.settings?.tierPolicyMode).toBe('standard'))
  })

  it('WR-004: a failed initial GET can be retried via refetch() rather than being a permanent dead end', async () => {
    mockedGetSettings.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.error).toMatch(/could not be applied/i))
    expect(result.current.settings).toBeNull()

    mockedGetSettings.mockResolvedValueOnce(dto())
    act(() => result.current.refetch())

    await waitFor(() => expect(result.current.settings).not.toBeNull())
    expect(result.current.error).toBeNull()
    expect(mockedGetSettings).toHaveBeenCalledTimes(2)
  })

  it('refetch() forces a fresh GET even after the initial one already completed, picking up a clamp applied out-of-band', async () => {
    mockedGetSettings.mockResolvedValueOnce(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings?.autonomy.safetyClampActive).toBe(false))
    expect(mockedGetSettings).toHaveBeenCalledTimes(1)

    // The kill switch trips server-side, entirely outside this hook.
    mockedGetSettings.mockResolvedValueOnce(
      dto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: true,
          degradedReason: 'kill switch engaged',
          exerciseDefaultLevel: 'suggest',
          effectiveLevel: 'suggest',
        },
      }),
    )

    act(() => result.current.refetch())

    expect(mockedGetSettings).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.settings?.autonomy.safetyClampActive).toBe(true))
    expect(result.current.settings?.autonomy.degradedReason).toBe('kill switch engaged')
  })
})
