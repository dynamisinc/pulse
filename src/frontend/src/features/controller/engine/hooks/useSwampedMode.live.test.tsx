/**
 * features/controller/engine/hooks/useSwampedMode.live.test.tsx
 * ---------------------------------------------------------------------------
 * LIVE-mode (USE_MOCK_DATA=false) coverage for the server-driven swamped-mode toggle
 * (PROVIDER-GOVERNANCE §8). Proves: the displayed state comes from the server's settings
 * re-read, never an optimistic flip; 400/403 refusals leave state untouched and surface an
 * inline message; a non-lead ON sends no request; OFF always posts; NO client telemetry on
 * the live path (#618 — the server records the change), not on success and not on a refusal;
 * the store is serialized; and two consoles sharing an exercise agree.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import * as actions from '../services/engineSettingsActions'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { swampedModeStore, useSwampedMode } from './useSwampedMode'
import { useEngineSettings } from './useEngineSettings'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('../services/engineSettingsActions', async () => ({
  ...(await vi.importActual<typeof import('../services/engineSettingsActions')>(
    '../services/engineSettingsActions',
  )),
  getSettings: vi.fn(),
  setSwampedMode: vi.fn(),
}))

const getSettings = vi.mocked(actions.getSettings)
const postSwamped = vi.mocked(actions.setSwampedMode)

const scope: ExerciseScope = {
  exerciseId: 'ex-live-1',
  exerciseName: 'Live',
  timeZone: 'America/New_York',
  status: 'active',
}

function dto(swampedMode: boolean, authorized = true): EngineSettingsDto {
  return {
    provider: 'Fake',
    effectiveProvider: 'Fake',
    providerCutToFake: false,
    alreadyFake: true,
    tiers: [],
    autonomy: {
      swampedMode,
      generationStopped: false,
      safetyClampActive: false,
      degradedReason: null,
      exerciseDefaultLevel: 'suggest',
      effectiveLevel: 'suggest',
    },
    tierPolicyMode: 'auto',
    inMemoryState: true,
    inMemoryStateNote: 'n',
    timeoutAutoSendAuthorized: authorized,
  }
}

function httpError(status: number, data: unknown): Error {
  return Object.assign(new Error(`HTTP ${status}`), {
    isAxiosError: true,
    response: { status, data },
  })
}

function events() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'engine.swamped_mode_changed')
}

/** Mounts the hook and waits for the initial settings GET to land. */
async function mount(initial: boolean, authorized = true) {
  getSettings.mockResolvedValue(dto(initial, authorized))
  const hook = renderHook(() => useSwampedMode())
  await waitFor(() => expect(hook.result.current.pending).toBe(false))
  await waitFor(() => expect(getSettings).toHaveBeenCalled())
  await waitFor(() => expect(swampedModeStore.getSnapshot(scope.exerciseId)).toBe(initial))
  await waitFor(() => expect(hook.result.current.pending).toBe(false))
  return hook
}

beforeEach(() => {
  resetStubSession()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  swampedModeStore.resetForTests()
  resetTelemetryBuffer()
  vi.mocked(useExerciseContext).mockReturnValue(scope)
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'human-1',
    callSign: 'S1',
    role: 'controller',
  })
})

afterEach(() => {
  resetExerciseClock()
  vi.clearAllMocks()
})

describe('useSwampedMode (live) — lead ON', () => {
  it('posts {enabled:true}; the display flips only when the settings re-read says so', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)

    let release: (v: boolean | null) => void = () => {}
    postSwamped.mockReturnValue(new Promise<boolean | null>(r => { release = r }))
    getSettings.mockResolvedValue(dto(true))
    act(() => result.current.setSwampedMode(true))

    expect(postSwamped).toHaveBeenCalledWith(true, { actingHumanId: 'person-stub' })
    expect(result.current.pending).toBe(true)
    expect(result.current.swampedMode).toBe(false) // NOT optimistic
    expect(events()).toHaveLength(0)

    await act(async () => release(true))
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
    expect(result.current.pending).toBe(false)
    // #618: the server records engine.swamped-mode.turned-on — no client emit.
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('a 400 (governance flag false) leaves it OFF, shows the message, emits nothing', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false, false)
    postSwamped.mockRejectedValue(httpError(400, 'raw server text that must not be shown'))

    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(result.current.error).toBe(
      'Timeout auto-send is not authorized on this environment.',
    ))
    expect(result.current.swampedMode).toBe(false)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('a 403 leaves it OFF, shows a refusal, emits nothing', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    postSwamped.mockRejectedValue(httpError(403, ''))

    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(result.current.error).toBe('Only the lead controller can turn swamped mode on.'))
    expect(result.current.swampedMode).toBe(false)
    expect(events()).toHaveLength(0)
  })

  it('a refusal queues a settings re-read so the display converges on server truth', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    getSettings.mockClear()
    getSettings.mockResolvedValue(dto(true)) // someone else turned it on meanwhile
    postSwamped.mockRejectedValue(httpError(403, ''))

    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
    expect(getSettings).toHaveBeenCalledTimes(1)
  })
})

describe('useSwampedMode (live) — non-lead', () => {
  it('ON sends no request', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = await mount(false)
    act(() => result.current.setSwampedMode(true))
    expect(postSwamped).not.toHaveBeenCalled()
    expect(events()).toHaveLength(0)
  })

  it('OFF posts {enabled:false} and emits no client telemetry (the server records it)', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = await mount(true)
    postSwamped.mockResolvedValue(false)
    getSettings.mockResolvedValue(dto(false))

    act(() => result.current.setSwampedMode(false))
    expect(postSwamped).toHaveBeenCalledWith(false, { actingHumanId: 'person-stub' })
    await waitFor(() => expect(result.current.swampedMode).toBe(false))
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })

  it('a failed OFF stays ON (never assumes OFF locally) and shows the error', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = await mount(true)
    postSwamped.mockRejectedValue(new Error('network'))

    act(() => result.current.setSwampedMode(false))
    await waitFor(() => expect(result.current.error).toMatch(/could not be changed/i))
    expect(result.current.swampedMode).toBe(true)
    expect(events()).toHaveLength(0)
  })
})

describe('useSwampedMode (live) — serialization and agreement', () => {
  it('a toggle while a settings GET is in flight is QUEUED, not dropped, and runs on settle', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    let landGet: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { landGet = r }))
    const settings = renderHook(() => useEngineSettings())
    act(() => settings.result.current.refetch())
    await waitFor(() => expect(result.current.pending).toBe(true))

    postSwamped.mockResolvedValue(true)
    getSettings.mockResolvedValue(dto(true))
    act(() => result.current.setSwampedMode(true))
    expect(postSwamped).not.toHaveBeenCalled() // serialized: one request in flight
    expect(result.current.pending).toBe(true)

    await act(async () => landGet(dto(false)))
    await waitFor(() => expect(postSwamped).toHaveBeenCalledWith(true, { actingHumanId: 'person-stub' }))
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
  })

  it('two hook instances in one window share the store (agreement by construction)', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const a = await mount(false)
    const b = renderHook(() => useSwampedMode())
    postSwamped.mockResolvedValue(true)
    getSettings.mockResolvedValue(dto(true))

    act(() => a.result.current.setSwampedMode(true))
    await waitFor(() => expect(a.result.current.swampedMode).toBe(true))
    expect(b.result.current.swampedMode).toBe(true)
  })

  it('a change made by ANOTHER console reaches this one on the next settings refresh', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = await mount(false)
    const settings = renderHook(() => useEngineSettings())
    getSettings.mockResolvedValue(dto(true)) // the lead on another console turned it on

    act(() => settings.result.current.refetch())
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
  })
})

describe('useSwampedMode (live) — background refresh (CR-001)', () => {
  it('a background refresh never sets loading or pending, and still applies the result', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    const settings = renderHook(() => useEngineSettings())
    let land: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { land = r }))

    act(() => settings.result.current.refreshInBackground())
    expect(settings.result.current.loading).toBe(false)
    expect(result.current.pending).toBe(false)

    await act(async () => land(dto(true)))
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
    expect(settings.result.current.loading).toBe(false)
  })

  it('an OFF confirmed during a background GET still POSTs (queued, runs on settle)', async () => {
    setStubSession({ role: 'controller', isLead: false })
    const { result } = await mount(true)
    const settings = renderHook(() => useEngineSettings())
    let land: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { land = r }))
    act(() => settings.result.current.refreshInBackground())

    postSwamped.mockResolvedValue(false)
    getSettings.mockResolvedValue(dto(false))
    act(() => result.current.setSwampedMode(false))
    expect(postSwamped).not.toHaveBeenCalled()

    await act(async () => land(dto(true)))
    await waitFor(() => expect(postSwamped).toHaveBeenCalledWith(false, { actingHumanId: 'person-stub' }))
    await waitFor(() => expect(result.current.swampedMode).toBe(false))
  })
})

describe('useSwampedMode (live) — never a client emit (#618)', () => {
  it('does not emit when the body disagrees with the request or is unreadable', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    getSettings.mockResolvedValue(dto(false))

    postSwamped.mockResolvedValueOnce(false) // asked ON, server says OFF
    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(postSwamped).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(events()).toHaveLength(0)

    postSwamped.mockResolvedValueOnce(null) // unreadable body
    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(postSwamped).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(result.current.pending).toBe(false))
    expect(events()).toHaveLength(0)
  })
})

describe('useSwampedMode (live) — stale messages clear (WR-004)', () => {
  it('a failed re-read is cleared by the queued background retry', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false)
    postSwamped.mockResolvedValue(true)
    getSettings.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(dto(true))

    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
    expect(result.current.error).toBeNull()
  })

  it('a refusal clears once the server swamped state changes', async () => {
    setStubSession({ role: 'controller', isLead: true })
    const { result } = await mount(false, false)
    const settings = renderHook(() => useEngineSettings())
    postSwamped.mockRejectedValue(httpError(400, 'x'))
    getSettings.mockResolvedValue(dto(false, false))

    act(() => result.current.setSwampedMode(true))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    await waitFor(() => expect(result.current.pending).toBe(false))
    // The queued re-read saw no change, so the refusal stays.
    expect(result.current.error).not.toBeNull()

    getSettings.mockResolvedValue(dto(true, true))
    act(() => settings.result.current.refetch())
    await waitFor(() => expect(result.current.swampedMode).toBe(true))
    expect(result.current.error).toBeNull()
  })
})
