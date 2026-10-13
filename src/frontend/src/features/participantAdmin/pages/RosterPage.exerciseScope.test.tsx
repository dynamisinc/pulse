/**
 * features/participantAdmin/pages/RosterPage.exerciseScope.test.tsx
 * ---------------------------------------------------------------------------
 * Easy-login story 10 — ISOLATION (XC-001 / COR-001). The roster is scoped by
 * the SERVER from the staff session; the client's only part is that it never
 * sends an exercise id and never lets one exercise's cached people appear under
 * another. So:
 *
 *   - every React Query key carries the active exercise id (from
 *     `useExerciseContext()`), which only keys the cache;
 *   - the id is never passed to the service, the request, or a mutation;
 *   - switching exercise lands on a different cache entry, so the previous
 *     exercise's people are never shown while the new one loads;
 *   - a write invalidates ONLY the active exercise's roster.
 *
 * `useExerciseContext` is mocked so a test can change the active exercise; the
 * service is mocked at its boundary so each exercise can answer differently.
 */
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { configure, act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { cobraTheme } from '@/theme/cobraTheme'
import { rosterQueryKey } from '../hooks/useRoster'
import { useRosterAction } from '../hooks/useRosterMutations'
import * as rosterService from '../services/rosterService'
import { makeEntry } from '../test/fixtures'
import type { RosterListDto } from '../types'
import { RosterPage } from './RosterPage'

// The full COBRA page mounts through the mock backend; give a loaded CI box headroom
// over the 10 s test default and the 5 s `findBy`/`waitFor` default (src/test/setup.ts).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 20_000 })

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return { ...actual, useExerciseContext: vi.fn() }
})

vi.mock('../services/rosterService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/rosterService')>()
  return { ...actual, getRoster: vi.fn(), runRosterAction: vi.fn() }
})

const getRosterSpy = vi.mocked(rosterService.getRoster)
const runActionSpy = vi.mocked(rosterService.runRosterAction)
const scopeSpy = vi.mocked(useExerciseContext)

function scope(exerciseId: string): ExerciseScope {
  return { exerciseId, exerciseName: `Exercise ${exerciseId}`, timeZone: 'UTC', status: 'live' }
}

function listOf(...names: string[]): RosterListDto {
  return {
    participants: names.map((name, i) => makeEntry({
      id: `${name}-${i}`,
      name,
      signInName: name.toLowerCase().replace(/\s+/g, ''),
    })),
    joinLinksAvailable: true,
    capabilities: { emailLinks: false },
  }
}

function makeClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
}

beforeEach(() => {
  getRosterSpy.mockReset()
  runActionSpy.mockReset()
  scopeSpy.mockReset()
})

describe('roster isolation — the query key carries the exercise id', () => {
  it('keys the roster query by the active exercise: [participantAdmin, <exerciseId>, roster]', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValue(listOf('Alpha Person'))
    const client = makeClient()

    render(<RosterPage />, { wrapper: wrapperFor(client) })
    await screen.findByText('Alpha Person')

    const keys = client.getQueryCache().getAll().map(query => query.queryKey)
    expect(keys).toContainEqual(['participantAdmin', 'ex-A', 'roster'])
    expect(rosterQueryKey('ex-A')).toEqual(['participantAdmin', 'ex-A', 'roster'])
    // Every query this screen owns includes the exercise id.
    for (const key of keys) expect(key).toContain('ex-A')
  })

  it('is read with staleTime 0 and a short gcTime (the rows hold join URLs)', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValue(listOf('Alpha Person'))
    const client = makeClient()

    render(<RosterPage />, { wrapper: wrapperFor(client) })
    await screen.findByText('Alpha Person')

    const query = client.getQueryCache().find({ queryKey: rosterQueryKey('ex-A') })
    expect(query?.observers[0]?.options.staleTime).toBe(0)
    const gcTime = query?.gcTime ?? Number.POSITIVE_INFINITY
    expect(gcTime).toBeLessThanOrEqual(60_000)
  })
})

describe('roster isolation — no exercise id is ever sent', () => {
  it('calls the service with NO arguments (the key is not forwarded as a parameter)', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValue(listOf('Alpha Person'))

    render(<RosterPage />, { wrapper: wrapperFor(makeClient()) })
    await screen.findByText('Alpha Person')

    expect(getRosterSpy).toHaveBeenCalledWith()
  })

  it('an action sends only the participant id taken from the list', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    runActionSpy.mockResolvedValue({
      participantId: 'p-1',
      link: { status: 'revoked', useCount: 0 },
      access: 'enabled',
      sessionsEnded: 0,
    })
    const client = makeClient()
    const { result } = renderHook(() => useRosterAction(), { wrapper: wrapperFor(client) })

    await act(async () => {
      await result.current.mutateAsync({ kind: 'revoke', participantId: 'p-1' })
    })

    expect(runActionSpy).toHaveBeenCalledWith('revoke', 'p-1')
    expect(JSON.stringify(runActionSpy.mock.calls)).not.toContain('ex-A')
  })
})

describe('roster isolation — switching exercise', () => {
  it('never shows the previous exercise\'s people: a pending roster for the new one shows loading, not the old rows', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValueOnce(listOf('Alpha Person'))
    const client = makeClient()
    const view = render(<RosterPage />, { wrapper: wrapperFor(client) })
    await screen.findByText('Alpha Person')

    // The staff switcher re-resolves the scope to exercise B; B's roster is slow.
    let resolveB: (list: RosterListDto) => void = () => {}
    getRosterSpy.mockReturnValueOnce(new Promise<RosterListDto>(resolve => { resolveB = resolve }))
    scopeSpy.mockReturnValue(scope('ex-B'))
    view.rerender(<RosterPage />)

    expect(await screen.findByTestId('roster-loading')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Person')).not.toBeInTheDocument()

    await act(async () => { resolveB(listOf('Beta Person')) })

    expect(await screen.findByText('Beta Person')).toBeInTheDocument()
    expect(screen.queryByText('Alpha Person')).not.toBeInTheDocument()

    // Two separate cache entries, one per exercise.
    const keys = client.getQueryCache().getAll().map(query => query.queryKey)
    expect(keys).toContainEqual(['participantAdmin', 'ex-A', 'roster'])
    expect(keys).toContainEqual(['participantAdmin', 'ex-B', 'roster'])
  })

  it('switching back does not show a stale copy of the other exercise\'s rows as current', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValueOnce(listOf('Alpha Person'))
    const view = render(<RosterPage />, { wrapper: wrapperFor(makeClient()) })
    await screen.findByText('Alpha Person')

    scopeSpy.mockReturnValue(scope('ex-B'))
    getRosterSpy.mockResolvedValueOnce(listOf('Beta Person'))
    view.rerender(<RosterPage />)
    await screen.findByText('Beta Person')

    expect(screen.queryByText('Alpha Person')).not.toBeInTheDocument()
  })
})

describe('roster isolation — writes invalidate only the active exercise', () => {
  it('a successful action marks exercise A\'s roster stale and leaves exercise B\'s alone', async () => {
    scopeSpy.mockReturnValue(scope('ex-A'))
    runActionSpy.mockResolvedValue({
      participantId: 'p-1',
      link: { status: 'revoked', useCount: 0 },
      access: 'enabled',
      sessionsEnded: 1,
    })
    const client = makeClient()
    client.setQueryData(rosterQueryKey('ex-A'), listOf('Alpha Person'))
    client.setQueryData(rosterQueryKey('ex-B'), listOf('Beta Person'))
    const { result } = renderHook(() => useRosterAction(), { wrapper: wrapperFor(client) })

    await act(async () => {
      await result.current.mutateAsync({ kind: 'revoke', participantId: 'p-1' })
    })

    await waitFor(() => {
      expect(client.getQueryState(rosterQueryKey('ex-A'))?.isInvalidated).toBe(true)
    })
    expect(client.getQueryState(rosterQueryKey('ex-B'))?.isInvalidated).toBe(false)
  })
})
