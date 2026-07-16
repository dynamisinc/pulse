/**
 * features/evaluator/components/StorylineTile.tsx
 * ---------------------------------------------------------------------------
 * One storyline board tile (D6-001). Hero = state x time-in-state
 * ("AMBER · 40 MIN") — duration of neglect, not instantaneous intensity, is
 * the room-glance signal. Severity is always word + shape + color together
 * (NFR-001, never color-only). Clicking the tile opens Timeline pre-filtered
 * to this storyline; the flag opens annotation capture anchored to the tile
 * (D6-003 — "any card/tile/row carries ⚑").
 */

import { Box, Stack, Tooltip, IconButton, Typography, LinearProgress } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faFlag, faClock, faArrowTrendDown, faArrowTrendUp, faArrowRight } from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import type { StorylineTile as StorylineTileModel } from '../types'

interface StorylineTileProps {
  tile: StorylineTileModel;
  heroFontSizePx: number;
  engineOn: boolean;
  onOpen: () => void;
  onFlag: () => void;
}

const SENTIMENT_ICONS: Record<string, IconDefinition> = {
  '↘': faArrowTrendDown,
  '↗': faArrowTrendUp,
  '→': faArrowRight,
}

export function StorylineTile({
  tile, heroFontSizePx, engineOn, onOpen, onFlag,
}: StorylineTileProps) {
  const sentimentIcon = SENTIMENT_ICONS[tile.sentimentArrow] ?? faArrowRight

  return (
    <Box
      onClick={onOpen}
      title="Open in Timeline, filtered to this storyline"
      sx={{
        bgcolor: '#fff',
        border: '1px solid #dcdcdc',
        borderTop: `4px solid ${tile.severity.color}`,
        borderRadius: '10px',
        p: '14px 16px',
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        '&:hover': { boxShadow: '0 4px 14px rgba(0,0,0,.08)' },
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
        <Typography sx={{ font: '800 14px ui-sans-serif,system-ui,sans-serif' }}>
          {tile.name}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography
          component="span"
          sx={{ font: '800 10px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.1em', color: tile.severity.color }}
        >
          {tile.severity.shape} {tile.severity.word}
        </Typography>
        <Tooltip title="Bookmark this moment (B)">
          <IconButton
            size="small"
            onClick={e => { e.stopPropagation(); onFlag() }}
            sx={{ p: 0.5, color: '#848482', '&:hover': { color: '#1e3a5f' } }}
          >
            <FontAwesomeIcon icon={faFlag} size="2xs" />
          </IconButton>
        </Tooltip>
      </Stack>

      <Typography sx={{ font: `800 ${heroFontSizePx}px ui-sans-serif,system-ui,sans-serif`, letterSpacing: '-.01em', color: tile.heroColor, lineHeight: 1 }}>
        {tile.hero}
      </Typography>

      {engineOn ? (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <LinearProgress
            variant="determinate"
            value={tile.intensity}
            sx={{
              flex: 1,
              height: 6,
              borderRadius: '4px',
              bgcolor: '#eceff2',
              '& .MuiLinearProgress-bar': { bgcolor: tile.severity.color },
            }}
          />
          <Typography sx={{ font: '700 10px ui-monospace,Menlo,monospace', color: '#4a4f55' }}>
            {tile.intensity}
          </Typography>
        </Stack>
      ) : (
        <Typography
          sx={{
            font: '500 10.5px ui-sans-serif,system-ui,sans-serif',
            color: '#848482',
            border: '1px dashed #c4c4c4',
            borderRadius: '5px',
            p: '4px 7px',
          }}
        >
          engine off — event-log signals only (EVL-015)
        </Typography>
      )}

      <Stack sx={{ gap: 0.625, font: '500 11.5px ui-sans-serif,system-ui,sans-serif', color: '#4a4f55' }}>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', color: tile.latencyIsHot ? tile.severity.color : '#4a4f55' }}>
          <FontAwesomeIcon icon={faClock} size="xs" />
          <Typography variant="inherit">{tile.latency}</Typography>
        </Stack>
        <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center', color: tile.concernsIsHot ? tile.severity.color : '#848482' }}>
          <FontAwesomeIcon icon={faFlag} size="xs" />
          <Typography variant="inherit">{tile.concerns}</Typography>
        </Stack>
        {engineOn && (
          <Stack direction="row" sx={{ gap: 0.75, alignItems: 'center' }}>
            <FontAwesomeIcon icon={sentimentIcon} size="xs" />
            <Typography variant="inherit">sentiment {tile.sentimentWord}</Typography>
          </Stack>
        )}
      </Stack>
    </Box>
  )
}
