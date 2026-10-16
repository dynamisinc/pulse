/**
 * features/exerciseLifecycleAdmin/roleGating.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (issue #573): the exercise-management surface hides the controls
 * the server now refuses (403), per role, through the real `ExerciseManagementPage`:
 *   - Create exercise: org admin only (a planner and a controller get no form);
 *   - Rename and Archive on an org row: org admin and planner; hidden for a controller.
 * The service is mocked, and the session is the role-selectable stub
 * (`core/auth/rolePermissions.testUtils`).
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import type { SessionRole } from '@/core/auth'
import { resetStubSession, setStubSession } from '@/core/auth/rolePermissions.testUtils'
import { ExerciseManagementPage } from './pages/ExerciseManagementPage'
import { getOrgExercises } from './services/orgExercisesService'
import type { OrgExercise } from './types'

vi.mock('@/core/auth/session', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/session')>()),
  useOptionalSession: (await import('@/core/auth/rolePermissions.testUtils')).stubbedSession,
}))

vi.mock('./services/orgExercisesService', async importOriginal => ({
  ...(await importOriginal<typeof import('./services/orgExercisesService')>()),
  getOrgExercises: vi.fn(),
}))

vi.mock('@/core/exerciseContext', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/exerciseContext')>()),
  useExerciseContext: () => ({
    exerciseId: 'ex-l',
    exerciseName: 'Active Exercise',
    timeZone: 'UTC',
    status: 'live',
  }),
  useExerciseScopeRefresh: () => vi.fn(),
}))

const COMPLETED: OrgExercise = { exerciseId: 'ex-c', name: 'Coastal Surge', status: 'completed' }
const LIVE: OrgExercise = { exerciseId: 'ex-l', name: 'Harbor Live', status: 'live' }

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={cobraTheme}>{children}</ThemeProvider>
      </QueryClientProvider>
    )
  }
  return render(<ExerciseManagementPage />, { wrapper: Wrapper })
}

beforeEach(() => {
  resetStubSession()
  vi.mocked(getOrgExercises).mockResolvedValue([COMPLETED, LIVE])
})

/** role -> [sees create form, sees Rename, sees Archive] */
const MATRIX: ReadonlyArray<readonly [SessionRole, boolean, boolean, boolean]> = [
  ['orgAdmin', true, true, true],
  ['planner', false, true, true],
  ['controller', false, false, false],
]

describe('exercise management is gated per the role matrix', () => {
  for (const [role, create, rename, archive] of MATRIX) {
    it(`${role}: create form ${create ? 'shown' : 'hidden'}, Rename ${rename ? 'shown' : 'hidden'}, Archive ${archive ? 'shown' : 'hidden'}`, async () => {
      setStubSession({ role, isLead: false })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('org-exercise-table')).toBeInTheDocument())

      expect(screen.queryByTestId('create-exercise-form') !== null).toBe(create)
      expect(screen.queryByRole('button', { name: 'Rename Coastal Surge' }) !== null).toBe(rename)
      expect(screen.queryByRole('button', { name: 'Archive Coastal Surge' }) !== null).toBe(archive)
    })
  }

  it('a planner keeps the visible "End the exercise first" reason on a live row', async () => {
    setStubSession({ role: 'planner', isLead: false })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('org-exercise-table')).toBeInTheDocument())
    expect(screen.getByTestId('org-exercise-archive-reason-ex-l')).toHaveTextContent(
      'End the exercise first',
    )
  })

  it('the empty state never points a non-creator at a form that is not there', async () => {
    vi.mocked(getOrgExercises).mockResolvedValue([])
    setStubSession({ role: 'planner', isLead: false })
    renderPage()
    await waitFor(() => expect(screen.getByTestId('org-exercises-empty')).toBeInTheDocument())
    expect(screen.getByTestId('org-exercises-empty')).toHaveTextContent(
      'Only an organization administrator can create an exercise.',
    )
    expect(screen.getByTestId('org-exercises-empty')).not.toHaveTextContent('form above')
  })
})
