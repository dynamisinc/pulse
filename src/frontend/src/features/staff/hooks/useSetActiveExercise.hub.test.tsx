/**
 * features/staff/hooks/useSetActiveExercise.hub.test.tsx
 * ---------------------------------------------------------------------------
 * #856: a successful exercise switch rebuilds the shared hub connection (the session's principal
 * changed server-side; the hub refuses long-poll/SSE requests from a changed user), and a switch
 * whose scope cannot be re-resolved does not (the console fails closed and asks for a reload).
 */
import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resolveExerciseContext } from '@/core/exerciseContext/exerciseContextResolver'
import { realtimeConnection } from '@/core/realtime/connection'
import { setActiveExercise } from '../services/staffAssignmentsService'
import { useSetActiveExercise } from './useSetActiveExercise'

vi.mock('@/core/exerciseContext/exerciseContextResolver', () => ({
  resolveExerciseContext: vi.fn(),
}))
vi.mock('../services/staffAssignmentsService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/staffAssignmentsService')>()
  return { ...actual, setActiveExercise: vi.fn() }
})

const mockResolve = vi.mocked(resolveExerciseContext)
const mockSwitch = vi.mocked(setActiveExercise)

const scope = (id: string) => ({
  exerciseId: id,
  exerciseName: id,
  timeZone: 'UTC',
  status: 'live' as const,
})

const ENROLLMENT = {
  exerciseId: 'ex-b',
  exerciseName: 'ex-b',
  role: 'controller' as const,
  personId: 'p',
  isLead: false,
}

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>{children}</ExerciseContextProvider>
    </QueryClientProvider>
  )
}

describe('useSetActiveExercise - hub connection', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockResolve.mockReset()
    mockSwitch.mockReset()
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('reconnects the hub once the new scope is resolved', async () => {
    const reconnect = vi.spyOn(realtimeConnection, 'reconnect').mockResolvedValue()
    mockResolve.mockResolvedValueOnce(scope('ex-a')).mockResolvedValue(scope('ex-b'))
    mockSwitch.mockResolvedValue(ENROLLMENT)

    const { result } = renderHook(() => useSetActiveExercise(), { wrapper })
    await waitFor(() => expect(result.current).not.toBeNull())
    await act(async () => {
      await result.current.mutateAsync('ex-b')
    })

    expect(reconnect).toHaveBeenCalledTimes(1)
  })

  it('does not reconnect when the scope could not be re-resolved', async () => {
    const reconnect = vi.spyOn(realtimeConnection, 'reconnect').mockResolvedValue()
    mockResolve.mockResolvedValueOnce(scope('ex-a')).mockRejectedValue(new Error('down'))
    mockSwitch.mockResolvedValue(ENROLLMENT)

    const { result } = renderHook(() => useSetActiveExercise(), { wrapper })
    await waitFor(() => expect(result.current).not.toBeNull())
    await act(async () => {
      await result.current.mutateAsync('ex-b').catch(() => {})
    })

    expect(reconnect).not.toHaveBeenCalled()
  })
})
