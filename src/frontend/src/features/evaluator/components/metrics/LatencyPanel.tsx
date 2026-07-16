/**
 * features/evaluator/components/metrics/LatencyPanel.tsx
 * ---------------------------------------------------------------------------
 * Response latency (D6-009): time from prompt to first official response,
 * off-platform responses included via controller markers (CTL-026). Every
 * row carries an evidence-level chip — PERSON-LEVEL (navy, names the human
 * per COR-018) vs SESSION-LEVEL (gray, "no individual identified") — at chip
 * weight, not footnote weight (EVL-012).
 */

import { Box, Stack, Typography, LinearProgress, Chip, Tooltip } from '@mui/material'
import { evidenceChipPalette } from '../../hooks/useMetrics'
import type { LatencyRow } from '../../types'

interface LatencyPanelProps {
  rows: LatencyRow[];
}

export function LatencyPanel({ rows }: LatencyPanelProps) {
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', overflow: 'hidden' }}>
      <Stack sx={{ gap: 0.25, px: 2, py: 1.5, borderBottom: '1px solid #dcdcdc' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
          <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
            RESPONSE LATENCY
          </Typography>
          <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
            time from prompt to first official response · off-platform responses included via
            controller markers (CTL-026)
          </Typography>
        </Stack>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.1fr) 170px 120px',
          gap: 1.5,
          px: 2,
          py: 1,
          borderBottom: '1px solid #eceff2',
          font: '800 9px ui-sans-serif,system-ui,sans-serif',
          letterSpacing: '.12em',
          color: '#848482',
        }}
      >
        <span>PROMPT</span>
        <span>FIRST OFFICIAL RESPONSE</span>
        <span>LATENCY</span>
        <span>EVIDENCE</span>
      </Box>

      {rows.map(row => {
        const palette = evidenceChipPalette(row.evidenceLevel)
        return (
          <Box
            key={row.id}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(0,1.3fr) minmax(0,1.1fr) 170px 120px',
              gap: 1.5,
              px: 2,
              py: 1.5,
              borderBottom: '1px solid #eceff2',
              alignItems: 'center',
            }}
          >
            <Box>
              <Typography sx={{ font: '600 12px ui-sans-serif,system-ui,sans-serif' }}>{row.prompt}</Typography>
              <Typography sx={{ font: '500 10.5px ui-monospace,Menlo,monospace', color: '#848482', mt: 0.25 }}>
                {row.promptTime}
              </Typography>
            </Box>
            <Box>
              <Typography sx={{ font: '500 12px ui-sans-serif,system-ui,sans-serif', color: row.responseIsMissing ? '#b3261e' : '#1a1a1a' }}>
                {row.response}
              </Typography>
              {row.isOffPlatform && (
                <Chip
                  label="☎ OFF-PLATFORM · CTL-026"
                  size="small"
                  sx={{ mt: 0.5, fontWeight: 700, fontSize: 8.5, letterSpacing: '.06em', color: '#5b4a7a', bgcolor: '#efeaf7', border: '1px solid #c9b8e8', borderRadius: '4px', height: 18 }}
                />
              )}
            </Box>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
              <LinearProgress
                variant="determinate"
                value={row.barWidthPct}
                sx={{ flex: 1, height: 7, borderRadius: '4px', bgcolor: '#eceff2', '& .MuiLinearProgress-bar': { bgcolor: row.barColor } }}
              />
              <Typography sx={{ font: '700 12px ui-monospace,Menlo,monospace', color: row.barColor, whiteSpace: 'nowrap' }}>
                {row.latencyLabel}
              </Typography>
            </Stack>
            <Box>
              <Tooltip title={row.evidenceTooltip}>
                <Chip
                  label={row.evidenceLevel}
                  size="small"
                  sx={{
                    fontWeight: 700,
                    fontSize: 8.5,
                    letterSpacing: '.06em',
                    borderRadius: '999px',
                    border: `1px solid ${palette.border}`,
                    bgcolor: palette.background,
                    color: palette.text,
                    whiteSpace: 'nowrap',
                  }}
                />
              </Tooltip>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}
