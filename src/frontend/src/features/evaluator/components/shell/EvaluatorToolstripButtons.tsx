/**
 * features/evaluator/components/shell/EvaluatorToolstripButtons.tsx
 * ---------------------------------------------------------------------------
 * Renders the icon buttons for `EVALUATOR_TOOLS` (evaluatorTools.ts) into
 * the shell stub's toolstrip slot, wiring each to its open/toggle state in
 * `EvaluatorStateContext`. TODO(D7-011): this whole component goes away
 * once tools register into the real shared shell's `registerTool()`.
 */

import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { EVALUATOR_TOOLS } from '../../evaluatorTools'
import { useEvaluatorState } from '../../contexts/EvaluatorStateContext'

export function EvaluatorToolstripButtons() {
  const {
    annotationsFlyoutOpen, toggleAnnotationsFlyout,
    exportFlyoutOpen, toggleExportFlyout, annotations,
  } = useEvaluatorState()
  const unpushedCount = annotations.filter(a => !a.pushed).length

  return (
    <>
      {EVALUATOR_TOOLS.map(tool => {
        const isOpen = tool.id === 'annotations' ? annotationsFlyoutOpen : exportFlyoutOpen
        const onToggle = tool.id === 'annotations' ? toggleAnnotationsFlyout : toggleExportFlyout
        const badge = tool.id === 'annotations' && unpushedCount > 0 ? unpushedCount : null

        return (
          <Stack key={tool.id} sx={{ alignItems: 'center', gap: 0 }}>
            <Tooltip title={tool.tooltip}>
              <IconButton
                onClick={onToggle}
                sx={{
                  width: 40,
                  height: 40,
                  borderRadius: '10px',
                  border: `1px solid ${isOpen ? '#1e3a5f' : '#c4c4c4'}`,
                  bgcolor: isOpen ? '#e7eef6' : 'transparent',
                  color: isOpen ? '#1e3a5f' : '#4a4f55',
                  position: 'relative',
                }}
              >
                <FontAwesomeIcon icon={tool.icon} size="sm" />
                {badge !== null && (
                  <Box
                    sx={{
                      position: 'absolute',
                      top: -5,
                      right: -5,
                      bgcolor: '#e42217',
                      color: '#fff',
                      font: '800 9px ui-sans-serif,system-ui,sans-serif',
                      px: '5px',
                      borderRadius: '8px',
                    }}
                  >
                    {badge}
                  </Box>
                )}
              </IconButton>
            </Tooltip>
            <Typography sx={{ font: '700 8px ui-sans-serif,system-ui,sans-serif', letterSpacing: '.08em', color: '#848482', mt: '-6px' }}>
              {tool.label}
            </Typography>
          </Stack>
        )
      })}
    </>
  )
}
