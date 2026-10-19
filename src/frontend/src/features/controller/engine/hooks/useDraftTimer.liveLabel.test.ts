/**
 * features/controller/engine/hooks/useDraftTimer.liveLabel.test.ts
 * ---------------------------------------------------------------------------
 * W2: the hook's OWN live (display-only) label follows the same expiry rule as `decide()`,
 * fed the caller's inputs (`effectiveTimeoutAutoSend(serverSwamped, settings)`, cut-to-Fake,
 * effective level). NOTE: the visible review card is `ReviewQueue`, which gets its "sends in"
 * / "holds in" from `useCardAutoSend` (server-derived in live mode; see its test), not from
 * this label. A card says "sends in" only when the server will publish,
 * otherwise "holds in"; live mode never publishes or emits client-side.
 */
import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import {
  AutonomyLevel,
  DelayedAutoCountdown,
  STOPPED_AUTONOMY,
  runningAutonomy,
  type EffectiveAutonomy,
} from '../models/reviewContracts'
import { effectiveTimeoutAutoSend } from '../models/effectiveTimeoutAutoSend'
import { useDraftTimer } from './useDraftTimer'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(() => ({
    exerciseId: 'ex-mock-0001',
    exerciseName: 'T',
    timeZone: 'America/New_York',
    status: 'active',
  })),
}))
vi.mock('../../identity/controllerIdentity', () => ({
  useControllerIdentity: vi.fn(() => ({
    actingHumanId: 'h1',
    callSign: 'S1',
    role: 'controller',
  })),
}))

const countdown = new DelayedAutoCountdown({
  exerciseId: 'ex-mock-0001',
  storylineId: 's',
  draftId: 'd',
  startedScenarioMinute: 100,
  countdownMinutes: 5,
})
// Minute 103:30 -> 90 s left.
const now = () => new Date(103 * 60_000 + 30_000)

beforeEach(() => resetTelemetryBuffer())

function liveLabel(
  serverSwamped: boolean,
  flag: boolean | undefined,
  cut: boolean,
  effective: EffectiveAutonomy,
): string {
  const swamped = effectiveTimeoutAutoSend(serverSwamped, { timeoutAutoSendAuthorized: flag })
  const { result } = renderHook(() =>
    useDraftTimer(countdown, effective, swamped, { now, displayOnly: true }, cut),
  )
  return result.current.label
}

const delayedAuto = runningAutonomy(AutonomyLevel.DelayedAuto)
const suggest = runningAutonomy(AutonomyLevel.Suggest)

describe('live countdown label (display-only)', () => {
  it('Publish: swamped on + authorized + not cut + Delayed-auto -> "sends in"', () => {
    expect(liveLabel(true, true, false, delayedAuto)).toBe('sends in 1:30')
  })

  it.each([
    ['swamped off', false, true, false, delayedAuto],
    ['flag undefined', true, undefined, false, delayedAuto],
    ['flag false', true, false, false, delayedAuto],
    ['cut to Fake', true, true, true, delayedAuto],
    ['clamped to Suggest', true, true, false, suggest],
    ['kill switch stop', true, true, false, STOPPED_AUTONOMY],
  ] as const)('Hold: %s -> "holds in"', (_name, swamped, flag, cut, effective) => {
    expect(liveLabel(swamped, flag, cut, effective)).toBe('holds in 1:30')
  })

  it('never publishes or emits client-side in live mode', () => {
    liveLabel(true, true, false, delayedAuto)
    expect(getEmittedTelemetryEvents()).toHaveLength(0)
  })
})
