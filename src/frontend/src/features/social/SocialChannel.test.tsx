/**
 * SocialChannel.test.tsx
 * ---------------------------------------------------------------------------
 * Integration wiring for the Wave-S2 Social channel (`SocialChannel`) — the
 * composition App.tsx mounts as the shell's default participant channel. The
 * individual pieces (feed, composer, thread view, reply-open affordance) are
 * unit-tested in their own stories; this proves they are WIRED together:
 *
 *  - the composer renders ABOVE the live feed in a full session, and is ABSENT
 *    in a read-only/observer session (COR-015/D1-011 — affordances absent, not
 *    disabled);
 *  - tapping a post's open target opens its flattened thread IN the channel
 *    (Phase-1 local view state, no router), swapping out the feed+composer;
 *  - "Back to feed" returns to the feed.
 *
 * Renders through the REAL `ExerciseContextProvider` + `SessionProvider` (both
 * resolve via the shared axios client's built-in mock adapters, exactly as the
 * shipped `/shell` route does), under a `ShellContextProvider` supplying the
 * mount variant — the same providers App.tsx stacks around the channel. A fixed
 * exercise clock keeps scenario-relative rendering deterministic.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock, type IExerciseClock } from '@/core/clock'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { SocialChannel } from './SocialChannel'

// A scenario "now" just after the seeded Fairhaven arc (posts land 13:15–14:20Z)
// so relative times render as recent — a FIXED instant, never a wall-clock read.
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

function fixedClock(instant: Date): IExerciseClock {
  return { scenarioNow: () => instant }
}

/** First element, guarded — avoids a bare `[0]` (banned by strict index access)
 * and a non-null assertion (banned project-wide, WAVE0-REVIEW #23). */
function first<T>(items: readonly T[]): T {
  const [item] = items
  if (item === undefined) throw new Error('expected at least one element')
  return item
}

function renderChannel(variant: ShellVariant = 'full') {
  setExerciseClock(fixedClock(SCENARIO_NOW))
  // A dedicated client so React Query state never leaks between test cases.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant, scenarioNow: SCENARIO_NOW }
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <ShellContextProvider value={mount}>
            <SocialChannel />
          </ShellContextProvider>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

afterEach(() => {
  resetExerciseClock()
})

describe('SocialChannel — Wave S2 integration wiring', () => {
  it('mounts the composer above the live feed in a full session', async () => {
    renderChannel('full')

    // The feed resolves async (exercise scope + session + personas + posts).
    await waitFor(() =>
      expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0),
    )
    expect(screen.getByTestId('composer')).toBeInTheDocument()
  })

  it('omits the composer for a read-only (observer) session, cards still browse-only (COR-015)', async () => {
    renderChannel('readOnly')

    await waitFor(() =>
      expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0),
    )
    // Composer is ABSENT (not a disabled form) — the affordance is gone.
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()
    // The cards render, but their action row is inert (no interactive buttons).
    const firstActions = first(screen.getAllByTestId('post-actions'))
    expect(within(firstActions).queryAllByRole('button')).toHaveLength(0)
  })

  it('opens a post into its flattened thread and returns via "Back to feed"', async () => {
    const user = userEvent.setup()
    renderChannel('full')

    await waitFor(() =>
      expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0),
    )

    // Tap the first post's open target (wired to onOpenThread by the channel).
    await user.click(first(screen.getAllByTestId('post-open-target')))

    // The thread view replaces the feed + composer; a Back control appears.
    expect(await screen.findByTestId('thread-view')).toBeInTheDocument()
    expect(screen.queryByTestId('composer')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /back to feed/i }))

    // Back to the feed — composer + cards restored, thread gone.
    await waitFor(() => expect(screen.getByTestId('composer')).toBeInTheDocument())
    expect(screen.queryByTestId('thread-view')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0)
  })
})
