/**
 * features/controller/engine/hooks/useCardAutoSend.test.ts
 * ---------------------------------------------------------------------------
 * D-W1: in LIVE mode the card's "sends in" / "holds in" follows the SERVER-derived rule
 * (`timeoutAutoSendState(...) === 'active'`) and ignores the browser-local kill-switch store,
 * so console A stopping while console B restores cannot make A's cards lie. In MOCK mode the
 * client decides, so the local effective autonomy applies.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext } from '@/core/exerciseContext'
import {
  AutonomyLevel,
  STOPPED_AUTONOMY,
  runningAutonomy,
  type EffectiveAutonomy,
} from '../models/reviewContracts'
import { MOCK_ENGINE_SETTINGS, engineSettingsStore } from './useEngineSettings'
import type { EngineSettingsDto } from '../services/engineSettingsActions'
import { useCardAutoSend } from './useCardAutoSend'

const flags = vi.hoisted(() => ({
  mock: false,
  effective: null as unknown as EffectiveAutonomy,
}))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return flags.mock
  },
}))
vi.mock('@/core/exerciseContext', () => ({ useExerciseContext: vi.fn() }))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: () => ({ actingHumanId: 'h', callSign: 'S', role: 'controller' }),
}))
vi.mock('./useEngineControl', () => ({
  useEngineControl: () => ({ effective: flags.effective }),
}))

const EX = 'ex-card'

function settings(over: {
  swamped?: boolean
  authorized?: boolean
  level?: 'suggest' | 'delayed-auto' | null
  stopped?: boolean
  cut?: boolean
}): EngineSettingsDto {
  return {
    ...MOCK_ENGINE_SETTINGS,
    providerCutToFake: over.cut ?? false,
    timeoutAutoSendAuthorized: over.authorized ?? true,
    autonomy: {
      ...MOCK_ENGINE_SETTINGS.autonomy,
      swampedMode: over.swamped ?? true,
      generationStopped: over.stopped ?? false,
      exerciseDefaultLevel: 'delayed-auto',
      effectiveLevel: over.stopped ? null : (over.level ?? 'delayed-auto'),
    },
  }
}

function read(dto: EngineSettingsDto): boolean {
  engineSettingsStore.setForTests(EX, dto)
  return renderHook(() => useCardAutoSend()).result.current
}

beforeEach(() => {
  engineSettingsStore.resetForTests()
  flags.mock = false
  flags.effective = runningAutonomy(AutonomyLevel.DelayedAuto)
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: EX,
    exerciseName: 'C',
    timeZone: 'America/New_York',
    status: 'active',
  })
})

describe('useCardAutoSend — live (server-derived)', () => {
  it('sends when the server state is active', () => {
    expect(read(settings({}))).toBe(true)
  })

  it.each([
    ['swamped off', { swamped: false }],
    ['flag false', { authorized: false }],
    ['cut to Fake', { cut: true }],
    ['server stopped', { stopped: true }],
    ['default lowered to Suggest', { level: 'suggest' as const }],
  ])('holds: %s', (_n, over) => {
    expect(read(settings(over))).toBe(false)
  })

  it('A stopped locally, but the server (B restored) is active -> "sends"', () => {
    flags.effective = STOPPED_AUTONOMY
    expect(read(settings({}))).toBe(true)
  })

  it('A thinks it is running, but the server is stopped -> "holds"', () => {
    flags.effective = runningAutonomy(AutonomyLevel.DelayedAuto)
    expect(read(settings({ stopped: true }))).toBe(false)
  })
})

describe('useCardAutoSend — mock (client decides)', () => {
  it('uses the local effective autonomy', () => {
    flags.mock = true
    expect(read(settings({}))).toBe(true)
    flags.effective = STOPPED_AUTONOMY
    expect(read(settings({}))).toBe(false)
  })
})
