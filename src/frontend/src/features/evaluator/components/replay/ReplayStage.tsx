/**
 * features/evaluator/components/replay/ReplayStage.tsx
 * ---------------------------------------------------------------------------
 * The replay viewport: the participant stage at the current playhead moment,
 * plus the "SCENARIO TIME ADVANCED" toast that fires when scrubbing/playback
 * crosses the +4hr time-jump seam (D6-005).
 */

import { Box } from '@mui/material'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { useWorldStage } from '../../hooks/useWorldStage'
import { ParticipantStageFrame } from '../ParticipantStageFrame'
import { scenarioClock } from '../../services/scenarioTime'

export function ReplayStage() {
  const { playhead, replayChannel, replayMode, showScenarioAdvancedToast } = useEvaluatorState()
  const stage = useWorldStage(playhead)
  const showOrigins = replayMode === 'eval'

  return (
    <Box
      sx={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        bgcolor: '#e9edf1',
        border: '1px solid #dcdcdc',
        borderRadius: '12px',
        p: 2.5,
        overflow: 'auto',
        position: 'relative',
      }}
    >
      {showScenarioAdvancedToast && (
        <Box
          sx={{
            position: 'absolute',
            top: 14,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5,
            font: '700 10.5px ui-monospace,Menlo,monospace',
            letterSpacing: '.08em',
            bgcolor: '#0c1420',
            color: '#f5c56b',
            borderRadius: '7px',
            px: 2,
            py: 1,
            boxShadow: '0 8px 24px rgba(0,0,0,.3)',
          }}
        >
          ⟫ SCENARIO TIME ADVANCED +4 HR — {scenarioClock(playhead)}
        </Box>
      )}
      <ParticipantStageFrame stage={stage} activeChannel={replayChannel} showOrigins={showOrigins} size="lg" />
    </Box>
  )
}
