/**
 * features/evaluator/components/WorldView.tsx
 * ---------------------------------------------------------------------------
 * Read-only participant stage, pinned to "now" (D6-002, COR-013). No pause,
 * no dial, no compose, no engine control — nothing rendered disabled, just
 * absent. Steering lives in the Controller Console; this is observation
 * only. Tabs switch between Portal and Pulse.
 */

import { Box, Stack, Typography, ButtonGroup, Button } from '@mui/material'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { useWorldStage } from '../hooks/useWorldStage'
import { ParticipantStageFrame } from './ParticipantStageFrame'
import type { WorldChannel } from '../types'

const CHANNELS: { value: WorldChannel; label: string }[] = [
  { value: 'portal', label: 'PORTAL' },
  { value: 'pulse', label: 'PULSE' },
]

export function WorldView() {
  const { worldChannel, setWorldChannel, nowT } = useEvaluatorState()
  const stage = useWorldStage(nowT)

  return (
    <Stack sx={{ gap: 1.25 }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          WORLD VIEW
        </Typography>
        <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
          as participants see it now · read-only
        </Typography>
        <Box sx={{ flex: 1 }} />
        <ButtonGroup size="small">
          {CHANNELS.map(c => (
            <Button
              key={c.value}
              onClick={() => setWorldChannel(c.value)}
              variant={worldChannel === c.value ? 'contained' : 'outlined'}
              sx={{
                font: '700 10.5px ui-monospace,Menlo,monospace',
                borderRadius: '999px !important',
                px: 1.375,
              }}
            >
              {c.label}
            </Button>
          ))}
        </ButtonGroup>
      </Stack>

      <ParticipantStageFrame stage={stage} activeChannel={worldChannel} showOrigins size="sm" />
    </Stack>
  )
}
