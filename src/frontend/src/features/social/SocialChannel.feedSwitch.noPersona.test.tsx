/**
 * features/social/SocialChannel.feedSwitch.noPersona.test.tsx
 * ---------------------------------------------------------------------------
 * The second COR-015 axis of the channel's All Posts / Following switch (#88):
 * a session with NO bound persona — nothing to follow AS — is offered no
 * switch at all, exactly like a read-only observer (the shell-variant axis,
 * covered in `SocialChannel.feedSwitch.test.tsx`).
 *
 * `useFeed` already forces such a session back to All Posts on its own
 * (feeds-discovery/02, `useFeed.readonlyGuard.test.ts`), so this file asserts
 * the AFFORDANCE decision the channel owns: the control is ABSENT rather than
 * present-and-silently-ineffective (D1-011's absent-not-disabled convention).
 *
 * Lives in its own file because `vi.mock('@/core/auth', ...)` is hoisted to the
 * whole module and would replace the real `SessionProvider` the sibling suites
 * render through — the same split rationale as
 * `Feed.followingReadOnlyDefault.test.tsx`.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import { SocialChannel } from './SocialChannel'

const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

/** A shared-terminal participant session with no persona bound (COR-015). */
const NO_PERSONA_SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-shared',
  role: 'participant',
  personaId: undefined,
  actingHumanId: 'human-shared',
  isReadOnly: false,
  expiresAt: '2999-01-01T00:00:00.000Z',
}

vi.mock('@/core/auth', () => ({
  useSession: () => NO_PERSONA_SESSION,
}))

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

function renderChannel() {
  setExerciseClock(fixedClock(SCENARIO_NOW))
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant: 'full', scenarioNow: SCENARIO_NOW }
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <ShellContextProvider value={mount}>
          <SocialChannel />
        </ShellContextProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('SocialChannel — no-persona session gets no feed switch (COR-015)', () => {
  it('renders All Posts with the Following affordance absent, not inert', async () => {
    renderChannel()
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    expect(screen.queryByRole('tablist', { name: 'Feed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Following' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('social-feed-panel-following')).not.toBeInTheDocument()
    // The All Posts feed is still served in full.
    expect(screen.getByTestId('social-feed-panel-all')).toBeVisible()
  })
})
