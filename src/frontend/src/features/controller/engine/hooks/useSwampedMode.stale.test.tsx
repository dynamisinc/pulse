/**
 * features/controller/engine/hooks/useSwampedMode.stale.test.tsx
 * ---------------------------------------------------------------------------
 * W3: a console whose settings refresh keeps failing (or hangs) is FLAGGED stale rather than
 * silently showing its last state; the flag clears on the next applied GET. Also S3: after a
 * confirmed POST whose re-read fails, the confirmed value (the 200 body) is shown.
 * Fake timers, live mode.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext } from '@/core/exerciseContext'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import * as actions from '../services/engineSettingsActions'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { MOCK_ENGINE_SETTINGS, engineSettingsStore, useEngineSettings } from './useEngineSettings'
import { SETTINGS_POLL_MS, useSwampedSettingsPoll } from './useSwampedSettingsPoll'
import { useSwampedMode } from './useSwampedMode'

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
  setAutonomyDefault: vi.fn(),
}))

const getSettings = vi.mocked(actions.getSettings)
const postSwamped = vi.mocked(actions.setSwampedMode)

function dto(swampedMode: boolean): EngineSettingsDto {
  return { ...MOCK_ENGINE_SETTINGS, autonomy: { ...MOCK_ENGINE_SETTINGS.autonomy, swampedMode } }
}

function useConsole() {
  const engine = useEngineSettings()
  useSwampedSettingsPoll(engine.refreshInBackground)
  return useSwampedMode()
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  resetStubSession()
  setStubSession({ role: 'controller', isLead: true })
  engineSettingsStore.resetForTests()
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-stale',
    exerciseName: 'S',
    timeZone: 'America/New_York',
    status: 'active',
  })
  vi.mocked(useControllerIdentity).mockReturnValue({
    actingHumanId: 'h1',
    callSign: 'S1',
    role: 'controller',
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('stale console flag (W3)', () => {
  it('is not stale after healthy refreshes, and records when it last confirmed', async () => {
    getSettings.mockResolvedValue(dto(false))
    const { result } = renderHook(() => useConsole())
    await tick(0)
    expect(result.current.stale).toBe(false)
    expect(result.current.lastConfirmedAt).not.toBeNull()
  })

  it('one failed background refresh is tolerated; two consecutive flag it; the next applied GET clears it', async () => {
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useConsole())
    await tick(0)
    const confirmedAt = result.current.lastConfirmedAt

    getSettings.mockRejectedValue(new Error('net'))
    await tick(SETTINGS_POLL_MS)
    expect(result.current.stale).toBe(false)
    await tick(SETTINGS_POLL_MS)
    expect(result.current.stale).toBe(true)
    expect(result.current.lastConfirmedAt).toBe(confirmedAt) // still the last CONFIRMED time
    expect(result.current.swampedMode).toBe(false) // last state kept, never guessed

    getSettings.mockResolvedValue(dto(true))
    await tick(SETTINGS_POLL_MS)
    expect(result.current.stale).toBe(false)
    expect(result.current.swampedMode).toBe(true)
  })

  it('flags a hung refresh once more than 60 s pass with nothing applied', async () => {
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useConsole())
    await tick(0)
    getSettings.mockReturnValue(new Promise(() => {})) // every later refresh hangs

    await tick(SETTINGS_POLL_MS * 2)
    expect(result.current.stale).toBe(false) // exactly ~60 s: not yet over
    await tick(SETTINGS_POLL_MS)
    expect(result.current.stale).toBe(true)
  })
})

describe('tab-return grace (W3 polish)', () => {
  function setVisibility(state: 'visible' | 'hidden'): void {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  }

  it('does not flag the time-based branch on tab return until the GET settles or 5 s pass', async () => {
    setVisibility('visible')
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useConsole())
    await tick(0)
    getSettings.mockReturnValue(new Promise(() => {})) // refreshes hang
    await tick(SETTINGS_POLL_MS * 3)
    expect(result.current.stale).toBe(true)

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    setVisibility('visible')
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(result.current.stale).toBe(false) // grace

    await tick(4_000)
    expect(result.current.stale).toBe(false)
    await tick(1_100)
    expect(result.current.stale).toBe(true) // capped at 5 s
  })

  it('stays fresh when the in-flight GET lands after the tab returns', async () => {
    setVisibility('visible')
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useConsole())
    await tick(0)
    let land: (v: EngineSettingsDto) => void = () => {}
    getSettings.mockReturnValueOnce(new Promise<EngineSettingsDto>(r => { land = r }))
    await tick(SETTINGS_POLL_MS * 3)
    expect(result.current.stale).toBe(true)

    getSettings.mockResolvedValue(dto(false))
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await act(async () => land(dto(false)))
    await tick(6_000)
    expect(result.current.stale).toBe(false)
  })
})

describe('mutation stamps (W3 polish)', () => {
  it('a successful settings mutation stamps lastAppliedAt and resets failures', async () => {
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useEngineSettings())
    await tick(0)
    const before = result.current.lastAppliedAt
    getSettings.mockRejectedValue(new Error('x'))
    act(() => result.current.refetch())
    await tick(0)
    expect(result.current.refreshFailures).toBe(1)

    vi.mocked(actions.setAutonomyDefault).mockResolvedValue(dto(false))
    await tick(1_000)
    act(() => result.current.setAutonomyDefault('delayed-auto'))
    await tick(0)
    expect(result.current.refreshFailures).toBe(0)
    expect(result.current.lastAppliedAt).toBeGreaterThan(before ?? 0)
  })
})

describe('confirmed change whose re-read fails (S3)', () => {
  it('shows the POST body value, keeps the could-not-re-read error until a GET lands', async () => {
    getSettings.mockResolvedValueOnce(dto(false))
    const { result } = renderHook(() => useSwampedMode())
    await tick(0)

    postSwamped.mockResolvedValue(true)
    getSettings.mockRejectedValueOnce(new Error('blip'))
    getSettings.mockReturnValue(new Promise(() => {})) // the queued background retry hangs
    act(() => result.current.setSwampedMode(true))
    await tick(0)

    expect(result.current.swampedMode).toBe(true) // not the old OFF
    expect(result.current.error).toMatch(/could not re-read/i)
  })
})
