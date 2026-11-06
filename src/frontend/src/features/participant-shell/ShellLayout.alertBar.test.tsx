/**
 * features/participant-shell/ShellLayout.alertBar.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation story 11 (#707), "Persists across channels": the alert
 * bar is mounted ONCE, by the shell, above whichever channel is routed in. As
 * the participant moves news → weather → news, the SAME bar element stays
 * mounted and visible above each, and no channel renders a bar of its own.
 *
 * The real shell stack runs on its mock seams; only `useAlerts` is mocked so
 * an alert is active (its live path is `AlertBar.live.test.tsx`'s concern).
 */
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Link, Route, Routes } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ShellLayout } from './ShellLayout'
import type { Alert } from './components/AlertBar/alertTypes'

const ACTIVE: readonly Alert[] = [
  {
    id: 'flood-watch',
    severity: 'advisory',
    message: 'Flood Watch for the river district until 9 PM',
    scenarioTime: '2026-12-02T13:00:00Z',
    href: '/weather/nws-metro/flood-watch-0410',
  },
]

vi.mock('./components/AlertBar/useAlerts', () => ({ useAlerts: () => ACTIVE }))

function NewsChannel() {
  return (
    <main data-testid="channel-news">
      <h1>Metro Daily</h1>
      <Link to="/weather">Weather</Link>
    </main>
  )
}

function WeatherChannel() {
  return (
    <main data-testid="channel-weather">
      <h1>Weather Service</h1>
      <Link to="/news">News</Link>
    </main>
  )
}

function renderShellWithChannels() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter initialEntries={['/news']}>
      <QueryClientProvider client={queryClient}>
        <ExerciseContextProvider>
          <ShellLayout>
            <Routes>
              <Route path="/news" element={<NewsChannel />} />
              <Route path="/weather" element={<WeatherChannel />} />
            </Routes>
          </ShellLayout>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

describe('ShellLayout — the alert bar persists across channels (PRT-010)', () => {
  it('keeps the SAME bar instance, outside the content region, as channels swap beneath it', async () => {
    renderShellWithChannels()
    await waitFor(() => expect(screen.getByTestId('channel-news')).toBeInTheDocument())

    const bar = screen.getByTestId('pulse-alert-bar')
    const contentRegion = screen.getByTestId('pulse-shell-content-region')
    expect(bar).toHaveAttribute('data-alert-treatment', 'ticker')
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent(ACTIVE[0]?.message ?? '')
    expect(contentRegion).not.toContainElement(bar)

    await userEvent.click(screen.getByRole('link', { name: 'Weather' }))
    await waitFor(() => expect(screen.getByTestId('channel-weather')).toBeInTheDocument())
    expect(screen.queryByTestId('channel-news')).toBeNull()
    expect(screen.getByTestId('pulse-alert-bar')).toBe(bar)
    expect(screen.getAllByTestId('pulse-alert-bar')).toHaveLength(1)
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent(ACTIVE[0]?.message ?? '')

    await userEvent.click(screen.getByRole('link', { name: 'News' }))
    await waitFor(() => expect(screen.getByTestId('channel-news')).toBeInTheDocument())
    expect(screen.getByTestId('pulse-alert-bar')).toBe(bar)
    expect(screen.getAllByTestId('pulse-alert-bar')).toHaveLength(1)
  })
})
