/**
 * features/social/SocialChannel.signOutWhileLoading.test.tsx
 * ---------------------------------------------------------------------------
 * Wave 2 Gate-2 low. The channel's account card is WITHHELD while a persona-bound
 * session's cast is still loading (`awaitingSelf` -- it never flashes a bare card). The
 * channel used to CLAIM the shell's account control regardless, so the shell dropped its
 * Sign out row AND the card was not there: during a slow or hung cast load there was no
 * Sign out anywhere. The claim now tracks the card exactly:
 *
 *  - cast loading   -> no account card, the SHELL's Sign out row is present (exactly one);
 *  - cast resolved  -> the account card appears, the shell's row steps aside (exactly one).
 *
 * `usePersonas` is wrapped so the test can hold the cast "loading" and then release it;
 * it always calls the real hook (stable hook order) and overrides only the result.
 */
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ShellLayout } from '@/features/participant-shell/ShellLayout'
import { SocialChannel } from './SocialChannel'
import { SCENARIO_NOW } from './layout/renderChannel.testUtils'

const hold = vi.hoisted(() => ({ cast: false }))

vi.mock('@/features/personas', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/personas')>()
  return {
    ...actual,
    usePersonas: () => {
      const real = actual.usePersonas()
      return hold.cast ? { ...real, personas: [], loading: true, error: undefined } : real
    },
  }
})

function tree() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/home']}>
        <ExerciseContextProvider>
          <SessionProvider>
            <ShellLayout><SocialChannel /></ShellLayout>
          </SessionProvider>
        </ExerciseContextProvider>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
})

afterEach(() => {
  hold.cast = false
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('Sign out while the persona cast loads', () => {
  it('keeps the shell\'s Sign out row until the account card is on screen', async () => {
    hold.cast = true
    const { rerender } = render(tree())

    // The card is withheld, so the channel makes no claim: the shell's row is the one Sign out.
    const region = await screen.findByTestId('pulse-shell-content-region')
    expect(screen.queryByTestId('account-card')).not.toBeInTheDocument()
    const held = screen.getAllByRole('button', { name: 'Sign out' })
    expect(held).toHaveLength(1)
    expect(region.contains(held[0] ?? null)).toBe(false)

    // The cast resolves -> the card appears and the shell's row steps aside.
    hold.cast = false
    rerender(tree())
    const card = await screen.findByTestId('account-card')
    const resolved = screen.getAllByRole('button', { name: 'Sign out' })
    expect(resolved).toHaveLength(1)
    expect(within(card).getByRole('button', { name: 'Sign out' })).toBe(resolved[0])
  })
})
