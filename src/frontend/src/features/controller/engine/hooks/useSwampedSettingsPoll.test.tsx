/**
 * features/controller/engine/hooks/useSwampedSettingsPoll.test.tsx
 * ---------------------------------------------------------------------------
 * The console's settings poll: fires every 30 s, skips hidden tabs, refreshes immediately on
 * tab-visible, clears on unmount (S-001, WR-002); and the REAL cross-console proof (WR-003): a
 * console seeded from GET(false) reads true after the server flips and the actual poll runs.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext } from '@/core/exerciseContext'
import { useControllerIdentity } from '../../identity/controllerIdentity'
import * as actions from '../services/engineSettingsActions'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { MOCK_ENGINE_SETTINGS, engineSettingsStore, useEngineSettings } from './useEngineSettings'
import { SETTINGS_POLL_MS, useSwampedSettingsPoll } from './useSwampedSettingsPoll'

vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({ useControllerIdentity: vi.fn() }))
vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('../services/engineSettingsActions', async () => ({
  ...(await vi.importActual<typeof import('../services/engineSettingsActions')>(
    '../services/engineSettingsActions',
  )),
  getSettings: vi.fn(),
}))

const getSettings = vi.mocked(actions.getSettings)

function dto(swampedMode: boolean): EngineSettingsDto {
  return {
    ...MOCK_ENGINE_SETTINGS,
    autonomy: { ...MOCK_ENGINE_SETTINGS.autonomy, swampedMode },
  }
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
}

beforeEach(() => {
  vi.useFakeTimers()
  setVisibility('visible')
  engineSettingsStore.resetForTests()
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-poll',
    exerciseName: 'Poll',
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

describe('useSwampedSettingsPoll', () => {
  it('fires every 30 s, skips hidden tabs, and stops after unmount', () => {
    const refresh = vi.fn()
    const { unmount } = renderHook(() => useSwampedSettingsPoll(refresh))

    vi.advanceTimersByTime(SETTINGS_POLL_MS - 1)
    expect(refresh).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(refresh).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(SETTINGS_POLL_MS)
    expect(refresh).toHaveBeenCalledTimes(2)

    setVisibility('hidden')
    vi.advanceTimersByTime(SETTINGS_POLL_MS * 3)
    expect(refresh).toHaveBeenCalledTimes(2)

    setVisibility('visible')
    unmount()
    vi.advanceTimersByTime(SETTINGS_POLL_MS * 3)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(2)
  })

  it('refreshes immediately when the tab becomes visible (S-001), not when hidden', () => {
    const refresh = vi.fn()
    renderHook(() => useSwampedSettingsPoll(refresh))

    setVisibility('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).not.toHaveBeenCalled()

    setVisibility('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(refresh).toHaveBeenCalledTimes(1)
  })

  it('cross-console proof: seeded from GET(false); the server flips; the real poll delivers true', async () => {
    getSettings.mockResolvedValue(dto(false))
    const { result } = renderHook(() => {
      const engine = useEngineSettings()
      useSwampedSettingsPoll(engine.refreshInBackground)
      return engine
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(result.current.settings?.autonomy.swampedMode).toBe(false)

    getSettings.mockResolvedValue(dto(true)) // another controller's console turned it on
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SETTINGS_POLL_MS)
    })
    expect(result.current.settings?.autonomy.swampedMode).toBe(true)
    expect(result.current.loading).toBe(false)
  })
})
