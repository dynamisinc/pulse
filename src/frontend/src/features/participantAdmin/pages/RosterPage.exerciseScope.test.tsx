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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { configure, act, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { useExerciseContext, type ExerciseScope } from '@/core/exerciseContext'
import { cobraTheme } from '@/theme/cobraTheme'
import { rosterQueryKey } from '../hooks/useRoster'
import { useRosterAction } from '../hooks/useRosterMutations'
import * as rosterService from '../services/rosterService'
import { makeEntry } from '../test/fixtures'
import { setupUser } from '../test/userEvents'
import type { RosterListDto } from '../types'
import { RosterPage } from './RosterPage'

// The full COBRA page mounts through the mock backend; give a loaded CI box headroom
// over the 10 s test default and the 5 s `findBy`/`waitFor` default (src/test/setup.ts).
vi.setConfig({ testTimeout: 30_000 })
configure({ asyncUtilTimeout: 10_000 })

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

describe('roster isolation — no page state survives an exercise switch (Gate-1 W2)', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
  })

  it('clears the announcement, the selection, the filter and any open dialog when the exercise changes', async () => {
    const cards = vi.fn((_selection: readonly string[]): ReactNode => null)
    const user = setupUser()
    scopeSpy.mockReturnValue(scope('ex-A'))
    // The SAME participant id exists in both exercises, so a selection that wrongly
    // survived the switch would still match a row in B and show up as "1 selected".
    getRosterSpy.mockResolvedValueOnce(listOf('Shared Person', 'Other Person'))
    const wrapper = wrapperFor(makeClient())
    const view = render(<RosterPage renderCardsAction={cards} />, { wrapper })
    await screen.findByTestId('roster-table')

    // Build up page state in exercise A: a selection, an announcement, a filter, a dialog.
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    await user.click(screen.getByRole('checkbox', { name: 'Select Shared Person' }))
    await user.click(screen.getByRole('button', { name: 'Copy link for Shared Person' }))
    await user.click(screen.getByRole('button', { name: 'Add participant' }))
    await screen.findByRole('dialog', { name: 'Add participant' })

    expect(screen.getByTestId('roster-announcement')).toHaveTextContent('Link copied for Shared Person.')
    expect(screen.getByTestId('roster-selected-count')).toHaveTextContent('1 selected')
    expect(cards).toHaveBeenLastCalledWith(['Shared Person-0'])

    // The staff switcher moves the session to exercise B WITHOUT remounting the tree.
    scopeSpy.mockReturnValue(scope('ex-B'))
    getRosterSpy.mockResolvedValueOnce(listOf('Shared Person', 'Other Person'))
    view.rerender(<RosterPage renderCardsAction={cards} />)

    const table = await screen.findByTestId('roster-table')
    expect(screen.getByTestId('roster-announcement')).toBeEmptyDOMElement()
    expect(screen.getByTestId('roster-announcement-error')).toBeEmptyDOMElement()
    expect(screen.queryByTestId('roster-selected-count')).not.toBeInTheDocument()
    expect(within(table).getByRole('checkbox', { name: 'Select Shared Person' })).not.toBeChecked()
    expect(cards).toHaveBeenLastCalledWith([])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Filter participants' })).toHaveValue('')
  })

  it('also resets a typed filter and a changed sort', async () => {
    const user = setupUser()
    scopeSpy.mockReturnValue(scope('ex-A'))
    getRosterSpy.mockResolvedValueOnce(listOf('Alpha Person', 'Beta Person'))
    const view = render(<RosterPage />, { wrapper: wrapperFor(makeClient()) })
    await screen.findByTestId('roster-table')
    await user.click(screen.getByRole('searchbox', { name: 'Filter participants' }))
    await user.paste('alpha')
    await user.click(within(screen.getByRole('columnheader', { name: 'Name' })).getByRole('button'))
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending')

    scopeSpy.mockReturnValue(scope('ex-B'))
    getRosterSpy.mockResolvedValueOnce(listOf('Alpha Person', 'Beta Person'))
    view.rerender(<RosterPage />)
    await screen.findByTestId('roster-table')

    expect(screen.getByRole('searchbox', { name: 'Filter participants' })).toHaveValue('')
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending')
    expect(screen.getByText('Beta Person')).toBeInTheDocument()
  })
})
