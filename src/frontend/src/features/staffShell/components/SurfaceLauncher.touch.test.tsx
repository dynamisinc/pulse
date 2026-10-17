/**
 * features/staffShell/components/SurfaceLauncher.touch.test.tsx
 * ---------------------------------------------------------------------------
 * Story 13 (mobile-tablet) — the two INTERACTIVE header controls that live in their own components
 * (the surface launcher lockup and the exercise switcher badge) are >= 44px tall as real layout
 * space under `@media (pointer: coarse)` (CSS contract), and the tablet-portrait tightening
 * (lockup tracking, wrapping exercise name) is a width media rule, not a clip.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { faListCheck, faSliders } from '@fortawesome/free-solid-svg-icons'
import { cobraTheme } from '@/theme/cobraTheme'
import { useExerciseContext } from '@/core/exerciseContext'
import { getStaffAssignments } from '@/features/staff/services/staffAssignmentsService'
import type { StaffRouteRegistry } from '@/features/app-shell'
import { SurfaceLauncher } from './SurfaceLauncher'
import { ExerciseIdentityBadge } from './ExerciseIdentityBadge'
import { mediaRuleDeclarations } from '../tabletTestUtils'
import { STAFF_TOUCH_TARGET_PX } from '../staffShellTokens'

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: vi.fn(),
  useExerciseScopeRefresh: () => vi.fn(),
}))
vi.mock('@/features/staff/services/staffAssignmentsService', async importOriginal => {
  const actual =
    await importOriginal<typeof import('@/features/staff/services/staffAssignmentsService')>()
  return { ...actual, getStaffAssignments: vi.fn(), setActiveExercise: vi.fn() }
})

const REGISTRY: StaffRouteRegistry = [
  {
    id: 'controller-console',
    path: '/staff/console',
    label: 'Controller Console',
    icon: faSliders,
    element: <div />,
    allowedRoles: ['controller'],
    group: 'conduct',
    description: 'Drive the simulated world.',
  },
  {
    id: 'inject-queue',
    path: '/staff/inject-queue',
    label: 'Inject Queue',
    icon: faListCheck,
    element: <div />,
    allowedRoles: ['controller'],
    group: 'plan',
    description: 'Manage the inject schedule.',
  },
]

function Wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return (
    <QueryClientProvider client={client}>
      <ThemeProvider theme={cobraTheme}>
        <MemoryRouter>{children}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

describe('interactive header controls — touch targets', () => {
  it('the surface launcher lockup button is >= 44px tall under a coarse pointer', () => {
    render(
      <SurfaceLauncher surfaceName="Controller Console" registry={REGISTRY} role="controller" />,
      { wrapper: Wrapper },
    )
    const lockup = screen.getByTestId('staff-header-lockup')
    expect(lockup.tagName).toBe('BUTTON')
    expect(mediaRuleDeclarations(lockup, 'pointer: coarse')['min-height']).toBe(
      `${STAFF_TOUCH_TARGET_PX}px`,
    )
  })

  it('the exercise-switcher badge button is >= 44px tall under a coarse pointer, and its name wraps (never clips) in portrait', async () => {
    vi.mocked(useExerciseContext).mockReturnValue({
      exerciseId: 'ex-alpha',
      exerciseName: 'Alpha Exercise With A Very Long Name',
      timeZone: 'UTC',
      status: 'live',
    })
    vi.mocked(getStaffAssignments).mockResolvedValue([
      { exerciseId: 'ex-alpha', exerciseName: 'Alpha', role: 'controller' },
      { exerciseId: 'ex-bravo', exerciseName: 'Bravo', role: 'evaluator' },
    ])
    render(<ExerciseIdentityBadge role="CONTROLLER" cell="SIMCELL-1" />, { wrapper: Wrapper })
    const badge = await screen.findByRole('button', { name: /Switch exercise/ })
    await waitFor(() => expect(badge).toBeInTheDocument())
    expect(mediaRuleDeclarations(badge, 'pointer: coarse')['min-height']).toBe(
      `${STAFF_TOUCH_TARGET_PX}px`,
    )
    const name = screen.getByText('Alpha Exercise With A Very Long Name')
    expect(mediaRuleDeclarations(name, 'max-width')['white-space']).toBe('normal')
  })
})
