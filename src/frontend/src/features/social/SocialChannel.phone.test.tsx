/**
 * features/social/SocialChannel.phone.test.tsx
 * ---------------------------------------------------------------------------
 * The social frame at phone and desktop widths inside the REAL `ShellLayout`
 * (mobile-tablet story 02, WR-002). `matchMedia` is stubbed to answer PHONE_QUERY.
 *
 * Phone: exactly one `nav[aria-label="Primary"]` (the bottom tab bar), no rail, and
 * exactly ONE Sign out -- the shell's own row (the rail's account card is not rendered, so
 * the channel does not claim the shell's account control).
 * Desktop (no phone match): the rail is the one Primary nav and the account card's Sign out
 * is the one Sign out; no tab bar.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellLayout } from '@/features/participant-shell/ShellLayout'
import { SocialChannel } from './SocialChannel'
import { PHONE_QUERY } from './layout/frameMetrics'
import { SCENARIO_NOW } from './layout/renderChannel.testUtils'

function stubMatchMedia(phone: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: phone && query === PHONE_QUERY,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }))
}

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

afterEach(() => {
  vi.unstubAllGlobals()
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('social frame on a phone (WR-002)', () => {
  it('renders the bottom tab bar as the only Primary nav, no rail, and exactly one Sign out', async () => {
    stubMatchMedia(true)
    renderInShell(<SocialChannel />)
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const navs = screen.getAllByRole('navigation', { name: 'Primary' })
    expect(navs).toHaveLength(1)
    expect(navs[0]).toBe(screen.getByTestId('bottom-tab-bar'))
    expect(screen.queryByTestId('nav-rail')).not.toBeInTheDocument()
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()

    const signOuts = screen.getAllByRole('button', { name: 'Sign out' })
    expect(signOuts).toHaveLength(1)
    // It is the shell's row, outside the channel.
    expect(screen.getByTestId('pulse-shell-content-region').contains(signOuts[0] ?? null)).toBe(false)
  })
})

describe('social frame on tablet / desktop (WR-002 mirror)', () => {
  it('renders the rail as the only Primary nav and the account card holds the one Sign out', async () => {
    stubMatchMedia(false)
    renderInShell(<SocialChannel />)
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))

    const navs = screen.getAllByRole('navigation', { name: 'Primary' })
    expect(navs).toHaveLength(1)
    expect(navs[0]).toBe(screen.getByTestId('nav-rail'))
    expect(screen.queryByTestId('bottom-tab-bar')).not.toBeInTheDocument()

    const signOuts = await screen.findAllByRole('button', { name: 'Sign out' })
    expect(signOuts).toHaveLength(1)
    expect(within(screen.getByTestId('account-card')).getByRole('button', { name: 'Sign out' }))
      .toBe(signOuts[0])
  })
})
