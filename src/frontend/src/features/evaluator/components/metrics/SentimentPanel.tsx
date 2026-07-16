/**
 * features/evaluator/components/metrics/SentimentPanel.tsx
 * ---------------------------------------------------------------------------
 * Sentiment trajectory (D6-008, EVL-012/014): the engine's aggregate
 * public-sentiment line, session-level (no individual identified), with a
 * dashed-line ◆ overlay for controller dial events and a legend banner
 * stating mood shifts at those marks are dialed, not participant
 * performance — the defensibility layer. Pre-E8 (D6-011): replaced with a
 * dashed "nothing synthesized" card; latency/coverage stay usable elsewhere.
 */

import { Box, Stack, Typography, Chip } from '@mui/material'
import type { SentimentChartData } from '../../hooks/useMetrics'

const HATCH_PATTERN_ID = 'evaluator-seam-hatch'

interface SentimentPanelProps {
  data: SentimentChartData;
}

export function SentimentPanel({ data }: SentimentPanelProps) {
  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: '1px solid #dcdcdc', flexWrap: 'wrap' }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          SENTIMENT TRAJECTORY
        </Typography>
        <Chip
          label="SESSION-LEVEL"
          size="small"
          title="Aggregated across the session — no individual is identified in this chart (EVL-012)"
          sx={{ fontWeight: 700, fontSize: 8.5, letterSpacing: '.06em', borderRadius: '999px', border: '1px solid #c4c4c4', bgcolor: '#f2f4f6', color: '#4a4f55' }}
        />
        <Box sx={{ flex: 1 }} />
        <Typography
          sx={{
            font: '600 10.5px ui-sans-serif,system-ui,sans-serif',
            color: '#8a5300',
            bgcolor: '#fff3dd',
            border: '1px solid #e3b25f',
            borderRadius: '6px',
            px: 1.25,
            py: 0.5,
          }}
        >
          ◆ controller inputs are scenario design — mood shifts at these marks are dialed, not
          participant performance (EVL-014)
        </Typography>
      </Stack>

      <Box sx={{ px: 2, pt: 1.75, pb: 0.75 }}>
        <svg viewBox="0 0 680 190" style={{ width: '100%', display: 'block' }}>
          <line x1="30" y1="95" x2="670" y2="95" stroke="#dcdcdc" strokeWidth={1} strokeDasharray="3 4" />
          <text x="4" y="99" fontSize={9} fill="#848482" fontFamily="monospace">0</text>
          <text x="4" y="30" fontSize={9} fill="#848482" fontFamily="monospace">+</text>
          <text x="4" y="176" fontSize={9} fill="#848482" fontFamily="monospace">−</text>
          <defs>
            <pattern id={HATCH_PATTERN_ID} width={6} height={6} patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width={6} height={6} fill="#0c1420" />
              <rect width={3} height={6} fill="#f5c56b" />
            </pattern>
          </defs>
          <rect x={data.seamX} y={14} width={8} height={150} fill={`url(#${HATCH_PATTERN_ID})`} />
          <path d={data.path} fill="none" stroke="#1e3a5f" strokeWidth={2.5} strokeLinejoin="round" />
          {data.dialMarkers.map(marker => (
            <g key={marker.label}>
              <line x1={marker.x} y1={20} x2={marker.x} y2={168} stroke="#b26a00" strokeWidth={1.2} strokeDasharray="4 3" />
              <rect
                x={marker.rectX}
                y={marker.rectY}
                width={9}
                height={9}
                transform={`rotate(45 ${marker.x} ${marker.y})`}
                fill="#b26a00"
              />
              <text x={marker.labelX} y={30} fontSize={9.5} fontWeight={700} fill="#8a5300" fontFamily="sans-serif">
                {marker.label}
              </text>
            </g>
          ))}
          {data.axisTicks.map(tick => (
            <text key={tick.label} x={tick.x} y={186} fontSize={9} fill="#848482" fontFamily="monospace" textAnchor="middle">
              {tick.label}
            </text>
          ))}
        </svg>
        <Typography sx={{ font: '500 10.5px ui-sans-serif,system-ui,sans-serif', color: '#848482', padding: '4px 0 8px' }}>
          Hatched seam = scenario-time jump (+4 hr). Line is the engine's aggregate public-sentiment
          estimate; ◆ marks controller dial events with the setting change.
        </Typography>
      </Box>
    </Box>
  )
}

export function SentimentUnavailableCard() {
  return (
    <Box
      sx={{
        border: '1.5px dashed #c4c4c4',
        borderRadius: '10px',
        p: 3.25,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 1,
        textAlign: 'center',
        color: '#848482',
      }}
    >
      <Typography sx={{ font: '700 13px ui-sans-serif,system-ui,sans-serif', color: '#4a4f55' }}>
        Engine metrics not available for this exercise
      </Typography>
      <Typography sx={{ font: '500 12px/1.6 ui-sans-serif,system-ui,sans-serif', maxWidth: 520 }}>
        This exercise ran without the adaptive engine, so sentiment trajectory and intensity
        metrics were never generated. Nothing was synthesized in their place (EVL-015). Latency
        and coverage above come from the event log and remain fully usable.
      </Typography>
    </Box>
  )
}
