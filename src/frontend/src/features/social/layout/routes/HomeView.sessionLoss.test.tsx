/**
 * features/social/layout/routes/HomeView.sessionLoss.test.tsx
 * ---------------------------------------------------------------------------
 * A session that LOSES the tab switch while the reader is on Pinned (it turns read-only
 * mid-view) must fall back to All Posts - never a hidden tab and a blank Home
 * (demo-feedback story 07, Gate-1 L5; COR-015, D1-011).
 *
 * Own file: `@/core/auth` is mocked module-wide with a session the test can change.
 */
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import { resetMockPins } from '../../pinned/mockPins'
import { SocialChannel } from '../../SocialChannel'

const sessionStore = vi.hoisted(() => {
  const writable = {
    exerciseId: 'ex-mock-0001',
    accountId: 'acct-dreyes',
    role: 'participant',
    personaId: 'persona-dreyes_fh',
    actingHumanId: 'human-dreyes',
    isReadOnly: false,
    expiresAt: '2999-01-01T00:00:00.000Z',
  }
  let current: typeof writable = writable
  const listeners = new Set<() => void>()
  return {
    writable,
    get: () => current,
    set(next: typeof writable) {
      current = next
      for (const listener of [...listeners]) listener()
    },
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
})

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  const { useSyncExternalStore } = await import('react')
  return {
    ...actual,
    useSession: () =>
      useSyncExternalStore(sessionStore.subscribe, sessionStore.get) as unknown as Session,
  }
})

const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

afterEach(() => {
  sessionStore.set(sessionStore.writable)
  resetExerciseClock()
  resetTelemetryBuffer()
  resetMockPins()
})

describe('HomeView — losing the switch mid-view (L5)', () => {
  it('falls back to All Posts instead of a blank Home', async () => {
    const user = userEvent.setup()
    setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const mount: ShellMountProps = { variant: 'full', scenarioNow: SCENARIO_NOW }
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/home']}>
          <ExerciseContextProvider>
            <ShellContextProvider value={mount}>
              <SocialChannel />
            </ShellContextProvider>
          </ExerciseContextProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    )
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    await user.click(screen.getByRole('tab', { name: 'Pinned' }))
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-pinned')).toBeVisible())
    expect(screen.getByTestId('social-feed-panel-all')).not.toBeVisible()

    // The session turns read-only while the reader is on Pinned.
    act(() => sessionStore.set({ ...sessionStore.writable, isReadOnly: true }))

    expect(screen.queryByRole('tablist', { name: 'Feed' })).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-all')).toBeVisible())
    expect(screen.getByTestId('social-feed-panel-pinned')).not.toBeVisible()
  })
})
