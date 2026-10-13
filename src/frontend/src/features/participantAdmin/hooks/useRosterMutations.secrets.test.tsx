/**
 * features/participantAdmin/hooks/useRosterMutations.secrets.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10, Gate-1 W1 — a join URL must not sit in React Query's
 * MUTATION cache. The roster list query has a 30 s `gcTime`; a mutation result
 * lives in a second cache with its own (default 5 minute) timer, so a reissue or
 * an add that carried `link.joinUrl` back would hold the bearer credential long
 * after the list let go of it.
 *
 * Uses the REAL service and the shipped mock adapter (which DOES put a join URL in
 * a reissue and an add response, proven below), so what is asserted is what the
 * live seam does: the URL is dropped at the service, and the mutation cache is
 * emptied the moment nothing observes it.
 */
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { api } from '@/core/services/api'
import { useExerciseContext } from '@/core/exerciseContext'
import { resetRosterMocks, rosterMockAdapter } from '../mocks/rosterMocks'
import { useAddParticipant, useImportRoster, useRosterAction } from './useRosterMutations'

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn() }
})

const SECRET_MARKERS = ['MOCK-TOKEN', 'pulse.example.test', '/join/']

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

/** Everything the mutation cache holds, serialised: state, variables, options. */
function mutationCacheDump(client: QueryClient): string {
  return JSON.stringify(
    client.getMutationCache().getAll().map(mutation => ({
      state: mutation.state,
      variables: mutation.state.variables,
    })),
  )
}

beforeEach(() => {
  resetRosterMocks()
  vi.mocked(useExerciseContext).mockReturnValue({
    exerciseId: 'ex-A',
    exerciseName: 'Exercise A',
    timeZone: 'UTC',
    status: 'live',
  })
})

describe('the mutation cache never holds a join URL', () => {
  it('(sanity) the mock backend DOES return a join URL on a reissue and an add', async () => {
    const reissue = await api.post('/staff/roster/mock-acct-002/link/reissue', undefined, {
      adapter: rosterMockAdapter,
    })
    expect(JSON.stringify(reissue.data)).toContain('MOCK-TOKEN')

    const add = await api.post('/staff/roster', { name: 'Riley Chen' }, { adapter: rosterMockAdapter })
    expect(JSON.stringify(add.data)).toContain('MOCK-TOKEN')
  })

  it('after a reissue, nothing in the mutation cache contains a URL or token', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useRosterAction(), { wrapper: wrapperFor(client) })

    await act(async () => {
      await result.current.mutateAsync({ kind: 'reissue', participantId: 'mock-acct-002' })
    })

    expect(client.getMutationCache().getAll()).toHaveLength(1)
    await waitFor(() => expect(result.current.data?.sessionsEnded).toBe(2))
    const dump = mutationCacheDump(client)
    for (const marker of SECRET_MARKERS) expect(dump).not.toContain(marker)
  })

  it('after an add, nothing in the mutation cache contains a URL or token', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useAddParticipant(), { wrapper: wrapperFor(client) })

    await act(async () => {
      await result.current.mutateAsync({ name: 'Riley Chen', agency: 'Fulco Fire' })
    })

    await waitFor(() => expect(result.current.data?.signInName).toBe('rchen'))
    const dump = mutationCacheDump(client)
    for (const marker of SECRET_MARKERS) expect(dump).not.toContain(marker)
  })

  it('a revoke, disable and enable are clean too', async () => {
    const client = makeClient()
    const { result } = renderHook(() => useRosterAction(), { wrapper: wrapperFor(client) })

    for (const kind of ['revoke', 'disable', 'enable'] as const) {
      await act(async () => {
        await result.current.mutateAsync({ kind, participantId: 'mock-acct-001' })
      })
    }

    const dump = mutationCacheDump(client)
    for (const marker of SECRET_MARKERS) expect(dump).not.toContain(marker)
  })

  it('a finished mutation is dropped from the cache as soon as nothing observes it (gcTime 0)', async () => {
    const client = makeClient()
    const actionHook = renderHook(() => useRosterAction(), { wrapper: wrapperFor(client) })
    const addHook = renderHook(() => useAddParticipant(), { wrapper: wrapperFor(client) })
    const importHook = renderHook(() => useImportRoster(), { wrapper: wrapperFor(client) })

    await act(async () => {
      await actionHook.result.current.mutateAsync({ kind: 'reissue', participantId: 'mock-acct-002' })
      await addHook.result.current.mutateAsync({ name: 'Riley Chen' })
      await importHook.result.current.mutateAsync({
        file: new File(['name\nSam Ortiz'], 'roster.csv', { type: 'text/csv' }),
        dryRun: true,
      })
    })
    expect(client.getMutationCache().getAll()).toHaveLength(3)

    actionHook.unmount()
    addHook.unmount()
    importHook.unmount()

    await waitFor(() => expect(client.getMutationCache().getAll()).toHaveLength(0))
  })
})
