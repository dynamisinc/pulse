/**
 * features/app-shell/routes.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the route-table contribution (story 01): the shape the orchestrator
 * wires into `App.tsx`, the world-neutral provider structure it establishes
 * above `RoleAwareEntry`, the role-only catch-all (typed path is ignored,
 * COR-004), and the temporary fail-closed `/login` placeholder.
 *
 * The core providers are mocked to pass-through so the async resolve isn't
 * exercised here (that is covered by the seams' own tests); the identity hooks
 * are mocked, and the two composed cross-story seams are injected as stubs
 * (IoC — see RoleAwareEntry.test.tsx).
 */
import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { useSession, useRole } from '@/core/auth'
import type { Session } from '@/core/auth'
import { useExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { createRoleAwareRoutes } from './routes'
import { LOGIN_PATH } from './constants'

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
  return render(<RouterProvider router={router} />)
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('createRoleAwareRoutes', () => {
  it('replaces the flat routes with a /login placeholder + a role-aware catch-all', () => {
    const routes = createRoleAwareRoutes(SURFACES)
    expect(routes.map(r => r.path)).toEqual([LOGIN_PATH, '*'])
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

  it('serves the fail-closed /login placeholder', () => {
    renderAt(LOGIN_PATH)

    expect(screen.getByRole('heading', { name: /sign-in required/i })).toBeInTheDocument()
  })
})
