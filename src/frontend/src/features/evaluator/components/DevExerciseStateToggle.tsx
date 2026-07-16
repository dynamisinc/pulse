/**
 * features/evaluator/components/DevExerciseStateToggle.tsx
 * ---------------------------------------------------------------------------
 * DEV-only control strip for flipping `exerciseState` / `projector` while
 * building/reviewing this surface — it replaces the reference mockup's DC
 * Tweaks editor now that those are real runtime state (see
 * `EvaluatorStateContext`). Clearly labeled so nobody mistakes it for
 * product UI; TODO(E1): delete this once the real exercise-context/
 * lifecycle API drives `exerciseState` and a projector-mode setting exists
 * in the actual staff shell.
 */

import { Box, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material'
import type { ExerciseState } from '../types'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'

const EXERCISE_STATES: { value: ExerciseState; label: string }[] = [
  { value: 'live-quiet', label: 'live-quiet' },
  { value: 'live-storm', label: 'live-storm' },
  { value: 'hotwash', label: 'hotwash' },
  { value: 'pre-e8', label: 'pre-e8' },
]

export function DevExerciseStateToggle() {
  const { exerciseState, setExerciseStateDev, projector, setProjectorDev } = useEvaluatorState()

  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        alignItems: 'center',
        border: '1px dashed #b26a00',
        bgcolor: '#fffaf0',
        borderRadius: '8px',
        px: 1.5,
        py: 0.75,
        flexWrap: 'wrap',
      }}
    >
      <Typography sx={{ fontSize: 9, fontWeight: 800, letterSpacing: '.1em', color: '#8a5300' }}>
        DEV — EXERCISE STATE
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={exerciseState}
        onChange={(_e, next: ExerciseState | null) => { if (next) setExerciseStateDev(next) }}
      >
        {EXERCISE_STATES.map(s => (
          <ToggleButton key={s.value} value={s.value} sx={{ fontSize: 10.5, textTransform: 'none', px: 1.25 }}>
            {s.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={projector}
        onChange={(_e, next: boolean | null) => { if (next !== null) setProjectorDev(next) }}
      >
        <ToggleButton value={false} sx={{ fontSize: 10.5, textTransform: 'none', px: 1.25 }}>
          screen
        </ToggleButton>
        <ToggleButton value sx={{ fontSize: 10.5, textTransform: 'none', px: 1.25 }}>
          projector
        </ToggleButton>
      </ToggleButtonGroup>
      <Box sx={{ flex: 1 }} />
      <Typography sx={{ fontSize: 10, color: '#8a5300' }}>
        Replaces the mockup's Tweaks panel — TODO(E1): remove once exercise-context drives this
      </Typography>
    </Stack>
  )
}
