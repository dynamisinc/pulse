/**
 * features/evaluator/components/AarExportPanel.tsx
 * ---------------------------------------------------------------------------
 * The AAR export toolstrip flyout (D6-012, EVL-030/031): a five-line
 * contents manifest (timeline log / replay bundle / annotations + unpushed
 * count / metrics / scenario design record — the EVL-014 defensibility
 * layer ships in the package), a provisional-items warning, and one COBRA
 * "Export AAR package" button with progress + a named .zip result line.
 * TODO: point `startExport()` at a real export-job API once one exists.
 */

import { Box, Stack, Typography, IconButton, LinearProgress } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faXmark,
  faClockRotateLeft,
  faCirclePlay,
  faFlag,
  faGaugeHigh,
  faDiamond,
  faCircleCheck,
} from '@fortawesome/free-solid-svg-icons'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { CobraPrimaryButton } from '@/theme/styledComponents'
import { useToolstrip } from '@/features/staffShell/toolRegistry'
import { useEvaluatorState } from '../contexts/EvaluatorStateContext'
import { useAarManifest } from '../hooks/useAarExport'
import { useMetrics } from '../hooks/useMetrics'

const MANIFEST_ICONS: Record<string, IconDefinition> = {
  'timeline-log': faClockRotateLeft,
  'replay-bundle': faCirclePlay,
  annotations: faFlag,
  metrics: faGaugeHigh,
  'scenario-design-record': faDiamond,
}

export function AarExportPanel() {
  const { exporting, exportPct, exportDone, startExport } = useEvaluatorState()
  const { toggleTool } = useToolstrip()
  const manifest = useAarManifest()
  const { provisionalCount } = useMetrics()

  const step = exportPct < 40
    ? 'Bundling replay segments…'
    : exportPct < 75
      ? 'Rendering metrics snapshots…'
      : 'Signing package…'

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
          AAR EXPORT
        </Typography>
        <IconButton size="small" onClick={() => toggleTool('aar-export')} sx={{ color: '#848482' }}>
          <FontAwesomeIcon icon={faXmark} size="sm" />
        </IconButton>
      </Stack>

      <Typography sx={{ font: '500 11px/1.5 ui-sans-serif,system-ui,sans-serif', color: '#848482', px: 2, pt: 1.25, pb: 0.5 }}>
        One package, everything an AAR needs (EVL-030). Contents:
      </Typography>

      <Box sx={{ px: 2, py: 0.75 }}>
        {manifest.map(item => (
          <Stack key={item.id} direction="row" sx={{ gap: 1.125, py: 1, borderBottom: '1px solid #eceff2', alignItems: 'baseline' }}>
            <FontAwesomeIcon icon={MANIFEST_ICONS[item.id] ?? faGaugeHigh} style={{ color: '#1e3a5f', width: 12 }} />
            <Box>
              <Typography sx={{ font: '600 12px ui-sans-serif,system-ui,sans-serif' }}>{item.name}</Typography>
              <Typography sx={{ font: '500 10.5px ui-sans-serif,system-ui,sans-serif', color: '#848482' }}>{item.detail}</Typography>
            </Box>
          </Stack>
        ))}
      </Box>

      {provisionalCount > 0 && (
        <Typography
          sx={{
            font: '500 10.5px/1.5 ui-sans-serif,system-ui,sans-serif',
            color: '#8a5300',
            bgcolor: '#fff3dd',
            border: '1px solid #e3b25f',
            borderRadius: '7px',
            p: '8px 11px',
            m: '8px 16px',
          }}
        >
          {provisionalCount} missed-opportunity {provisionalCount === 1 ? 'item is' : 'items are'} still
          unconfirmed — {provisionalCount === 1 ? 'it exports' : 'they export'} flagged PROVISIONAL until
          confirmed (EVL-011).
        </Typography>
      )}

      <Box sx={{ mt: 'auto', p: 2, borderTop: '1px solid #dcdcdc', display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        {exporting && (
          <>
            <LinearProgress
              variant="determinate"
              value={exportPct}
              sx={{ height: 7, borderRadius: '4px', bgcolor: '#eceff2', '& .MuiLinearProgress-bar': { bgcolor: '#1e3a5f' } }}
            />
            <Typography sx={{ font: '600 10.5px ui-monospace,Menlo,monospace', color: '#4a4f55' }}>{step}</Typography>
          </>
        )}
        {exportDone && (
          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, color: '#256b43' }}>
            <FontAwesomeIcon icon={faCircleCheck} size="sm" />
            <Typography sx={{ font: '600 11.5px ui-sans-serif,system-ui,sans-serif' }}>
              fairhaven-26-3_aar-package.zip · 41.2 MB — ready
            </Typography>
          </Stack>
        )}
        <CobraPrimaryButton
          onClick={startExport}
          disabled={exporting}
          fullWidth
          sx={{ height: 40 }}
        >
          Export AAR package
        </CobraPrimaryButton>
      </Box>
    </Box>
  )
}
