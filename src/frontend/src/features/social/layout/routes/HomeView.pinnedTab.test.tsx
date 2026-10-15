/**
 * features/social/layout/routes/HomeView.pinnedTab.test.tsx
 * ---------------------------------------------------------------------------
 * The Home tablist with the third **Pinned** tab (demo-feedback story 07; NFR-001,
 * COR-015, D1-011), through the real channel and the mock seams:
 *
 *  - three `role="tab"`s in order All Posts / Following / Pinned, roving tabindex,
 *    `aria-controls` bound to their panels;
 *  - keyboard handling generalised to N tabs: Right / Left move and WRAP, Home / End go
 *    to the first / last, and focus follows the selection;
 *  - Pinned is LAZY-mounted like Following (first switch), then kept mounted and hidden;
 *  - a view-only (observer) mount sees All Posts only: no tablist, no Pinned panel.
 *  The no-persona axis is `SocialChannel.feedSwitch.noPersona.test.tsx` (no tablist at
 *  all there, so no Pinned tab either).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { setMockFollowingForTests } from '../../services/feedService'
import { postStore } from '../../services/postStore'
import { removedPosts } from '../../services/removedPosts'
import { resetMockPins } from '../../pinned/mockPins'
import { pinState } from '../../pinned/pinEvents'
import { SocialChannel } from '../../SocialChannel'

const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

async function renderChannel(variant: ShellVariant = 'full') {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant, scenarioNow: SCENARIO_NOW }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home']}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellContextProvider value={mount}>
              <SocialChannel />
            </ShellContextProvider>
          </SessionProvider>
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
  await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
}

function tab(name: string) {
  return screen.getByRole('tab', { name })
}

beforeEach(() => {
  resetTelemetryBuffer()
  setMockFollowingForTests(undefined)
  postStore.resetForTests()
  removedPosts.reset()
  // The default mock seed: the official advisory pinned for everyone.
  resetMockPins()
  pinState.reset()
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  resetMockPins()
  pinState.reset()
})

describe('HomeView — three tabs (story 07)', () => {
  it('renders All Posts, Following, Pinned as tabs, in that order, All Posts selected', async () => {
    await renderChannel()

    const tablist = screen.getByRole('tablist', { name: 'Feed' })
    expect(within(tablist).getAllByRole('tab').map(t => t.textContent)).toEqual([
      'All Posts',
      'Following',
      'Pinned',
    ])
    expect(tab('Pinned')).toHaveAttribute('aria-selected', 'false')
    expect(tab('Pinned')).toHaveAttribute('tabindex', '-1')
    expect(tab('Pinned')).toHaveAttribute('aria-controls', 'social-feed-panel-pinned')
    // Lazy: nothing is mounted for Pinned until the reader opens it.
    expect(screen.queryByTestId('social-feed-panel-pinned')).not.toBeInTheDocument()
  })

  it('opens the Pinned panel on click, lists the pinned feed, and keeps it mounted after', async () => {
    const user = userEvent.setup()
    await renderChannel()

    await user.click(tab('Pinned'))

    const pinnedPanel = await screen.findByTestId('social-feed-panel-pinned')
    expect(pinnedPanel).toHaveAttribute('role', 'tabpanel')
    expect(pinnedPanel).toHaveAttribute('aria-labelledby', 'social-feed-tab-pinned')
    expect(tab('Pinned')).toHaveAttribute('aria-selected', 'true')
    await waitFor(() =>
      expect(within(pinnedPanel).getAllByTestId('post-card').map(c => c.dataset.postId))
        .toEqual(['post-seed-fw-advisory']))
    expect(within(pinnedPanel).getByTestId('pinned-for-all-label')).toHaveTextContent('Pinned')
    expect(screen.getByTestId('social-feed-panel-all')).not.toBeVisible()

    await user.click(tab('All Posts'))
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-all')).toBeVisible())
    // Hidden, not unmounted.
    expect(screen.getByTestId('social-feed-panel-pinned')).toBeInTheDocument()
    expect(screen.getByTestId('social-feed-panel-pinned')).not.toBeVisible()
  })

  it('moves with Right / Left across all three tabs, wrapping, with focus following', async () => {
    const user = userEvent.setup()
    await renderChannel()

    tab('All Posts').focus()
    await user.keyboard('{ArrowRight}')
    expect(tab('Following')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Following')).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(tab('Pinned')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Pinned')).toHaveFocus()
    expect(tab('Pinned')).toHaveAttribute('tabindex', '0')
    await waitFor(() => expect(screen.getByTestId('social-feed-panel-pinned')).toBeVisible())

    // Wraps forward to the first tab ...
    await user.keyboard('{ArrowRight}')
    expect(tab('All Posts')).toHaveAttribute('aria-selected', 'true')
    expect(tab('All Posts')).toHaveFocus()

    // ... and backward to the last.
    await user.keyboard('{ArrowLeft}')
    expect(tab('Pinned')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Pinned')).toHaveFocus()
  })

  it('Home and End go to the first and last tab', async () => {
    const user = userEvent.setup()
    await renderChannel()

    tab('All Posts').focus()
    await user.keyboard('{End}')
    expect(tab('Pinned')).toHaveAttribute('aria-selected', 'true')
    expect(tab('Pinned')).toHaveFocus()

    await user.keyboard('{Home}')
    expect(tab('All Posts')).toHaveAttribute('aria-selected', 'true')
    expect(tab('All Posts')).toHaveFocus()
    // Only the selected tab is in the Tab order.
    expect(tab('Following')).toHaveAttribute('tabindex', '-1')
    expect(tab('Pinned')).toHaveAttribute('tabindex', '-1')
  })

  it('offers a view-only (observer) mount no Pinned tab: All Posts only (COR-015)', async () => {
    await renderChannel('readOnly')

    expect(screen.queryByRole('tablist', { name: 'Feed' })).not.toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Pinned' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('social-feed-panel-pinned')).not.toBeInTheDocument()
    expect(screen.queryByTestId('pinned-feed')).not.toBeInTheDocument()
    expect(screen.getByTestId('social-feed-panel-all')).toBeVisible()
  })
})
