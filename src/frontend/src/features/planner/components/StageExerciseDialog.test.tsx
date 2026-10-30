/**
 * features/planner/components/StageExerciseDialog.test.tsx
 * ---------------------------------------------------------------------------
 * exercise-build-golive story 09: with no internal name resolved yet the stage confirm
 * uses a generic title, and never a participant-facing or invented name.
 */
import { render, screen } from '@testing-library/react'
import { ThemeProvider } from '@mui/material/styles'
import { describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { StageExerciseDialog } from './StageExerciseDialog'

function renderDialog(exerciseName: string | null) {
  render(
    <ThemeProvider theme={cobraTheme}>
      <StageExerciseDialog
        exerciseName={exerciseName}
        openBlocking={0}
        pending={false}
        error={undefined}
        blocking={undefined}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />
    </ThemeProvider>,
  )
}

describe('StageExerciseDialog title', () => {
  it('names the exercise when the internal name is known', () => {
    renderDialog('Harbor Storm')
    expect(screen.getByRole('dialog', { name: 'Stage Harbor Storm?' })).toBeInTheDocument()
  })

  it('uses a generic title while the internal name is unknown', () => {
    renderDialog(null)
    expect(screen.getByRole('dialog', { name: 'Stage this exercise?' })).toBeInTheDocument()
  })
})
