/**
 * features/controller/engine/hooks/useEngineSettings.test.ts
 * ---------------------------------------------------------------------------
 * Covers the engine SETTINGS read/write hook (feature: autonomy-safety, story
 * 06):
 *  - MOCK mode renders a plausible static snapshot with NO network call;
 *  - LIVE mode fetches `GET /api/engine/settings` once per exercise and
 *    reflects loading/error states honestly;
 *  - `setAutonomyDefault`/`setTierPolicyMode` are OPTIMISTIC and REVERT on a
 *    rejected POST — the single most important behaviour in this story — in
 *    both mock and live modes, and a 403 flips `forbidden` (render read-only)
 *    rather than just showing a failed action;
 *  - a successful POST reconciles the ENTIRE settings object from the
 *    authoritative response (no follow-up GET);
 *  - per-exercise scoping (COR-001): a different exercise never observes
 *    another exercise's settings;
 *  - the optimistic autonomy-default patch mirrors `effectiveLevel` ONLY when
 *    no safety clamp is active — while clamped, `effectiveLevel` is left
 *    untouched by the optimistic patch (never guessed);
 *  - Gate-1 CR-002: a rejection reverts to the LAST SERVER-CONFIRMED
 *    snapshot, never a click-time optimistic value — proved with an EXACT
 *    repro (two never-resolved-until-rejected requests) where the old logic
 *    would revert to a stale, never-confirmed value;
 *  - Gate-1 WR-002: the "only the newest request owns the field" guard is
 *    proved OBSERVABLE (not tautological) via the 3-valued `tierPolicyMode`
 *    (`auto -> standard (pending) -> ambient (resolves) -> reject standard`
 *    stays at `ambient`, not `auto`), and doubles as WR-003 coverage (no
 *    stale error banner over an already-successful change);
 *  - Gate-1 CR-001: `refetch()` forces a fresh GET regardless of whether one
 *    already completed, picking up a clamp the kill switch applied entirely
 *    outside this hook; Gate-1 WR-004: a failed initial GET is retried the
 *    same way rather than being a permanent dead end;
 *  - Gate-1 re-review CR-101: a `refetch()` that arrives while one is already
 *    in flight is QUEUED (never silently dropped) and runs once the in-flight
 *    one settles;
 *  - Gate-1 re-review CR-102: sequencing is PER FIELD, not per resource — an
 *    exact cross-field repro proves a tier-policy rejection never reverts an
 *    in-flight autonomy-default change, and that change's later success never
 *    erases the tier-policy rejection's error message;
 *  - Gate-1 re-review WR-101: the GET participates in the SAME per-field
 *    sequencing as the mutations, so a GET issued before a mutation but
 *    resolving after it cannot clobber that field or corrupt its revert
 *    baseline;
 *  - Gate-1 re-review WR-102: `forbidden` is STICKY — a later successful GET
 *    (including this hook's own open-transition refetch) never clears it.
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

  it('setAutonomyDefault optimistically flips, calls the live POST, and reconciles from the authoritative response', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    mockedSetAutonomyDefault.mockResolvedValue(
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

    act(() => result.current.setAutonomyDefault('delayed-auto'))

    // Optimistic — flips immediately, before the POST resolves.
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(mockedSetAutonomyDefault).toHaveBeenCalledWith('delayed-auto', {
      actingHumanId: 'human-controller-01',
      timeZone: 'America/New_York',
    })

    await waitFor(() => expect(result.current.settings?.autonomy.effectiveLevel).toBe('delayed-auto'))
  })

  it('reverts ONLY the changed field when the live POST rejects, and records the 400 body verbatim', async () => {
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

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

    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.error).toBe('delayed-auto is not selectable in v1')
    expect(result.current.forbidden).toBe(false)
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

  it('does not touch effectiveLevel optimistically while a safety clamp is active', async () => {
    mockedGetSettings.mockResolvedValue(
      dto({
        autonomy: {
          swampedMode: false,
          generationStopped: false,
          safetyClampActive: true,
          degradedReason: 'provider degraded',
          exerciseDefaultLevel: 'suggest',
          effectiveLevel: 'suggest',
        },
      }),
    )
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    mockedSetAutonomyDefault.mockReturnValue(new Promise(() => {})) // never resolves in this test

    act(() => result.current.setAutonomyDefault('delayed-auto'))

    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    // Still clamped to Suggest — the optimistic patch never claims a raise the
    // clamp would reject.
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('suggest')
  })

  // ---------------------------------------------------------------------
  // Gate-1 CR-002 / WR-002 — the revert baseline must be the LAST
  // SERVER-CONFIRMED snapshot, never a click-time optimistic value; a stale
  // rejection must be discarded ENTIRELY (no error, no revert), not merely
  // "declined to revert" (that guard alone still leaves a stale-failure
  // error banner — WR-003).
  // ---------------------------------------------------------------------

  it('CR-002 exact repro: reverts to the TRUE last-confirmed baseline, never a stale click-time optimistic value, when BOTH requests reject', async () => {
    // Confirmed server baseline: 'suggest'.
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    let rejectA: (reason?: unknown) => void = () => {}
    let rejectB: (reason?: unknown) => void = () => {}
    mockedSetAutonomyDefault
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectA = reject }))
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectB = reject }))

    // A: click Delayed-auto — optimistic 'delayed-auto', POST A pending.
    act(() => result.current.setAutonomyDefault('delayed-auto'))
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')

    // B: click Suggest — optimistic 'suggest' (a NEW request; B's own
    // click-time snapshot is A's still-UNCONFIRMED 'delayed-auto' — the
    // exact value the old, buggy revert-to-click-time-snapshot logic would
    // have produced below).
    act(() => result.current.setAutonomyDefault('suggest'))
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')

    // A rejects first — STALE (a newer request, B, has since been issued).
    // Must be discarded entirely: no revert, no error.
    await act(async () => {
      rejectA(Object.assign(new Error('stale'), { isAxiosError: true, response: { status: 500, data: '' } }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.error).toBeNull()

    // B rejects too — the NEWEST request, so it owns the field. Neither POST
    // ever succeeded, so the display must revert to the ORIGINAL
    // server-confirmed 'suggest' — NOT to A's stale, never-confirmed
    // 'delayed-auto' (the CR-002 bug: reverting to whatever was on screen
    // when B was clicked, which was A's unconfirmed optimistic guess).
    await act(async () => {
      rejectB(Object.assign(new Error('Bad Request'), { isAxiosError: true, response: { status: 400, data: 'rejected' } }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('suggest')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('suggest')
    expect(result.current.error).toBe('rejected')
  })

  // Gate-1 S-101 (re-review correction): this test's assertion that actually
  // proves the guard is doing work is `expect(result.current.error).toBeNull()`
  // — NOT the `tierPolicyMode` value. Under the current (correct)
  // implementation, an UNGUARDED revert-on-rejection would land on
  // `confirmedSettings.tierPolicyMode`, which by this point in the repro IS
  // `'ambient'` (B's own success already advanced the confirmed baseline) —
  // so the `tierPolicyMode` assertion alone would pass even with the "is this
  // still the newest issued request for this field" guard deleted. The
  // `error` assertion is what a deleted guard actually breaks (an unguarded
  // implementation writes A's stale rejection message, clobbering the fact
  // that B already succeeded) — do not "tidy away" that assertion.
  it('WR-002 guard is OBSERVABLE (not tautological): auto -> standard (A pending) -> ambient (B resolves, confirmed) -> reject A leaves it at ambient, with no stale error', async () => {
    mockedGetSettings.mockResolvedValue(dto()) // tierPolicyMode: 'auto'
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    let rejectA: (reason?: unknown) => void = () => {}
    mockedSetTierPolicyMode.mockImplementationOnce(
      () => new Promise((_, reject) => { rejectA = reject }),
    )

    // A: 'standard' — optimistic, POST A pending.
    act(() => result.current.setTierPolicyMode('standard'))
    expect(result.current.settings?.tierPolicyMode).toBe('standard')

    // B: 'ambient' — a NEWER request, resolves successfully and becomes the
    // confirmed baseline.
    mockedSetTierPolicyMode.mockResolvedValueOnce(dto({ tierPolicyMode: 'ambient' }))
    act(() => result.current.setTierPolicyMode('ambient'))
    await waitFor(() => expect(result.current.settings?.tierPolicyMode).toBe('ambient'))

    // A (stale) rejects. Discarded entirely — must NOT revert to 'auto'
    // (the value showing when A was issued) and must NOT raise an error over
    // B's already-successful change (WR-003).
    await act(async () => {
      rejectA(Object.assign(new Error('stale'), { isAxiosError: true, response: { status: 500, data: '' } }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.settings?.tierPolicyMode).toBe('ambient')
    expect(result.current.error).toBeNull()
  })

  // ---------------------------------------------------------------------
  // Gate-1 CR-001 — the settings snapshot must be refreshable on demand, so
  // a sibling mutation of the SAME server-side autonomy state (the kill
  // switch) or an operator about to look (the flyout opening) is never
  // served a stale, fetch-once cache.
  // ---------------------------------------------------------------------

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

  it('CR-101: a refetch() that arrives while one is already in flight is QUEUED, never silently dropped', async () => {
    let resolveFirst: (value: EngineSettingsDto) => void = () => {}
    mockedGetSettings.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve }))

    const { result } = renderHook(() => useEngineSettings())
    expect(mockedGetSettings).toHaveBeenCalledTimes(1) // the initial mount GET, still in flight

    // A second refetch arrives (e.g. the kill switch settles) WHILE the first
    // is still in flight — must be QUEUED, not dropped.
    mockedGetSettings.mockResolvedValueOnce(dto({ tierPolicyMode: 'standard' }))
    act(() => result.current.refetch())
    // Still only ONE call has actually been ISSUED — the second is queued,
    // not fired concurrently (dedupe against a fetch already in flight).
    expect(mockedGetSettings).toHaveBeenCalledTimes(1)

    // The first GET resolves — the queued refetch must now fire on its own,
    // from the `.finally`, rather than being treated as already satisfied.
    await act(async () => {
      resolveFirst(dto({ tierPolicyMode: 'auto' }))
      await Promise.resolve()
      await Promise.resolve()
    })

    await waitFor(() => expect(mockedGetSettings).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.settings?.tierPolicyMode).toBe('standard'))
  })

  // ---------------------------------------------------------------------
  // Gate-1 re-review CR-102 — sequencing MUST be per field, not per
  // resource. A counter shared across both mutation kinds let a rejection of
  // ONE field revert the WHOLE display, including the OTHER field's
  // still-in-flight (and later successful) change, whose authoritative
  // response then had nowhere to land.
  // ---------------------------------------------------------------------

  it("CR-102 exact cross-field repro: a tier-policy rejection must NOT revert an in-flight autonomy-default change, and that change's later success must NOT erase the tier-policy rejection's error", async () => {
    // Server: autonomy=suggest, tier=auto.
    mockedGetSettings.mockResolvedValue(dto())
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    let resolveAutonomy: (value: EngineSettingsDto) => void = () => {}
    mockedSetAutonomyDefault.mockReturnValueOnce(
      new Promise(resolve => { resolveAutonomy = resolve }),
    )
    let rejectTier: (reason?: unknown) => void = () => {}
    mockedSetTierPolicyMode.mockReturnValueOnce(new Promise((_, reject) => { rejectTier = reject }))

    // 1. click Delayed-auto — autonomy-default field, POST pending.
    act(() => result.current.setAutonomyDefault('delayed-auto'))
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')

    // 2. click tier "Standard" — a DIFFERENT field, its own POST pending.
    act(() => result.current.setTierPolicyMode('standard'))
    expect(result.current.settings?.tierPolicyMode).toBe('standard')

    // 3. the tier-policy POST rejects 400 (exactly story 05's real shape for
    // an unbound tier against the Fake provider — see MOCK_ENGINE_SETTINGS's
    // own `deployment: ''`). Only the TIER field may be affected.
    await act(async () => {
      rejectTier(Object.assign(new Error('Bad Request'), {
        isAxiosError: true,
        response: { status: 400, data: "tier 'Standard' has no deployment configured" },
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    // The tier field reverted to its confirmed value ('auto') — but the
    // autonomy-default field, still in flight, must be COMPLETELY UNTOUCHED.
    expect(result.current.settings?.tierPolicyMode).toBe('auto')
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(result.current.error).toBe("tier 'Standard' has no deployment configured")

    // 4. the autonomy-default POST now succeeds, confirming 'delayed-auto'.
    await act(async () => {
      resolveAutonomy(
        dto({
          tierPolicyMode: 'auto', // irrelevant to this field's own merge — ignored
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

    // The GATE-1 CR-102 assertion: the server's genuinely-applied
    // 'delayed-auto' must be REFLECTED, never silently reverted to 'suggest'
    // (the whole-object-revert bug) — and the tier field (already fixed in
    // step 3) stays exactly as it was.
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('delayed-auto')
    expect(result.current.settings?.tierPolicyMode).toBe('auto')
    // The tier-policy rejection's error must SURVIVE the unrelated
    // autonomy-default success — an unrelated field succeeding must never
    // erase the report that THIS field's own change was refused.
    expect(result.current.error).toBe("tier 'Standard' has no deployment configured")
  })

  // ---------------------------------------------------------------------
  // Gate-1 re-review WR-101 — the GET must participate in the SAME per-field
  // sequencing as the mutations, so a GET issued before a mutation but
  // resolving after it cannot overwrite that mutation's just-confirmed field
  // (or corrupt that field's revert baseline) with pre-mutation data.
  // ---------------------------------------------------------------------

  it('WR-101: a GET issued before a mutation but resolving after it does not clobber that field or corrupt its revert baseline', async () => {
    mockedGetSettings.mockResolvedValueOnce(dto()) // initial load
    const { result } = renderHook(() => useEngineSettings())
    await waitFor(() => expect(result.current.settings).not.toBeNull())

    // A refetch is issued (e.g. the panel opening) and held pending.
    let resolveRefetch: (value: EngineSettingsDto) => void = () => {}
    mockedGetSettings.mockReturnValueOnce(new Promise(resolve => { resolveRefetch = resolve }))
    act(() => result.current.refetch())

    // While that GET is still in flight, an autonomy-default mutation is
    // issued AFTER it and resolves quickly — it is now the newest attempt
    // for that field.
    mockedSetAutonomyDefault.mockResolvedValueOnce(
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
    await act(async () => {
      result.current.setAutonomyDefault('delayed-auto')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')

    // NOW the stale GET (issued before the mutation) finally resolves,
    // carrying PRE-mutation data ('suggest'). It must NOT overwrite the
    // mutation's just-confirmed field.
    await act(async () => {
      resolveRefetch(dto()) // 'suggest' — stale relative to the mutation above
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
    expect(result.current.settings?.autonomy.effectiveLevel).toBe('delayed-auto')

    // The revert baseline must also be uncorrupted: a LATER rejection of a
    // NEW autonomy-default attempt must revert to 'delayed-auto' (the true
    // confirmed value), never back to the stale GET's 'suggest'.
    mockedSetAutonomyDefault.mockRejectedValueOnce(
      Object.assign(new Error('Bad Request'), { isAxiosError: true, response: { status: 400, data: 'no' } }),
    )
    await act(async () => {
      result.current.setAutonomyDefault('suggest')
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(result.current.settings?.autonomy.exerciseDefaultLevel).toBe('delayed-auto')
  })

  // ---------------------------------------------------------------------
  // Gate-1 re-review WR-102 — `forbidden` is STICKY: a later successful GET
  // (including this hook's own open-transition refetch) must never clear it.
  // ---------------------------------------------------------------------

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
})
