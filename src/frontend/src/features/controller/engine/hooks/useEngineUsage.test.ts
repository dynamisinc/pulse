/**
 * features/controller/engine/hooks/useEngineUsage.test.ts
 * ---------------------------------------------------------------------------
 * Covers the AI-generation usage read hook (feature: engine-telemetry-tuning,
 * story 03c):
 *  - MOCK mode renders a plausible, deterministic snapshot with NO network
 *    call, exercising a priced model, an unpriced model, an unattributed
 *    (empty provider/model) row, a `re-roll` in the guard mix, and a non-zero
 *    `unparseableEvents` — every state AC2/AC3/AC8 care about;
 *  - LIVE mode fetches `GET /api/engine/usage` once per exercise on mount,
 *    OMITS `windowMinutes` for the default window, and sends an explicit
 *    value for a non-default window;
 *  - `setWindowMinutes`/`refresh()` re-issue a read; a STALE response (issued
 *    before a newer one that already landed) never overwrites the newer
 *    truth — the one sequencing guard this hook keeps;
 *  - `loading` reflects an IN-FLIGHT COUNT, not a single flag;
 *  - a failed GET surfaces `error` and allows a later retry (the "started"
 *    flag clears on failure);
 *  - per-exercise scoping (COR-001): a different exercise never observes
 *    another exercise's usage.
 *
 * `@/core/exerciseContext` and `../services/liveEngineUsageActions` are
 * mocked at the module boundary (mirrors `useEngineSettings.test.ts`).
 * `@/core/config/mockData` is mocked via a GETTER so the same file can toggle
 * `USE_MOCK_DATA` between describe blocks.
 */
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import * as liveEngineUsageActions from '../services/liveEngineUsageActions'
import type { EngineUsageDto } from '../services/liveEngineUsageActions'
import { buildMockEngineUsage, engineUsageStore, useEngineUsage } from './useEngineUsage'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
}))

let useMockData = true
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return useMockData
  },
}))

vi.mock('../services/liveEngineUsageActions', async () => {
  const actual = await vi.importActual<typeof import('../services/liveEngineUsageActions')>(
    '../services/liveEngineUsageActions',
  )
  return {
    ...actual,
    getUsage: vi.fn(),
  }
})

const mockedUseExerciseContext = vi.mocked(useExerciseContext)
const mockedGetUsage = vi.mocked(liveEngineUsageActions.getUsage)

/** Narrows a possibly-null usage snapshot without a forbidden non-null assertion. */
function requireUsage(usage: EngineUsageDto | null): EngineUsageDto {
  if (usage === null) throw new Error('Expected a loaded usage snapshot, got null.')
  return usage
}

function scopeFor(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: 'Test Exercise', timeZone: 'America/New_York', status: 'active' }
}

function usageWith(overrides: Partial<EngineUsageDto> = {}): EngineUsageDto {
  return {
    window: {
      clock: 'wall-clock',
      fromWallClock: '2033-09-04T13:00:00.000Z',
      toWallClock: '2033-09-04T14:00:00.000Z',
      windowMinutes: 60,
      bucketMinutes: 1,
      bucketCount: 60,
    },
    totals: {
      calls: 1,
      inputTokens: 100,
      outputTokens: 20,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      latency: { totalMs: 500, averageMs: 500, maxMs: 500 },
    },
    buckets: [{ startWallClock: '2033-09-04T13:59:00.000Z', calls: 1 }],
    byModel: [
      {
        provider: 'AzureOpenAI',
        model: 'gpt-5.4',
        totals: {
          calls: 1,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadInputTokens: 0,
          cacheCreationInputTokens: 0,
          latency: { totalMs: 500, averageMs: 500, maxMs: 500 },
        },
        guardResults: [{ result: 'pass', calls: 1 }],
        buckets: [{ startWallClock: '2033-09-04T13:59:00.000Z', calls: 1 }],
      },
    ],
    guardResults: [{ result: 'pass', calls: 1 }],
    cost: {
      currency: 'USD',
      pricedTotalCost: 0,
      anyUnpriced: false,
      byModel: [
        {
          provider: 'AzureOpenAI',
          model: 'gpt-5.4',
          priced: true,
          inputCost: 0,
          outputCost: 0,
          cacheReadCost: 0,
          cacheCreationCost: 0,
          totalCost: 0,
          rates: {
            inputPer1MTokens: 5,
            outputPer1MTokens: 15,
            cacheReadPer1MTokens: 0.5,
            cacheCreationPer1MTokens: 6.25,
          },
        },
      ],
    },
    unparseableEvents: 0,
    ...overrides,
  }
}

beforeEach(() => {
  engineUsageStore.resetForTests()
  mockedUseExerciseContext.mockReturnValue(scopeFor('ex-mock-0001'))
  useMockData = true
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('useEngineUsage — mock mode (USE_MOCK_DATA=true, the default)', () => {
  it('renders a plausible snapshot with NO network call', () => {
    const { result } = renderHook(() => useEngineUsage())

    expect(result.current.loading).toBe(false)
    expect(result.current.usage).not.toBeNull()
    expect(result.current.windowMinutes).toBe(60)
    expect(mockedGetUsage).not.toHaveBeenCalled()
  })

  it('exercises a priced model, an unpriced model, an unattributed row, a re-roll, and a non-zero unparseableEvents', () => {
    const { result } = renderHook(() => useEngineUsage())
    const usage = requireUsage(result.current.usage)

    expect(usage.cost.byModel.some(m => m.priced)).toBe(true)
    expect(usage.cost.byModel.some(m => !m.priced)).toBe(true)
    expect(usage.byModel.some(m => m.provider === '' && m.model === '')).toBe(true)
    expect(usage.guardResults.some(g => g.result === 're-roll')).toBe(true)
    expect(usage.unparseableEvents).toBeGreaterThan(0)
  })

  it('sum(buckets.calls) === totals.calls (the same invariant the backend guarantees)', () => {
    const { result } = renderHook(() => useEngineUsage())
    const usage = requireUsage(result.current.usage)

    const bucketSum = usage.buckets.reduce((sum, b) => sum + b.calls, 0)
    expect(bucketSum).toBe(usage.totals.calls)
  })

  it('sum(guardResults.calls) === totals.calls', () => {
    const { result } = renderHook(() => useEngineUsage())
    const usage = requireUsage(result.current.usage)

    const guardSum = usage.guardResults.reduce((sum, g) => sum + g.calls, 0)
    expect(guardSum).toBe(usage.totals.calls)
  })

  it('setWindowMinutes recomputes the mock snapshot for the new window (no network call)', () => {
    const { result } = renderHook(() => useEngineUsage())

    act(() => result.current.setWindowMinutes(1440))

    expect(result.current.windowMinutes).toBe(1440)
    expect(result.current.usage?.window.windowMinutes).toBe(1440)
    expect(mockedGetUsage).not.toHaveBeenCalled()
  })

  it('refresh() is a NO-OP under mock — there is nothing to refresh (mirrors useEngineSettings.refetch())', () => {
    const { result } = renderHook(() => useEngineUsage())
    act(() => result.current.setWindowMinutes(15))
    const before = result.current.usage

    act(() => result.current.refresh())

    expect(result.current.usage).toBe(before)
    expect(mockedGetUsage).not.toHaveBeenCalled()
  })
})

describe('buildMockEngineUsage (pure)', () => {
  it('produces a dense bucket series whose length matches window.bucketCount', () => {
    const usage = buildMockEngineUsage(240, Date.parse('2033-09-04T14:00:00.000Z'))

    expect(usage.buckets).toHaveLength(usage.window.bucketCount)
    for (const model of usage.byModel) {
      expect(model.buckets).toHaveLength(usage.window.bucketCount)
    }
  })

  it('is deterministic for the same window/now', () => {
    const nowMs = Date.parse('2033-09-04T14:00:00.000Z')
    expect(buildMockEngineUsage(60, nowMs)).toEqual(buildMockEngineUsage(60, nowMs))
  })
})

describe('useEngineUsage — live mode (USE_MOCK_DATA=false)', () => {
  beforeEach(() => {
    useMockData = false
  })

  it('fetches GET /api/engine/usage ONCE per exercise on mount, OMITTING windowMinutes for the default window', async () => {
    mockedGetUsage.mockResolvedValue(usageWith())

    const { result } = renderHook(() => useEngineUsage())

    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.usage?.totals.calls).toBe(1)
    expect(mockedGetUsage).toHaveBeenCalledTimes(1)
    expect(mockedGetUsage).toHaveBeenCalledWith(undefined)
  })

  it('a second hook instance for the SAME exercise does not refire the mount fetch', async () => {
    mockedGetUsage.mockResolvedValue(usageWith())

    const { result: a } = renderHook(() => useEngineUsage())
    await waitFor(() => expect(a.current.loading).toBe(false))

    const { result: b } = renderHook(() => useEngineUsage())
    expect(b.current.usage).not.toBeNull()
    expect(mockedGetUsage).toHaveBeenCalledTimes(1)
  })

  it('setWindowMinutes sends the explicit window value for a non-default window', async () => {
    mockedGetUsage.mockResolvedValue(usageWith())
    const { result } = renderHook(() => useEngineUsage())
    await waitFor(() => expect(result.current.loading).toBe(false))

    act(() => result.current.setWindowMinutes(240))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(mockedGetUsage).toHaveBeenLastCalledWith(240)
  })

  it('a STALE response never overwrites a NEWER one that already landed', async () => {
    let resolveFirst: (value: EngineUsageDto) => void = () => {}
    const first = new Promise<EngineUsageDto>(resolve => {
      resolveFirst = resolve
    })
    mockedGetUsage.mockReturnValueOnce(first)

    const { result } = renderHook(() => useEngineUsage())
    expect(mockedGetUsage).toHaveBeenCalledTimes(1)

    // A second, NEWER request lands first (resolves immediately).
    const newer = usageWith({ totals: { ...usageWith().totals, calls: 99 } })
    mockedGetUsage.mockResolvedValueOnce(newer)
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.usage?.totals.calls).toBe(99))

    // The STALE first response now resolves — it must be discarded, not applied.
    act(() => resolveFirst(usageWith({ totals: { ...usageWith().totals, calls: 1 } })))
    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.usage?.totals.calls).toBe(99)
  })

  it('a failed GET surfaces error and clears loading, and allows a later retry', async () => {
    mockedGetUsage.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() => useEngineUsage())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toMatch(/could not be loaded/i)
    expect(result.current.usage).toBeNull()

    mockedGetUsage.mockResolvedValueOnce(usageWith())
    act(() => result.current.refresh())
    await waitFor(() => expect(result.current.usage).not.toBeNull())
    expect(result.current.error).toBeNull()
  })

  it("per-exercise scoping (COR-001): a different exercise never observes another exercise's usage", async () => {
    mockedGetUsage.mockResolvedValueOnce(usageWith({ totals: { ...usageWith().totals, calls: 1 } }))
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-a'))
    const { result: a } = renderHook(() => useEngineUsage())
    await waitFor(() => expect(a.current.usage).not.toBeNull())

    mockedGetUsage.mockResolvedValueOnce(usageWith({ totals: { ...usageWith().totals, calls: 7 } }))
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-b'))
    const { result: b } = renderHook(() => useEngineUsage())
    await waitFor(() => expect(b.current.usage).not.toBeNull())

    expect(a.current.usage?.totals.calls).toBe(1)
    expect(b.current.usage?.totals.calls).toBe(7)
  })
})

describe('engineUsageStore.setForTests', () => {
  it('injects a snapshot directly, bypassing mock/live, and marks the exercise as already-started', () => {
    mockedUseExerciseContext.mockReturnValue(scopeFor('ex-injected'))
    engineUsageStore.setForTests('ex-injected', usageWith({ totals: { ...usageWith().totals, calls: 42 } }))

    const { result } = renderHook(() => useEngineUsage())

    expect(result.current.usage?.totals.calls).toBe(42)
    expect(mockedGetUsage).not.toHaveBeenCalled()
  })
})
