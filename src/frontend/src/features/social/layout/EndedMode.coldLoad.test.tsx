/**
 * Exercise ended, COLD LOAD (ended read-only review F-1).
 *
 * After a reload in `completed` the shell learns its state from the server, not from a live flip:
 * `GET /api/shell-state` answers the lifecycle projection's variant for `completed`, and
 * `GET /api/overlay-state` answers `ended: true`. This mounts the REAL `ShellLayout` around the
 * real `SocialChannel` against exactly those two bodies and pins Tom's ruling: notifications and
 * the personal Following / Pinned tabs stay available after EndEx, while every write is absent.
 *
 * `COMPLETED_SHELL_VARIANT` mirrors `LifecycleShellVariantProjection.VariantFor("completed")`
 * (pinned server-side by `LifecycleProjectionTests.ShellVariantProjection_Completed_IsFull_...`).
 * The control case shows why it must be `full`: the old `readOnly` projection hid those views.
 */
import { act, screen, render, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellLayout } from '@/features/participant-shell/ShellLayout'
import type { ShellVariant } from '@/features/participant-shell/mountContract'
import { SocialChannel } from '../SocialChannel'
import { SCENARIO_NOW } from './renderChannel.testUtils'

/** What the server projects for a `completed` exercise (see the module header). */
const COMPLETED_SHELL_VARIANT: ShellVariant = 'full'

/** What the server's overlay projection answers in `completed`. */
const COMPLETED_OVERLAY_BODY = { state: 'none', register: 'in-fiction', message: '', ended: true }

const WRITE_BUTTONS = [/^Like,/, /^Repost,/, /^Reply,/, /^Pin$/, /^Edit post$/]

function serveCompleted(variant: ShellVariant) {
  const realGet = api.get.bind(api)
  return vi.spyOn(api, 'get').mockImplementation((url, config) => {
    if (url === '/shell-state') return Promise.resolve({ data: { variant } } as never)
    if (url === '/overlay-state') return Promise.resolve({ data: COMPLETED_OVERLAY_BODY } as never)
    return realGet(url, config)
  })
}

function mountShell(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellLayout>
              <SocialChannel />
            </ShellLayout>
          </SessionProvider>
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function feedReady() {
  await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
}

beforeEach(() => {
  resetTelemetryBuffer()
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
})

afterEach(() => {
  vi.restoreAllMocks()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('exercise ended, cold load against the real server answers', () => {
  it('keeps notifications and the Following / Pinned tabs, with every write absent', async () => {
    serveCompleted(COMPLETED_SHELL_VARIANT)
    mountShell('/home')
    await feedReady()
    expect(await screen.findByTestId('pulse-exercise-ended-banner')).toBeInTheDocument()

    const tabs = screen.getByRole('tablist')
    expect(within(tabs).getByRole('tab', { name: 'Following' })).toBeInTheDocument()
    expect(within(tabs).getByRole('tab', { name: 'Pinned' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Notifications/ })).toBeInTheDocument()

    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    expect(screen.queryByTestId('nav-post-button')).not.toBeInTheDocument()
    for (const name of WRITE_BUTTONS) {
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0)
    }
    expect(screen.queryByTestId('follow-button')).not.toBeInTheDocument()
  })

  it('the notifications page itself stays reachable', async () => {
    serveCompleted(COMPLETED_SHELL_VARIANT)
    mountShell('/notifications')
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Notifications' }),
    ).toBeInTheDocument()
  })

  it('control: the old readOnly projection hid the personal views (why completed is full)', async () => {
    const get = serveCompleted('readOnly')
    mountShell('/home')
    await feedReady()
    // Let the shell-state answer land, so this is the SERVED readOnly, not the pending fallback.
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/shell-state')).toBe(true))
    await act(async () => {})

    expect(screen.queryByRole('tab', { name: 'Following' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Pinned' })).not.toBeInTheDocument()
  })
})
