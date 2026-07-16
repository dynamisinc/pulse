/**
 * features/evaluator/components/replay/ReplayTrack.tsx
 * ---------------------------------------------------------------------------
 * The replay scrubber (D6-005): activity ridgeline (the storm is visible),
 * a staff lane above it for inject ▸ / controller-dial ◆ markers (own
 * labeled lane, never mixed into the activity data — evaluator mode only,
 * absent in hotwash per D6-007), the +4hr scenario-time-jump seam rendered
 * as a hazard-hatched strip, and a bookmark ⚑ lane below for jumping to
 * annotated moments.
 */

import { Box, Stack, Tooltip, Typography } from '@mui/material'
import type { MouseEvent } from 'react'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import { useReplayTrack } from '../../hooks/useReplayTrack'
import { ARC_DURATION_MINUTES } from '../../services/scenarioTime'

const HAZARD_STRIPE = 'repeating-linear-gradient(135deg,#0c1420 0 3px,#f5c56b 3px 6px)'

export function ReplayTrack() {
  const { playhead, scrubTo, replayMode } = useEvaluatorState()
  const { ridge, staffMarks, bookmarkMarks, seamLeftPct } = useReplayTrack()
  const showStaffLane = replayMode === 'eval'
  const playLeftPct = (playhead / ARC_DURATION_MINUTES) * 100

  const handleTrackClick = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const fraction = (e.clientX - rect.left) / rect.width
    scrubTo(Math.max(0, Math.min(ARC_DURATION_MINUTES, fraction * ARC_DURATION_MINUTES)))
  }

  return (
    <Stack sx={{ gap: 0 }}>
      {showStaffLane && (
        <Box sx={{ position: 'relative', height: 16, mx: 0.25 }}>
          <Typography
            sx={{
              font: '800 8.5px ui-sans-serif,system-ui,sans-serif',
              letterSpacing: '.1em',
              color: '#8a5300',
              position: 'absolute',
              left: 0,
              top: -2,
            }}
          >
            STAFF LANE — injects ▸ · controller dials ◆ (never in the activity data)
          </Typography>
          {staffMarks.map(mark => (
            <Tooltip key={mark.id} title={mark.tooltip}>
              <Box
                component="span"
                sx={{
                  position: 'absolute',
                  left: `${mark.leftPct}%`,
                  transform: 'translateX(-50%)',
                  fontSize: 11,
                  color: mark.color,
                  top: 2,
                }}
              >
                {mark.glyph}
              </Box>
            </Tooltip>
          ))}
        </Box>
      )}

      <Box
        onClick={handleTrackClick}
        title="Click to scrub"
        sx={{ position: 'relative', height: 44, cursor: 'pointer', borderRadius: '6px', bgcolor: '#f2f4f6', overflow: 'hidden' }}
      >
        <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end', gap: '1px', px: '1px' }}>
          {ridge.map((point, i) => (
            <Box key={i} sx={{ flex: 1, bgcolor: '#b9c7d8', height: `${point.heightPct}%` }} />
          ))}
        </Box>
        <Tooltip title="Scenario-time discontinuity: controller advanced the clock +4 hr. No exercise time passed here.">
          <Box
            sx={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${seamLeftPct}%`,
              width: '10px',
              background: HAZARD_STRIPE,
            }}
          />
        </Tooltip>
        <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: `${playLeftPct}%`, width: '2px', bgcolor: '#e42217' }} />
        <Box
          sx={{
            position: 'absolute',
            top: 2,
            left: `${playLeftPct}%`,
            transform: 'translateX(-50%)',
            width: 10,
            height: 10,
            borderRadius: '50%',
            bgcolor: '#e42217',
            border: '2px solid #fff',
            boxShadow: '0 1px 4px rgba(0,0,0,.3)',
          }}
        />
      </Box>

      <Box sx={{ position: 'relative', height: 14, mx: 0.25 }}>
        <Box
          sx={{
            position: 'absolute',
            left: `${seamLeftPct}%`,
            transform: 'translateX(-50%)',
            font: '800 8.5px ui-monospace,Menlo,monospace',
            bgcolor: '#0c1420',
            color: '#f5c56b',
            borderRadius: '4px',
            px: 0.625,
            whiteSpace: 'nowrap',
          }}
        >
          ⟫ +4 HR
        </Box>
        {bookmarkMarks.map(mark => (
          <Tooltip key={mark.id} title={mark.tooltip}>
            <Box
              component="span"
              onClick={() => scrubTo(mark.t)}
              sx={{ position: 'absolute', left: `${mark.leftPct}%`, transform: 'translateX(-50%)', fontSize: 10, color: '#1e3a5f', cursor: 'pointer' }}
            >
              ⚑
            </Box>
          </Tooltip>
        ))}
      </Box>
    </Stack>
  )
}
