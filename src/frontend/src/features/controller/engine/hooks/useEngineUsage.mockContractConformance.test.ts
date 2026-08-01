/**
 * features/controller/engine/hooks/useEngineUsage.mockContractConformance.test.ts
 * ---------------------------------------------------------------------------
 * Adversarial QA pass (engine-telemetry-tuning, story 03c). Pins
 * `buildMockEngineUsage()`'s output as STRUCTURALLY CONFORMANT to the real
 * `GET /api/engine/usage` wire contract by round-tripping it through the SAME
 * fail-closed wire validator a live backend response has to pass
 * (`liveEngineUsageActions.ts`'s `isWireEngineUsage`, exercised indirectly
 * here via `getUsage()`, since the validator itself is private to that
 * module).
 *
 * WHAT THIS PROVES: every field name, nesting, and null-vs-number shape the
 * mock produces is one the frontend's OWN hand-maintained wire validator
 * accepts, for every window preset the panel offers plus one non-preset
 * window (61 minutes — an uneven bucket split) to prove the validator's
 * acceptance isn't accidentally keyed to the preset list. A future PR that
 * renames or mistypes a field in `buildMockEngineUsage` (without also
 * updating the validator) reds here immediately, rather than shipping a mock
 * that silently diverges from what `isWireEngineUsage` actually checks.
 *
 * WHAT THIS DOES NOT PROVE (over-claiming exactly what a repeat finding on
 * this feature area has been): that the validator still matches the LIVE
 * `EngineUsageContracts.cs` DTO on the backend. That correspondence was
 * checked BY HAND this session, field for field, against
 * `src/Pulse.WebApi/Features/EngineRuntime/Usage/EngineUsageContracts.cs`
 * (property names incl. exact JSON casing, nullable-cost-fields-present-as-
 * null-never-omitted, and numeric types) — no divergence was found. This
 * test does not re-run that audit and does not talk to a real backend; it is
 * a static SHAPE PIN over two hand-maintained TypeScript artifacts (the mock
 * generator and the wire validator), not an integration test. A backend
 * rename that nobody mirrors into `liveEngineUsageActions.ts` would NOT be
 * caught here.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildMockEngineUsage } from './useEngineUsage'
import { getUsage } from '../services/liveEngineUsageActions'

// `vi.mock` calls are hoisted by vitest to the top of the module regardless
// of where they're written, so `getUsage` (imported above) binds to this
// mocked `api.get` — mirrors `liveEngineUsageActions.test.ts`'s own ordering.
const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

const NOW_MS = Date.parse('2033-09-04T14:00:00.000Z')

// Every window the panel's own preset selector offers
// (`ENGINE_USAGE_WINDOW_PRESETS_MINUTES`), plus 61 — NOT a panel preset, an
// uneven-bucket-split window included only to prove the validator's
// acceptance doesn't depend on which windows the panel happens to offer.
const WINDOWS_MINUTES_TO_CHECK = [1, 15, 60, 240, 1440, 61] as const

beforeEach(() => {
  getMock.mockReset()
})

describe('buildMockEngineUsage — structural conformance to the real wire contract (shape pin, not an integration test)', () => {
  it.each(WINDOWS_MINUTES_TO_CHECK)(
    'passes the real getUsage() wire validator for a %d-minute window',
    async minutes => {
      const mockDto = buildMockEngineUsage(minutes, NOW_MS)
      getMock.mockResolvedValueOnce({ data: mockDto })

      // If any field the validator declares were missing, mistyped, or
      // renamed on either side, `getUsage()` would throw
      // `MalformedEngineUsageResponseError` here instead of resolving.
      await expect(getUsage()).resolves.toEqual(mockDto)
    },
  )

  it('every cost row nullable field is explicitly null (never omitted) when unpriced, matching the backend which sends null verbatim (no JsonIgnore(WhenWritingNull) on these fields)', async () => {
    const mockDto = buildMockEngineUsage(60, NOW_MS)
    const unpricedRow = mockDto.cost.byModel.find(row => !row.priced)
    expect(unpricedRow).toBeDefined()
    expect(unpricedRow?.inputCost).toBeNull()
    expect(unpricedRow?.outputCost).toBeNull()
    expect(unpricedRow?.cacheReadCost).toBeNull()
    expect(unpricedRow?.cacheCreationCost).toBeNull()
    expect(unpricedRow?.totalCost).toBeNull()
    expect(unpricedRow?.rates).toBeNull()

    getMock.mockResolvedValueOnce({ data: mockDto })
    await expect(getUsage()).resolves.toEqual(mockDto)
  })
})
