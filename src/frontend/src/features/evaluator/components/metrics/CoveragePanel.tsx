/**
 * features/evaluator/components/metrics/CoveragePanel.tsx
 * ---------------------------------------------------------------------------
 * Coverage / missed-opportunity rows (D6-010, EVL-011): unconfirmed items
 * render dashed-amber "PROVISIONAL — NOT IN AAR YET" at reduced opacity with
 * Confirm-for-AAR / Dismiss actions (an evaluator judgment call, not world
 * steering); confirmed rows go solid red with the confirming evaluator's id.
 */

import { Box, Stack, Typography, Chip, Button } from '@mui/material'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'
import type { CoverageRowView } from '../../hooks/useMetrics'

const CHIP_STYLE: Record<CoverageRowView['chipVariant'], { border: string; background: string; color: string; dashed?: boolean }> = {
  addressed: { border: '#9ec9ab', background: '#eef7f0', color: '#256b43' },
  confirmed: { border: '#e0a5a1', background: '#fbeeed', color: '#8f150c' },
  provisional: { border: '#b26a00', background: '#fffaf0', color: '#8a5300', dashed: true },
}

interface CoveragePanelProps {
  rows: CoverageRowView[];
}

export function CoveragePanel({ rows }: CoveragePanelProps) {
  const { confirmCoverage, dismissCoverage } = useEvaluatorState()

  return (
    <Box sx={{ bgcolor: '#fff', border: '1px solid #dcdcdc', borderRadius: '10px', overflow: 'hidden' }}>
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, px: 2, py: 1.5, borderBottom: '1px solid #dcdcdc' }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          COVERAGE · MISSED OPPORTUNITIES
        </Typography>
        <Typography sx={{ font: '500 11px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>
          unconfirmed items stay provisional and export as such until an evaluator confirms them
          (EVL-011)
        </Typography>
      </Stack>

      {rows.map(row => {
        const chip = CHIP_STYLE[row.chipVariant]
        return (
          <Stack
            key={row.item.id}
            direction="row"
            sx={{
              alignItems: 'center',
              gap: 1.5,
              px: 2,
              py: 1.5,
              borderBottom: '1px solid #eceff2',
              borderLeft: `4px solid ${row.edgeColor}`,
              opacity: row.opacity,
            }}
          >
            <Typography sx={{ font: '800 12px ui-sans-serif,system-ui,sans-serif', color: row.glyphColor, width: 14, textAlign: 'center' }}>
              {row.glyph}
            </Typography>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography sx={{ font: '600 12px ui-sans-serif,system-ui,sans-serif' }}>{row.item.text}</Typography>
              <Typography sx={{ font: '500 10.5px ui-sans-serif,system-ui,sans-serif', color: '#848482', mt: 0.25 }}>
                {row.item.sub}
              </Typography>
            </Box>
            <Chip
              label={row.chipLabel}
              size="small"
              sx={{
                fontWeight: 700,
                fontSize: 9,
                letterSpacing: '.08em',
                borderRadius: '999px',
                border: `1px ${chip.dashed ? 'dashed' : 'solid'} ${chip.border}`,
                bgcolor: chip.background,
                color: chip.color,
                whiteSpace: 'nowrap',
              }}
            />
            {row.pending && (
              <>
                <Button
                  size="small"
                  onClick={() => confirmCoverage(row.item.id)}
                  sx={{ fontWeight: 700, fontSize: 11, borderRadius: '999px', px: 1.75, bgcolor: '#1e3a5f', color: '#fff', '&:hover': { bgcolor: '#2f5580' } }}
                >
                  Confirm for AAR
                </Button>
                <Button
                  size="small"
                  onClick={() => dismissCoverage(row.item.id)}
                  sx={{ fontWeight: 600, fontSize: 11, borderRadius: '999px', px: 1.25, border: '1px solid #c4c4c4', color: '#4a4f55' }}
                >
                  Dismiss
                </Button>
              </>
            )}
          </Stack>
        )
      })}
    </Box>
  )
}
