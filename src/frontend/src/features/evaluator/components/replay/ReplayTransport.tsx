/**
 * features/evaluator/components/replay/ReplayTransport.tsx
 * ---------------------------------------------------------------------------
 * Transport controls (D6-005): play/pause (also bound to Space, see
 * `EvaluatorStateContext`), 1x/4x/16x speed, and the scenario-time /
 * elapsed-time readout. Scenario time only (COR-053).
 */

import { Box, IconButton, Stack, Typography, ToggleButton, ToggleButtonGroup } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faPlay, faPause } from '@fortawesome/free-solid-svg-icons'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { scenarioClock, ARC_DURATION_MINUTES } from '../../services/scenarioTime'
import type { PlaybackSpeed } from '../../types'

const SPEEDS: PlaybackSpeed[] = [1, 4, 16]

export function ReplayTransport() {
  const { playing, togglePlay, speed, setSpeed, playhead } = useEvaluatorState()

  return (
    <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, mt: 0.25 }}>
      <IconButton
        onClick={togglePlay}
        title={playing ? 'Pause (Space)' : 'Play (Space)'}
        sx={{ width: 36, height: 36, borderRadius: '50%', border: '1.5px solid #1e3a5f', bgcolor: '#1e3a5f', color: '#fff', '&:hover': { bgcolor: '#2f5580' } }}
      >
        <FontAwesomeIcon icon={playing ? faPause : faPlay} size="xs" />
      </IconButton>

      <ToggleButtonGroup
        exclusive
        size="small"
        value={speed}
        onChange={(_e, next: PlaybackSpeed | null) => { if (next) setSpeed(next) }}
      >
        {SPEEDS.map(s => (
          <ToggleButton key={s} value={s} sx={{ font: '700 10.5px ui-monospace,Menlo,monospace', borderRadius: '999px !important', px: 1.25 }}>
            {s}×
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      <Box sx={{ flex: 1 }} />
      <Typography sx={{ font: '700 15px ui-monospace,Menlo,monospace', color: '#1a1a1a' }}>
        {scenarioClock(playhead)}
      </Typography>
      <Typography sx={{ font: '600 10px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.1em', color: '#848482' }}>
        SCENARIO
      </Typography>
      <Typography sx={{ font: '600 12px ui-monospace,Menlo,monospace', color: '#848482' }}>
        T+{String(Math.round(playhead)).padStart(2, '0')} / {ARC_DURATION_MINUTES} MIN
      </Typography>
    </Stack>
  )
}
