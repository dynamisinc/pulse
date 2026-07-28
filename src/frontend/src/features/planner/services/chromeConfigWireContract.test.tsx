/**
 * features/planner/services/chromeConfigWireContract.test.tsx
 * ---------------------------------------------------------------------------
 * Story 02 (compliance chrome — exercise-configuration; #41 / story #68), AC2:
 * the CONTRACT test.
 *
 * Story 02 replaced the hardcoded `/api/chrome-config` constant with a
 * per-exercise projection behind the UNCHANGED frozen `ChromeConfigResponse`
 * shape. The claim that needs proving is "the frozen client needs no change" —
 * so this drives the SHIPPED participant hook, `useChromeConfig()`, through a
 * mocked axios boundary returning the EXACT body the backend now serves, and
 * asserts the hook resolves THAT body rather than falling back to its
 * `DEFAULT_CHROME_CONFIG`.
 *
 * WHY THE FALLBACK IS THE ASSERTION. `chromeConfig.ts`'s `isChromeConfig` guard
 * is module-private and belongs to `participant-shell`, a different Complete
 * feature — it is deliberately not imported here. But a hook that silently
 * returns its safe default IS that guard rejecting the shape, so asserting the
 * hook resolves the real body proves the wire contract without exporting
 * anything. A reshaped response would NOT be a type error in UAT; it would blank
 * the per-exercise chrome behind a fail-closed default, which is exactly the
 * failure mode this test makes loud.
 *
 * This file lives in the planner surface (story 02's own files) rather than in
 * `participant-shell/`, whose files this story does not own.
 *
 * World: this exercises a PARTICIPANT data seam from a staff-owned test — no UI
 * is rendered, so no theme is involved either way.
 */
import type { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { useChromeConfig } from '@/features/participant-shell/chromeConfig'

vi.mock('@/core/services/api', () => ({
  api: { get: vi.fn() },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-story-02-chrome-0001',
    exerciseName: 'Chrome Contract Exercise',
    timeZone: 'UTC',
    status: 'live',
  }),
}))

const mockGet = vi.mocked(api.get)

/**
 * The EXACT body story 02's `ChromeConfigProjection` serves for a configured
 * exercise, keys and casing as ASP.NET Core's camelCase serializer emits them
 * (`ChromeConfigResponse` -> `{ enabled, top{text,fg,bg}, bottom{text,fg,bg} }`).
 * Deliberately per-exercise values that appear in NO shipped constant, so a
 * fallback cannot masquerade as a pass.
 */
const BACKEND_BODY = {
  enabled: true,
  top: {
    text: 'UNCLASSIFIED // ATLANTA CIE 2026',
    fg: '#f5f5f5',
    bg: '#14532d',
  },
  bottom: {
    text: 'SIMULATED INFORMATION SPACE — ATLANTA',
    fg: '#f5f5f5',
    bg: '#14532d',
  },
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  }
}

function newQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

beforeEach(() => {
  mockGet.mockReset()
})

describe('GET /api/chrome-config wire contract (story 02 fills the FROZEN shape)', () => {
  it('the shipped useChromeConfig() accepts the per-exercise body unchanged', async () => {
    mockGet.mockResolvedValue({ data: BACKEND_BODY } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = newQueryClient()

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() =>
      expect(result.current.top.text).toBe('UNCLASSIFIED // ATLANTA CIE 2026'),
    )
    // If the backend ever reshaped this body, the private guard would reject it
    // and the hook would return DEFAULT_CHROME_CONFIG instead - silently, with
    // no type error, blanking the per-exercise chrome in UAT.
    expect(result.current).toEqual(BACKEND_BODY)

    // And the query actually SUCCEEDED - the value is not the safe default
    // showing through a still-pending or errored query.
    await waitFor(() => {
      const state = queryClient.getQueryCache().findAll()[0]?.state
      expect(state?.status).toBe('success')
    })
  })

  it('accepts a chrome-OFF body — chrome-off is a legal per-exercise state (D7-008)', async () => {
    mockGet.mockResolvedValue({
      data: { ...BACKEND_BODY, enabled: false },
    } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = newQueryClient()

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    // A rejected body would have fallen back to `enabled: true`, so reaching
    // `false` at all already proves the guard accepted this shape.
    await waitFor(() => expect(result.current.enabled).toBe(false))
    expect(result.current.top.text).toBe('UNCLASSIFIED // ATLANTA CIE 2026')
  })

  it('requests the frozen route and never sends the exercise as a parameter (COR-001)', async () => {
    mockGet.mockResolvedValue({ data: BACKEND_BODY } as Awaited<ReturnType<typeof api.get>>)
    const queryClient = newQueryClient()

    renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => expect(mockGet).toHaveBeenCalled())
    const call = mockGet.mock.calls[0]
    expect(call?.[0]).toBe('/chrome-config')
    expect(call?.[0]).not.toContain('ex-story-02-chrome-0001')
    expect(call?.[1] as Record<string, unknown> | undefined).not.toHaveProperty('params')
  })

  it('a RESHAPED body (the regression this story must never ship) falls back to the default', async () => {
    // The negative control that gives the assertions above their teeth: rename a
    // key and the private guard rejects the whole body, the query errors, and the
    // shell serves its shipped default for every exercise.
    mockGet.mockResolvedValue({
      data: { enabled: true, topBanner: BACKEND_BODY.top, bottom: BACKEND_BODY.bottom },
    } as unknown as Awaited<ReturnType<typeof api.get>>)
    const queryClient = newQueryClient()

    const { result } = renderHook(() => useChromeConfig(), { wrapper: makeWrapper(queryClient) })

    await waitFor(() => {
      const state = queryClient.getQueryCache().findAll()[0]?.state
      expect(state?.status).toBe('error')
    })
    expect(result.current.top.text).toContain('UNCLASSIFIED')
    expect(result.current.top.text).not.toBe('UNCLASSIFIED // ATLANTA CIE 2026')
  })
})
