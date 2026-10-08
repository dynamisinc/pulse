/**
 * features/social/SocialChannel.shell.test.tsx
 * ---------------------------------------------------------------------------
 * The channel INSIDE the real participant shell (demo-polish F1, M1 + M2) -- the one
 * composition the other suites, which mount `SocialChannel` bare, cannot see:
 *
 *  - M2 / L5: exactly ONE "Sign out" on the social channel. The shell's generic
 *    `ParticipantSignOutControl` row steps aside while the channel's account card
 *    is on screen (`useClaimShellAccountControl`); on a channel with no account
 *    control of its own the shell row is still there.
 *  - M1: the shell's alert bar publishes `--pulse-alert-height` on `:root` for the
 *    channel's sticky chrome to offset by, and clears it when the shell goes.
 *
 * Real `ShellLayout` (chrome, alert bar, channel nav, overlay layer) over the shipped
 * mock seams, as `ShellLayout.test.tsx` does, with the channel's own providers.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellLayout } from '@/features/participant-shell/ShellLayout'
import { SocialChannel } from './SocialChannel'
import { SCENARIO_NOW } from './layout/renderChannel.testUtils'

function renderInShell(channel: ReactNode) {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home']}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellLayout>{channel}</ShellLayout>
          </SessionProvider>
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const alertHeightVar = () => document.documentElement.style.getPropertyValue('--pulse-alert-height')

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('one Sign out on the social channel (M2 / L5)', () => {
  it('shows exactly one, and it is the account card\'s', async () => {
    renderInShell(<SocialChannel />)
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const signOuts = await screen.findAllByRole('button', { name: 'Sign out' })
    expect(signOuts).toHaveLength(1)
    expect(within(screen.getByTestId('account-card')).getByRole('button', { name: 'Sign out' }))
      .toBe(signOuts[0])
  })

  it('does not keep a second Sign out row above the channel in the shell', async () => {
    renderInShell(<SocialChannel />)
    await screen.findByTestId('account-card')
    // The shell's row would be a sibling of the content region, outside the channel.
    const region = screen.getByTestId('pulse-shell-content-region')
    const outside = screen
      .queryAllByRole('button', { name: 'Sign out' })
      .filter(button => !region.contains(button))
    expect(outside).toHaveLength(0)
  })

  it('a channel with no account control of its own keeps the shell\'s row', async () => {
    renderInShell(<p data-testid="other-channel">another channel</p>)
    await screen.findByTestId('other-channel')

    const signOuts = screen.getAllByRole('button', { name: 'Sign out' })
    expect(signOuts).toHaveLength(1)
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()
  })
})

describe('the shell publishes the alert height for the channel (M1)', () => {
  it('sets --pulse-alert-height while the shell is mounted and clears it on unmount', async () => {
    const { unmount } = renderInShell(<SocialChannel />)
    await screen.findByTestId('account-card')
    // jsdom has no layout, so there is no alert and the bar measures 0: the var must
    // exist (so `calc(... + var(--pulse-alert-height, 0px))` is always well-formed).
    expect(alertHeightVar()).toBe('0px')

    unmount()

    expect(alertHeightVar()).toBe('')
  })
})
