/**
 * features/evaluator/components/replay/ReplayPlayer.tsx
 * ---------------------------------------------------------------------------
 * Replay is a video player over the exercise (D6-005/006/007): a two-state
 * "EVALUATOR VIEW ⇄ HOTWASH · PARTICIPANT-VISIBLE" segmented switch (hotwash
 * side amber, deliberate click only — no keyboard/hover path), a persistent
 * honest-fidelity chip that flips between "ORDER EXACT · COUNTS ≈ SNAPSHOT"
 * (evaluator mode) and "HOTWASH — STAFF OVERLAYS HIDDEN" (hotwash mode, when
 * the staff lane + origin lines go absent, not grayed), the participant
 * stage, and the track + transport panel below it.
 */

import { Box, Stack, Typography, ButtonGroup, Button } from '@mui/material'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { ReplayStage } from './ReplayStage'
import { ReplayTrack } from './ReplayTrack'
import { ReplayTransport } from './ReplayTransport'
import type { WorldChannel } from '../../types'

const CHANNEL_TABS: { value: WorldChannel; label: string }[] = [
  { value: 'portal', label: 'FAIRHAVEN TODAY' },
  { value: 'pulse', label: 'PULSE' },
]

export function ReplayPlayer() {
  const { replayMode, setReplayMode, replayChannel, setReplayChannel } = useEvaluatorState()
  const isEval = replayMode === 'eval'

  return (
    <Stack sx={{ gap: 1.5, flex: 1, minHeight: 0 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <ButtonGroup sx={{ border: '1.5px solid #1e3a5f', borderRadius: '9px', overflow: 'hidden' }}>
          <Button
            onClick={() => setReplayMode('eval')}
            sx={{
              font: '800 11px ui-sans-serif,system-ui,sans-serif',
              letterSpacing: '.06em',
              px: 2,
              border: 'none',
              borderRadius: 0,
              bgcolor: isEval ? '#1e3a5f' : '#fff',
              color: isEval ? '#fff' : '#1e3a5f',
              '&:hover': { bgcolor: isEval ? '#1e3a5f' : '#f4f7fa' },
            }}
          >
            EVALUATOR VIEW
          </Button>
          <Button
            onClick={() => setReplayMode('hotwash')}
            sx={{
              font: '800 11px ui-sans-serif,system-ui,sans-serif',
              letterSpacing: '.06em',
              px: 2,
              border: 'none',
              borderLeft: '1.5px solid #1e3a5f',
              borderRadius: 0,
              bgcolor: !isEval ? '#b26a00' : '#fff',
              color: !isEval ? '#fff' : '#8a5300',
              '&:hover': { bgcolor: !isEval ? '#b26a00' : '#f4f7fa' },
            }}
          >
            HOTWASH · PARTICIPANT-VISIBLE
          </Button>
        </ButtonGroup>

        {!isEval && (
          <Typography
            sx={{
              font: '800 10px ui-sans-serif,system-ui,sans-serif',
              letterSpacing: '.1em',
              color: '#8a5300',
              bgcolor: '#fff3dd',
              border: '1px solid #e3b25f',
              borderRadius: '6px',
              px: 1.25,
              py: 0.625,
            }}
          >
            HOTWASH — STAFF OVERLAYS HIDDEN (EVL-014)
          </Typography>
        )}
        {isEval && (
          <Typography
            title="Ordering is exact from the event log; derived numbers (trending, counts) are snapshot-approximate"
            sx={{
              font: '700 10px ui-monospace,Menlo,monospace',
              letterSpacing: '.06em',
              color: '#4a4f55',
              bgcolor: '#fff',
              border: '1px solid #c4c4c4',
              borderRadius: '6px',
              px: 1.25,
              py: 0.625,
            }}
          >
            ORDER EXACT · COUNTS ≈ SNAPSHOT
          </Typography>
        )}

        <Box sx={{ flex: 1 }} />
        <ButtonGroup size="small">
          {CHANNEL_TABS.map(tab => (
            <Button
              key={tab.value}
              onClick={() => setReplayChannel(tab.value)}
              variant={replayChannel === tab.value ? 'contained' : 'outlined'}
              sx={{ font: '700 10.5px ui-monospace,Menlo,monospace', borderRadius: '999px !important', px: 1.5 }}
            >
              {tab.label}
            </Button>
          ))}
        </ButtonGroup>
      </Stack>

      <ReplayStage />

      <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '12px', p: '12px 16px 14px' }}>
        <ReplayTrack />
        <ReplayTransport />
      </Box>
    </Stack>
  )
}
