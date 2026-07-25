/**
 * features/controller/hooks/useStorylineTarget.test.ts
 * ---------------------------------------------------------------------------
 * Covers the escalation dial's target-management hook (feature: world-
 * steering, story 02 — "Escalation dial — actual + target, engine follows";
 * CTL-022 / D5-014/2.2, XC-004, COR-001, XC-002; story 09 — "Escalation dial
 * live" adds the live-mode describe block near the bottom):
 *
 *  - exposes the mock storyline's actual `intensity`/`phase`/`phaseLabel`,
 *    reacting to a store change (`useSyncExternalStore`);
 *  - `setTarget` clamps 0-100, records the change on the mock storyline
 *    (mirroring `Storyline.SetTargetIntensity`'s from/to semantics), and
 *    exposes the exact transition detail (`lastChangeDetail`) — the value
 *    `<EscalationDial>` renders verbatim;
 *  - `clearTarget` unsets the target (`targetIntensity` -> `null`);
 *  - a call that resolves to the SAME value as the current target is a no-op
 *    — records/emits NOTHING (Gate-1 Minor: no redundant "100 -> 100" events);
 *  - each (non-no-op) call emits exactly ONE `steering_action` telemetry event (XC-004)
 *    with `channel: 'system'`, `actor: { kind: 'system', actingHumanId, role }`,
 *    `target: { entityType: 'storyline', entityId }`, and a payload carrying
 *    the before/after detail — scoped to the active exercise (`exerciseId`
 *    stamping-only, COR-001);
 *  - the exposed `targetIntensity` is the seam a future (Phase 2) engine-
 *    follow tick would consume — captured/exposed now, moving nothing itself
 *    (actual intensity is untouched by a target set/clear this phase).
 *
 * `@/core/exerciseContext` and the sibling `controllerIdentity` module are
 * mocked at the module boundary (mirrors `useEngineControl.test.ts` /
 * `useDemandMeter.test.ts`). `@/core/config/mockData` is mocked via a GETTER
 * (toggleable per describe block, default `true`) so the live-mode block near
 * the bottom can flip `USE_MOCK_DATA` to `false` for its own tests only —
 * mirrors `useEngineControl.test.ts` exactly. `../services/liveStorylineActions`
 * is mocked wholesale for the live block (never a real network call); the
 * REAL `liveStorylineStore` is used (reset between tests) so its snapshot/
 * reconcile behavior is exercised for real.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity, type ControllerIdentity } from '../identity/controllerIdentity'
import { MOCK_STORYLINE_ID, storylineMock } from '../services/storylineMock'
import * as liveStorylineActions from '../services/liveStorylineActions'
import { liveStorylineStore } from '../services/liveStorylineStore'
import { useStorylineTarget } from './useStorylineTarget'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))
vi.mock('../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(),
}))
// The real telemetry sink fire-and-forgets a POST through the shared axios
// client; with no backend that rejects ASYNCHRONOUSLY and logs during teardown
// (a vitest "onUserConsoleLog while closing rpc" worker race). Resolve the POST
// so emission stays synchronous — mirrors `core/telemetry/mockSink.test.ts`.
vi.mock('@/core/services/api', () => ({
  api: { post: vi.fn().mockResolvedValue(undefined) },
}))

/**
 * Toggled per-describe-block. Default `true` (mock mode — matches dev/UAT
 * and every pre-existing test above/below). The live-mode block flips this to
 * `false` for its own tests via a `beforeEach`; the top-level `beforeEach`
 * resets it to `true` so mock-mode coverage is unaffected.
 */
let useMockData = true
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return useMockData
  },
}))

vi.mock('../services/liveStorylineActions', async () => {
  const actual = await vi.importActual<typeof liveStorylineActions>('../services/liveStorylineActions')
  return {
    PRIMARY_STORYLINE_SENTINEL: actual.PRIMARY_STORYLINE_SENTINEL,
    getStoryline: vi.fn(),
    setStorylineTarget: vi.fn(),
  }
})

const mockedGetStoryline = vi.mocked(liveStorylineActions.getStoryline)
const mockedSetStorylineTarget = vi.mocked(liveStorylineActions.setStorylineTarget)

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedUseControllerIdentity = vi.mocked(useControllerIdentity)

const EX = 'ex-mock-0001'
const HUMAN = 'human-controller-01'
const SCENARIO_TIME = '2033-09-04T14:00:00.000Z'

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function identity(overrides: Partial<ControllerIdentity> = {}): ControllerIdentity {
  return {
    actingHumanId: HUMAN,
    callSign: 'SIMCELL-1',
    role: 'controller',
    isLead: true,
    ...overrides,
  }
}

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'steering_action')
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date(SCENARIO_TIME) })
  storylineMock.resetForTests()
  liveStorylineStore.resetForTests()
  resetTelemetryBuffer()
  mockedUseExerciseContext.mockReturnValue(scopeFor(EX))
  mockedUseControllerIdentity.mockReturnValue(identity())
  useMockData = true
  mockedGetStoryline.mockReset()
  mockedSetStorylineTarget.mockReset()
})

afterEach(() => {
  resetExerciseClock()
  liveStorylineStore.resetForTests()
  vi.clearAllMocks()
})

describe('useStorylineTarget — actual state', () => {
  it("exposes the mock storyline's seeded intensity/phase/phaseLabel and an unset target", () => {
    const { result } = renderHook(() => useStorylineTarget())

    expect(result.current.intensity).toBe(62)
    expect(result.current.phase).toBe('Escalating')
    expect(result.current.phaseLabel).toBe('ESCALATING')
    expect(result.current.targetIntensity).toBeNull()
    expect(result.current.lastChangeDetail).toBeNull()
  })

  it('reacts to a store change from another source (e.g. a second mounted dial)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => {
      storylineMock.setTargetIntensity(45)
    })

    expect(result.current.targetIntensity).toBe(45)
  })
})

describe('useStorylineTarget — setTarget', () => {
  it('clamps, records the change on the mock storyline, and exposes the transition detail', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => {
      result.current.setTarget(150) // clamps to 100
    })

    expect(result.current.targetIntensity).toBe(100)
    expect(storylineMock.getStoryline().targetIntensity).toBe(100)
    expect(result.current.lastChangeDetail).toBe('none → 100')
  })

  it('the second setTarget reports the previous target as "from" ("78 → 60"-style)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(78))
    act(() => result.current.setTarget(60))

    expect(result.current.lastChangeDetail).toBe('78 → 60')
    expect(result.current.targetIntensity).toBe(60)
  })

  it('does not move actual intensity — only exposes the target for the (stubbed) engine-follow loop', () => {
    const { result } = renderHook(() => useStorylineTarget())
    const before = result.current.intensity

    act(() => result.current.setTarget(5))

    expect(result.current.intensity).toBe(before)
    // exposed for the deferred Phase 2 TickTowardTarget loop to consume
    expect(result.current.targetIntensity).toBe(5)
  })

  it('emits exactly ONE steering_action event per call', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(60))

    expect(steeringEvents()).toHaveLength(1)
  })

  it('the emitted event carries the correct actor, target, channel, and payload (XC-004)', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(60))

    const evt = steeringEvents()[0]
    expect(evt).toBeDefined()
    expect(evt?.exerciseId).toBe(EX)
    expect(evt?.channel).toBe('system')
    expect(evt?.actor).toEqual({ kind: 'system', actingHumanId: HUMAN, role: 'controller' })
    expect(evt?.target).toEqual({ entityType: 'storyline', entityId: 'storyline-water-advisory' })
    expect(evt?.payload).toMatchObject({
      action: 'target-changed',
      from: null,
      to: 60,
      detail: 'none → 60',
    })
    expect(evt?.scenarioTime).toBe(SCENARIO_TIME)
    expect(evt?.timeZone).toBe('America/New_York')
  })

  it('a setTarget that resolves to the SAME value as the current target is a no-op: no record, no emit', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(100)) // none -> 100
    expect(steeringEvents()).toHaveLength(1)

    act(() => result.current.setTarget(100)) // already 100 -> no-op

    expect(steeringEvents()).toHaveLength(1) // still just the one from the real change
    expect(result.current.targetIntensity).toBe(100)
    expect(result.current.lastChangeDetail).toBe('none → 100') // unchanged by the no-op
  })

  it('a value that clamps down to the current target (e.g. 150 then a further 150) is also a no-op', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(150)) // clamps to 100
    expect(steeringEvents()).toHaveLength(1)

    act(() => result.current.setTarget(999)) // clamps to 100 again -> no-op

    expect(steeringEvents()).toHaveLength(1)
  })

  it('targets the single mock storyline (MOCK_STORYLINE_ID) — telemetry entityId matches what is mutated', () => {
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(20))

    const evt = steeringEvents()[0]
    // Wave-1 is single-storyline: the returned id and the telemetry entityId
    // are both MOCK_STORYLINE_ID — never an arbitrary caller-supplied id that
    // would disagree with the (single, un-keyed) store actually mutated.
    expect(evt?.target).toEqual({ entityType: 'storyline', entityId: MOCK_STORYLINE_ID })
    expect(result.current.storylineId).toBe(MOCK_STORYLINE_ID)
  })
})

describe('useStorylineTarget — clearTarget', () => {
  it('unsets the target and emits one steering_action event with a "{from} → none" payload', () => {
    const { result } = renderHook(() => useStorylineTarget())
    act(() => result.current.setTarget(60))
    resetTelemetryBuffer()

    act(() => result.current.clearTarget())

    expect(result.current.targetIntensity).toBeNull()
    expect(result.current.lastChangeDetail).toBe('60 → none')
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toMatchObject({ action: 'target-changed', from: 60, to: null })
  })
})

describe('useStorylineTarget — exercise scoping (COR-001)', () => {
  it('stamps the currently-bound exercise id on the telemetry event, not a hard-coded one', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-alpha'))
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(33))

    expect(steeringEvents()[0]?.exerciseId).toBe('ex-alpha')
  })
})

/**
 * Mirrors `wireBody`/`liveState` fixtures used across the story 09 live-branch
 * test files — a valid `LiveStorylineSteeringState`, overridable per test.
 */
function liveState(overrides: Partial<liveStorylineActions.LiveStorylineSteeringState> = {}) {
  return {
    storylineId: 'storyline-real-guid',
    title: 'Water main contamination fears',
    exerciseId: EX,
    intensity: 40,
    targetIntensity: null,
    phase: 'Escalating' as const,
    ...overrides,
  }
}

describe('useStorylineTarget — live mode (story 09; USE_MOCK_DATA=false)', () => {
  beforeEach(() => {
    useMockData = false
  })

  it('AC1: fetches the real storyline via GET on mount and exposes its actual/target/phase/title', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ intensity: 55, targetIntensity: 70, phase: 'Peak' }))

    const { result } = renderHook(() => useStorylineTarget())
    await waitFor(() => expect(result.current.intensity).toBe(55))

    expect(mockedGetStoryline).toHaveBeenCalledWith('primary')
    expect(result.current.targetIntensity).toBe(70)
    expect(result.current.phase).toBe('Peak')
    expect(result.current.phaseLabel).toBe('PEAK')
    expect(result.current.storylineId).toBe('storyline-real-guid')
    expect(result.current.title).toBe('Water main contamination fears') // Gate-1 W-008
  })

  it('uses the PRIMARY_STORYLINE_SENTINEL id (container-agnostic, mirrors MOCK_STORYLINE_ID) until the GET resolves', () => {
    mockedGetStoryline.mockReturnValue(new Promise(() => {})) // never resolves within this test
    const { result } = renderHook(() => useStorylineTarget())

    expect(result.current.storylineId).toBe('primary')
  })

  describe('dataStatus (Gate-1 CR-002 — never fabricate a calm world)', () => {
    it('is "loading" before the GET resolves, then "live" once it does', async () => {
      let resolveGet: (value: liveStorylineActions.LiveStorylineSteeringState) => void = () => {}
      mockedGetStoryline.mockReturnValue(
        new Promise(resolve => {
          resolveGet = resolve
        }),
      )
      const { result } = renderHook(() => useStorylineTarget())

      expect(result.current.dataStatus).toBe('loading')

      act(() => {
        resolveGet(liveState())
      })
      await waitFor(() => expect(result.current.dataStatus).toBe('live'))
    })

    it('is "unavailable" (never "live") when the GET fails — the placeholder numbers must not be presented as fact', async () => {
      mockedGetStoryline.mockRejectedValue(new Error('404 — e.g. registry lost after an App Service restart'))

      const { result } = renderHook(() => useStorylineTarget())

      await waitFor(() => expect(result.current.dataStatus).toBe('unavailable'))
      // The placeholder is exposed for type-safety only — <EscalationDial>
      // must gate its numeric display on dataStatus, not trust this as fact.
      expect(result.current.intensity).toBe(0)
      expect(result.current.phase).toBe('Dormant')
    })

    it('mock mode always reports "live" (synchronously seeded, never loading/unavailable)', () => {
      useMockData = true
      const { result } = renderHook(() => useStorylineTarget())

      expect(result.current.dataStatus).toBe('live')
    })
  })

  it('AC2: setTarget POSTs to the resolved storyline id, updates optimistically, then reconciles against the authoritative response', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ intensity: 40, targetIntensity: null }))
    mockedSetStorylineTarget.mockResolvedValue(liveState({ intensity: 42, targetIntensity: 75 }))

    const { result } = renderHook(() => useStorylineTarget())
    await waitFor(() => expect(result.current.storylineId).toBe('storyline-real-guid'))

    act(() => result.current.setTarget(75))

    // Optimistic — reflects immediately, before the POST settles.
    expect(result.current.targetIntensity).toBe(75)
    expect(mockedSetStorylineTarget).toHaveBeenCalledWith('storyline-real-guid', 75)

    // Reconciled against the AUTHORITATIVE response — intensity moves to the
    // server's 42 (never assumed locally), even though only target was set —
    // and the change is now CONFIRMED (promoted to lastChangeDetail).
    await waitFor(() => expect(result.current.intensity).toBe(42))
    expect(result.current.targetIntensity).toBe(75)
    expect(result.current.lastChangeDetail).toBe('none → 75')
    expect(result.current.pendingChangeDetail).toBeNull()
    expect(result.current.writeError).toBeNull()
  })

  it('Gate-1 CR-001: holds the change as PENDING (never claimed) while the POST is in flight', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ intensity: 40, targetIntensity: null }))
    let resolvePost: (value: liveStorylineActions.LiveStorylineSteeringState) => void = () => {}
    mockedSetStorylineTarget.mockReturnValue(
      new Promise(resolve => {
        resolvePost = resolve
      }),
    )
    const { result } = renderHook(() => useStorylineTarget())
    await waitFor(() => expect(result.current.storylineId).toBe('storyline-real-guid'))

    act(() => result.current.setTarget(75))

    // In flight: PENDING, not yet CONFIRMED — the aria-live status line the
    // dial renders must not announce this as settled fact.
    expect(result.current.pendingChangeDetail).toBe('none → 75')
    expect(result.current.lastChangeDetail).toBeNull()

    act(() => {
      resolvePost(liveState({ intensity: 41, targetIntensity: 75 }))
    })
    await waitFor(() => expect(result.current.lastChangeDetail).toBe('none → 75'))
    expect(result.current.pendingChangeDetail).toBeNull()
  })

  it('emits exactly ONE steering_action event, unchanged in shape from the mock branch (XC-004, no double-emit)', async () => {
    mockedGetStoryline.mockResolvedValue(liveState())
    mockedSetStorylineTarget.mockResolvedValue(liveState({ targetIntensity: 60 }))
    const { result } = renderHook(() => useStorylineTarget())
    await waitFor(() => expect(result.current.storylineId).toBe('storyline-real-guid'))

    act(() => result.current.setTarget(60))

    expect(steeringEvents()).toHaveLength(1)
    const evt = steeringEvents()[0]
    expect(evt?.exerciseId).toBe(EX)
    expect(evt?.channel).toBe('system')
    expect(evt?.actor).toEqual({ kind: 'system', actingHumanId: HUMAN, role: 'controller' })
    expect(evt?.target).toEqual({ entityType: 'storyline', entityId: 'storyline-real-guid' })
    expect(evt?.payload).toMatchObject({
      action: 'target-changed',
      from: null,
      to: 60,
      detail: 'none → 60',
    })
  })

  describe('a rejected POST (Gate-1 CR-001 + S-003)', () => {
    it('never claims the change: clears the pending detail, sets a write error, and re-syncs from the server instead of a blind local revert', async () => {
      mockedGetStoryline.mockResolvedValueOnce(liveState({ intensity: 40, targetIntensity: null }))
      mockedSetStorylineTarget.mockRejectedValue(new Error('network down'))
      const { result } = renderHook(() => useStorylineTarget())
      await waitFor(() => expect(result.current.storylineId).toBe('storyline-real-guid'))

      // The post-failure re-sync GET returns the server's untouched truth —
      // never mutated by the failed POST.
      mockedGetStoryline.mockResolvedValueOnce(liveState({ intensity: 40, targetIntensity: null }))

      act(() => result.current.setTarget(90))

      // Immediately: optimistic NUMBER update + a PENDING (not yet confirmed) detail.
      expect(result.current.targetIntensity).toBe(90)
      expect(result.current.pendingChangeDetail).toBe('none → 90')

      await waitFor(() => expect(result.current.writeError).not.toBeNull())

      expect(result.current.writeError).toBe(
        'Could not set the target — the change was not applied. Try again.',
      )
      expect(result.current.pendingChangeDetail).toBeNull()
      // NEVER promoted — the change never actually landed.
      expect(result.current.lastChangeDetail).toBeNull()

      // The re-sync (not a captured pre-POST snapshot, Gate-1 S-003) corrects
      // the optimistic number back to the server's ground truth.
      await waitFor(() => expect(result.current.targetIntensity).toBeNull())
      expect(mockedGetStoryline).toHaveBeenCalledWith('storyline-real-guid')

      // The attempt is still recorded in the audit trail either way (XC-004).
      expect(steeringEvents()).toHaveLength(1)
      expect(steeringEvents()[0]?.payload).toMatchObject({ from: null, to: 90 })
    })

    it('still surfaces a write error (never a silent no-op) even when NOTHING had loaded yet — the "nothing loaded" gap CR-001 flagged', async () => {
      mockedGetStoryline.mockReturnValue(new Promise(() => {})) // the initial GET never resolves
      mockedSetStorylineTarget.mockRejectedValue(new Error('empty registry'))
      const { result } = renderHook(() => useStorylineTarget())

      expect(result.current.dataStatus).toBe('loading')

      act(() => result.current.setTarget(90))

      await waitFor(() => expect(result.current.writeError).not.toBeNull())
      expect(result.current.lastChangeDetail).toBeNull()
    })

    it('a fresh attempt clears a previous write error', async () => {
      mockedGetStoryline.mockResolvedValue(liveState({ intensity: 40, targetIntensity: null }))
      mockedSetStorylineTarget.mockRejectedValueOnce(new Error('network down'))
      const { result } = renderHook(() => useStorylineTarget())
      await waitFor(() => expect(result.current.storylineId).toBe('storyline-real-guid'))

      act(() => result.current.setTarget(90))
      await waitFor(() => expect(result.current.writeError).not.toBeNull())

      mockedSetStorylineTarget.mockResolvedValueOnce(
        liveState({ intensity: 40, targetIntensity: 60 }),
      )
      act(() => result.current.setTarget(60))

      expect(result.current.writeError).toBeNull()
    })
  })

  it('a setTarget that resolves to the SAME value as the current target is a no-op: no POST, no telemetry', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ targetIntensity: 60 }))
    const { result } = renderHook(() => useStorylineTarget())
    await waitFor(() => expect(result.current.targetIntensity).toBe(60))

    act(() => result.current.setTarget(60))

    expect(mockedSetStorylineTarget).not.toHaveBeenCalled()
    expect(steeringEvents()).toHaveLength(0)
  })

  it('mock mode (the default) never calls the live GET/POST', () => {
    useMockData = true
    const { result } = renderHook(() => useStorylineTarget())

    act(() => result.current.setTarget(60))

    expect(mockedGetStoryline).not.toHaveBeenCalled()
    expect(mockedSetStorylineTarget).not.toHaveBeenCalled()
  })

  it('Gate-1 W-006: acquires the poll reference on mount and releases it on unmount', () => {
    mockedGetStoryline.mockResolvedValue(liveState())
    const acquireSpy = vi.spyOn(liveStorylineStore, 'ensureStarted')
    const releaseSpy = vi.spyOn(liveStorylineStore, 'release')

    const { unmount } = renderHook(() => useStorylineTarget())
    expect(acquireSpy).toHaveBeenCalledTimes(1)
    expect(releaseSpy).not.toHaveBeenCalled()

    unmount()
    expect(releaseSpy).toHaveBeenCalledTimes(1)

    acquireSpy.mockRestore()
    releaseSpy.mockRestore()
  })
})
