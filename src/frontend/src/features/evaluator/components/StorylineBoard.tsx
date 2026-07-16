/**
 * features/evaluator/components/StorylineBoard.tsx
 * ---------------------------------------------------------------------------
 * The primary Live-view surface (D6-001, EVL-022): four large tiles across
 * the top row — the evaluator has no queue, so the board IS the job. Burst
 * state (D0 §4.5 / SOC-071) surfaces a "BURST · N POSTS/MIN" chip next to
 * the section header.
 */

import { Box, Stack, Typography } from '@mui/material'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { useStorylineTiles } from '../hooks/useStorylineTiles'
import { StorylineTile } from './StorylineTile'
import { scenarioClock } from '../services/scenarioTime'

const POSTS_PER_MIN_DURING_STORM = 96

export function StorylineBoard() {
  const {
    isStorm, engineOn, projector, nowT, filterTimelineByStoryline, openAnnotation,
  } = useEvaluatorState()
  const tiles = useStorylineTiles()
  const heroFontSizePx = projector ? 46 : 30

  return (
    <Stack sx={{ gap: 1.75 }}>
      <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1.25 }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          STORYLINE BOARD
        </Typography>
        <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
          how long each arc has been waiting on a response — the room-glance surface
        </Typography>
        <Box sx={{ flex: 1 }} />
        {isStorm && (
          <Typography
            sx={{
              font: '700 10px ui-monospace,Menlo,monospace',
              letterSpacing: '.08em',
              color: '#8f150c',
              bgcolor: 'rgba(228,34,23,.08)',
              border: '1px solid rgba(228,34,23,.3)',
              borderRadius: '5px',
              px: 1,
              py: 0.375,
            }}
          >
            BURST · {POSTS_PER_MIN_DURING_STORM} POSTS/MIN
          </Typography>
        )}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 1.5 }}>
        {tiles.map(tile => (
          <StorylineTile
            key={tile.id}
            tile={tile}
            heroFontSizePx={heroFontSizePx}
            engineOn={engineOn}
            onOpen={() => filterTimelineByStoryline(tile.name)}
            onFlag={() => openAnnotation(`${tile.name} board tile · ${scenarioClock(nowT)}`)}
          />
        ))}
      </Box>
    </Stack>
  )
}
