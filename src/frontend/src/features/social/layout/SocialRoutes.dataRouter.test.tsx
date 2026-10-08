/**
 * features/social/layout/SocialRoutes.dataRouter.test.tsx
 * ---------------------------------------------------------------------------
 * The channel under a DATA router (demo-polish F1, L6). The production app mounts
 * routes with `createBrowserRouter` + `<RouterProvider>`; every other suite here uses
 * the plain `<MemoryRouter>`, and the two differ in exactly the places this feature
 * leans on: `useNavigate()` is a *stable* function under a data router (an unstable,
 * location-dependent one under `<MemoryRouter>`), `useLocation().key` comes from the
 * router's own history, and a descendant `<Routes>` coexists with the router's
 * `DataRouterStateContext`. So the behaviors the app actually depends on are repeated
 * here against `createMemoryRouter`:
 *   - the first-render `/` -> `/home` redirect (React Router drops a `navigate()` made
 *     before the owning component's layout effect -- `SocialRedirect` uses a passive
 *     effect for that reason);
 *   - staff-like and unknown paths landing on Home (COR-004);
 *   - pushing a page and coming Back; a cold deep link's Back falling back to Home
 *     (a replace, not a push);
 *   - the sign-out redirect leaving the channel for the sibling `/login` route.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import {
  ShellContextProvider,
  type ShellMountProps,
} from '@/features/participant-shell/mountContract'
import { SocialChannel } from '../SocialChannel'
import { SCENARIO_NOW } from './renderChannel.testUtils'

const endSessionMock = vi.hoisted(() => vi.fn<() => Promise<void>>())
vi.mock('@/core/auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth')>()),
  endSession: endSessionMock,
}))

function renderUnderDataRouter(initialPath: string) {
  endSessionMock.mockResolvedValue(undefined)
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const mount: ShellMountProps = { variant: 'full', scenarioNow: SCENARIO_NOW }
  // The app's shape (`createRoleAwareRoutes`): `/login` is a sibling of the `*` catch-all.
  const router = createMemoryRouter(
    [
      { path: '/login', element: <p data-testid="login-page">Sign in</p> },
      {
        path: '*',
        element: (
          <ExerciseContextProvider>
            <SessionProvider>
              <ShellContextProvider value={mount}>
                <SocialChannel />
              </ShellContextProvider>
            </SessionProvider>
          </ExerciseContextProvider>
        ),
      },
    ],
    { initialEntries: [initialPath] },
  )
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
  return router
}

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  endSessionMock.mockReset()
})

describe('SocialChannel under a data router (the production shape)', () => {
  it('redirects / to /home on the very first render', async () => {
    const router = renderUnderDataRouter('/')
    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
  })

  it.each(['/staff/console', '/staff', '/nonsense/a/b/c'])(
    'lands %s on Home (COR-004)',
    async path => {
      const router = renderUnderDataRouter(path)
      await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
      expect(await screen.findByTestId('social-feed-region')).toBeVisible()
    },
  )

  it('pushes Explore and comes Back to the same mounted Home', async () => {
    const user = userEvent.setup()
    const router = renderUnderDataRouter('/home')
    await waitFor(() => expect(screen.getAllByTestId('post-card').length).toBeGreaterThan(0))
    const firstCard = screen.getAllByTestId('post-card')[0]

    await user.click(screen.getByRole('link', { name: 'Explore' }))
    await screen.findByTestId('explore-page')
    expect(router.state.location.pathname).toBe('/explore')

    await router.navigate(-1)
    await waitFor(() => expect(screen.getByTestId('social-feed-region')).toBeVisible())
    expect(router.state.location.pathname).toBe('/home')
    expect(screen.getAllByTestId('post-card')[0]).toBe(firstCard)
  })

  it('Back on a cold deep link replaces with /home instead of leaving the app', async () => {
    const user = userEvent.setup()
    const router = renderUnderDataRouter('/FulcoEM')
    await screen.findByTestId('social-profile-region')

    await user.click(screen.getByRole('button', { name: /^back$/i }))

    await waitFor(() => expect(router.state.location.pathname).toBe('/home'))
    expect(await screen.findByTestId('social-feed-region')).toBeVisible()
    // A REPLACE: the cold entry is gone, not stacked under Home.
    expect(router.state.historyAction).toBe('REPLACE')
  })

  it('Sign out leaves the channel for the sibling /login route', async () => {
    const user = userEvent.setup()
    const router = renderUnderDataRouter('/home')
    const card = await screen.findByTestId('account-card')
    await user.click(within(card).getByRole('button', { name: 'Sign out' }))

    expect(endSessionMock).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('login-page')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.queryByTestId('social-channel')).not.toBeInTheDocument()
  })
})
