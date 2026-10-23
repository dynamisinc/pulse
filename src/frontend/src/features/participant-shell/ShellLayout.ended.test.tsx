/**
 * Wiring: an overlay GET body with `ended: true` reaches the real ShellLayout, which shows the
 * ended banner and flips the write seam (`useCanWrite`) off for the mounted channel.
 */
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider } from '@/core/auth'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { api } from '@/core/services/api'
import { ShellLayout } from './ShellLayout'
import { useCanWrite } from './writeGate'

function CanWriteProbe() {
  return <output data-testid="can-write">{String(useCanWrite())}</output>
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellLayout><CanWriteProbe /></ShellLayout>
          </SessionProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('ShellLayout with an ended exercise', () => {
  it('shows the banner and disables writes when the overlay says ended', async () => {
    const realGet = api.get.bind(api)
    vi.spyOn(api, 'get').mockImplementation((url, config) =>
      url === '/overlay-state'
        ? Promise.resolve({
          data: { state: 'none', register: 'in-fiction', message: '', ended: true },
        } as never)
        : realGet(url, config))

    mount()

    expect(await screen.findByTestId('pulse-exercise-ended-banner')).toBeInTheDocument()
    expect(await screen.findByTestId('can-write')).toHaveTextContent('false')
    expect(screen.getByTestId('pulse-exercise-ended-announcer')).toHaveTextContent(
      'This exercise has ended.',
    )
  })

  it('shows no banner and allows writes for a live exercise', async () => {
    mount()
    expect(await screen.findByTestId('can-write')).toHaveTextContent('true')
    expect(screen.queryByTestId('pulse-exercise-ended-banner')).not.toBeInTheDocument()
  })
})
