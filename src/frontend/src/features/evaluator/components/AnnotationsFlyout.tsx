/**
 * features/evaluator/components/AnnotationsFlyout.tsx
 * ---------------------------------------------------------------------------
 * The Annotations toolstrip flyout (D6-003, EVL-021): every bookmarked
 * moment with its note, each row offering "→ Cadence"; the footer's one
 * COBRA button pushes everything still unpushed. Evidence goes to Cadence;
 * scoring stays there (E10 §1 boundary) — this surface never scores.
 */

import { Box, Stack, Typography, Chip, IconButton, Button } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark, faCheck } from '@fortawesome/free-solid-svg-icons'
import { CobraPrimaryButton } from '@/theme/styledComponents'
import { useToolstrip } from '@/features/staffShell/toolRegistry'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import type { AnnotationCategory } from '../types'

const CATEGORY_COLORS: Record<AnnotationCategory, { bg: string; fg: string }> = {
  STRENGTH: { bg: '#eef7f0', fg: '#256b43' },
  IMPROVEMENT: { bg: '#fdf3e3', fg: '#8a5300' },
  OBSERVATION: { bg: '#eef3f9', fg: '#1e3a5f' },
}

export function AnnotationsFlyout() {
  const { annotations, pushAnnotation, pushAllAnnotations } = useEvaluatorState()
  const { toggleTool } = useToolstrip()
  const unpushed = annotations.filter(a => !a.pushed).length

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 352,
        bgcolor: '#fff',
        borderLeft: '1px solid #c4c4c4',
        boxShadow: '-16px 0 40px rgba(0,0,0,.14)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', px: 2, py: '13px', borderBottom: '1px solid #dcdcdc' }}>
        <Typography sx={{ font: '800 11px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.14em', color: '#4a4f55' }}>
          ANNOTATIONS
        </Typography>
        <IconButton size="small" onClick={() => toggleTool('annotations')} sx={{ color: '#848482' }}>
          <FontAwesomeIcon icon={faXmark} size="sm" />
        </IconButton>
      </Stack>

      <Typography sx={{ font: '500 11px/1.5 ui-sans-serif,system-ui,sans-serif', color: '#848482', px: 2, pt: 1.25, pb: 0.75 }}>
        Bookmarked moments with your notes. Push sends them to Cadence as observation evidence
        (EVL-021) — scoring stays in Cadence.
      </Typography>

      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {annotations.map(a => {
          const colors = CATEGORY_COLORS[a.category]
          return (
            <Box key={a.id} sx={{ px: 2, py: 1.5, borderBottom: '1px solid #eceff2' }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.875 }}>
                <Chip
                  label={a.category}
                  size="small"
                  sx={{ fontWeight: 800, fontSize: 8.5, letterSpacing: '.08em', borderRadius: '999px', bgcolor: colors.bg, color: colors.fg }}
                />
                <Typography sx={{ font: '600 10px ui-monospace,Menlo,monospace', color: '#848482' }}>{a.time}</Typography>
                <Box sx={{ flex: 1 }} />
                {a.pushed ? (
                  <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5, color: '#256b43' }}>
                    <FontAwesomeIcon icon={faCheck} size="2xs" />
                    <Typography sx={{ font: '700 9.5px ui-sans-serif,system-ui,sans-serif' }}>in Cadence</Typography>
                  </Stack>
                ) : (
                  <Button
                    size="small"
                    onClick={() => pushAnnotation(a.id)}
                    sx={{ fontWeight: 700, fontSize: 10.5, color: '#1e3a5f', border: '1px solid #b9c7d8', borderRadius: '999px', px: 1.25, '&:hover': { bgcolor: '#eef3f9' } }}
                  >
                    → Cadence
                  </Button>
                )}
              </Stack>
              <Typography sx={{ font: '500 12px/1.5 ui-sans-serif,system-ui,sans-serif', mt: 0.75 }}>{a.note}</Typography>
              <Typography sx={{ font: '500 10px ui-sans-serif,system-ui,sans-serif', color: '#848482', mt: 0.5 }}>
                ⚓ {a.anchor}
              </Typography>
            </Box>
          )
        })}
      </Box>

      <Box sx={{ p: 2, borderTop: '1px solid #dcdcdc', display: 'flex', justifyContent: 'flex-end' }}>
        <CobraPrimaryButton size="small" onClick={pushAllAnnotations} disabled={unpushed === 0} sx={{ width: 150 }}>
          {unpushed ? `Push ${unpushed} to Cadence` : 'All in Cadence ✓'}
        </CobraPrimaryButton>
      </Box>
    </Box>
  )
}
