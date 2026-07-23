/**
 * features/app-shell/routes.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the route-table contribution (story 01, plus the login-04 route
 * wiring): the shape the orchestrator wires into `App.tsx`, the world-neutral
 * provider structure it establishes above `RoleAwareEntry`, the role-only
 * catch-all (typed path is ignored, COR-004), and the two real, pre-auth login
 * routes (`/login` -> `ParticipantSignInPage`, `/staff/login` ->
 * `StaffSignInPage`) that replaced the temporary `SignInFallback` placeholder.
 *
 * The core providers are mocked to pass-through so the async resolve isn't
 * exercised here (that is covered by the seams' own tests); the identity hooks
 * are mocked, and the two composed cross-story seams are injected as stubs
 * (IoC — see RoleAwareEntry.test.tsx). Both login pages resolve their exercise
 * context via `useQuery`, so this file wraps every render in a
 * `QueryClientProvider`; `@/core/services/api` is mocked so that resolution
 * never touches a real network call (never a live axios sink — the repo's own
 * worker-teardown footgun). `react-router-dom` is deliberately left UNMOCKED
 * here (unlike the login pages' own unit tests) — this file wants the real
 * `<Link to={STAFF_LOGIN_PATH}>` to actually navigate within the same
 * `createMemoryRouter`, proving the two routes are genuinely wired together.
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { Session } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { createRoleAwareRoutes } from './routes'
import { LOGIN_PATH, STAFF_LOGIN_PATH } from './constants'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

vi.mock('@/core/auth', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/auth')>()
  return {
    ...actual,
    SessionProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useSession: vi.fn(),
    useRole: vi.fn(),
  }
})
vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    ExerciseContextProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
    useExerciseContext: vi.fn(),
  }
})

const StubGuard: ComponentType<{ children: ReactNode }> = ({ children }) => (
  <div data-testid="participant-guard">{children}</div>
)

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-mock-0001',
  exerciseName: 'Mock Exercise',
  timeZone: 'UTC',
  status: 'active',
}

const SESSION: Session = {
  exerciseId: 'ex-mock-0001',
  accountId: 'acct-test',
  role: 'participant',
  actingHumanId: 'human-test',
  isReadOnly: false,
  expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
}

const SURFACES = {
  participantSurface: <div data-testid="participant-surface" />,
  staffSurfaces: { controller: <div data-testid="staff-surface-controller" /> },
  participantGuard: StubGuard,
  staffSwitcher: <div data-testid="exercise-switcher" />,
}

function renderAt(initialEntry: string) {
  const router = createMemoryRouter(createRoleAwareRoutes(SURFACES), {
    initialEntries: [initialEntry],
  })
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createRoleAwareRoutes', () => {
  it('replaces the flat routes with the two login routes + a role-aware catch-all', () => {
    const routes = createRoleAwareRoutes(SURFACES)
    expect(routes.map(r => r.path)).toEqual([LOGIN_PATH, STAFF_LOGIN_PATH, '*'])
  })

  it('mounts RoleAwareEntry under the catch-all and routes on ROLE, not the typed path', () => {
    vi.mocked(useSession).mockReturnValue(SESSION)
    vi.mocked(useRole).mockReturnValue('participant')
    vi.mocked(useExerciseContext).mockReturnValue(SCOPE)

    // A participant typing a "staff" URL still lands on the participant surface.
    renderAt('/console')

    expect(screen.getByTestId('participant-guard')).toBeInTheDocument()
    expect(screen.getByTestId('participant-surface')).toBeInTheDocument()
    expect(screen.queryByTestId('staff-surface-controller')).not.toBeInTheDocument()
  })

  it('serves the real ParticipantSignInPage at /login — SignInFallback no longer renders', () => {
    renderAt(LOGIN_PATH)

    // The real page's form, present synchronously regardless of the
    // exercise-context lookup's outcome (ParticipantSignInPage.tsx AC5).
    expect(screen.getByLabelText('Handle')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
    // The deleted placeholder's own copy must never appear.
    expect(screen.queryByText(/sign-in required/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/your session could not be resolved/i)).not.toBeInTheDocument()
  })

  it('serves the real StaffSignInPage at /staff/login', () => {
    renderAt(STAFF_LOGIN_PATH)

    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
    expect(screen.getByTestId('staff-sign-in-form')).toBeInTheDocument()
  })

  it('links from the participant sign-in page to the staff sign-in page (the one cross-world reference)', async () => {
    const user = userEvent.setup()
    renderAt(LOGIN_PATH)

    const staffLink = screen.getByRole('link', { name: /sign in here/i })
    expect(staffLink.tagName).toBe('A')

    await user.click(staffLink)

    expect(screen.getByRole('heading', { name: 'Staff sign-in' })).toBeInTheDocument()
  })
})
