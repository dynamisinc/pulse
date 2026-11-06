/**
 * features/social/layout/NavRail.exerciseName.test.tsx
 * ---------------------------------------------------------------------------
 * The participant-facing exercise name in the social brand header (nav rail
 * logo area; exercise-build-golive story 09): rendered under the brand logo when
 * the resolved scope carries one, brand-only when it is null or there is no
 * scope. No placeholder, and never an internal-name fallback (the scope has none).
 */
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useOptionalExerciseContext } from '@/core/exerciseContext'
import type { ExerciseScope } from '@/core/exerciseContext'
import { NavRail } from './NavRail'
import { MemorySocialNavigationProvider } from './SocialNavigationProvider'

vi.mock('@/core/exerciseContext', () => ({
  useOptionalExerciseContext: vi.fn(),
}))

const SCOPE: ExerciseScope = {
  exerciseId: 'ex-1',
  exerciseName: 'Coastal Surge',
  timeZone: 'UTC',
  status: 'live',
}

function renderRail() {
  render(
    <MemorySocialNavigationProvider initialEntries={['/home']}>
      <NavRail self={undefined} showAccount={false} />
    </MemorySocialNavigationProvider>,
  )
}

beforeEach(() => {
  vi.mocked(useOptionalExerciseContext).mockReset()
})

describe('NavRail - participant-facing exercise name', () => {
  it('shows the name next to the brand logo when set', () => {
    vi.mocked(useOptionalExerciseContext).mockReturnValue(SCOPE)
    renderRail()

    expect(screen.getByTestId('nav-rail-exercise-name')).toHaveTextContent('Coastal Surge')
    expect(screen.getByTestId('pulse-logo')).toBeInTheDocument()
  })

  it('is brand-only (no element, no placeholder) when the name is null', () => {
    vi.mocked(useOptionalExerciseContext).mockReturnValue({ ...SCOPE, exerciseName: null })
    renderRail()

    expect(screen.queryByTestId('nav-rail-exercise-name')).not.toBeInTheDocument()
    expect(screen.getByTestId('pulse-logo')).toBeInTheDocument()
  })

  it('is brand-only when there is no exercise scope at all', () => {
    vi.mocked(useOptionalExerciseContext).mockReturnValue(undefined)
    renderRail()

    expect(screen.queryByTestId('nav-rail-exercise-name')).not.toBeInTheDocument()
  })
})
