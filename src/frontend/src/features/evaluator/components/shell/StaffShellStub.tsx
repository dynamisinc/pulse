/**
 * features/evaluator/components/shell/StaffShellStub.tsx
 * ---------------------------------------------------------------------------
 * STUB — the real shared staff shell (D7 / SHELL-CONTRACT.md) provides the
 * 56px navy header (brand lockup, exercise identity badge, scenario/wall
 * clocks, exercise-state pill, classification tag, presence, "Preview as
 * participant") and the 56px right-edge toolstrip dock (shell-global tools
 * above a divider, then the surface's own registered tools). DO NOT build
 * that chrome here for real — this component exists only so the Evaluator
 * Dashboard has somewhere to render for standalone dev routing at `/evaluator`
 * before the shared shell exists. Replace this file's usage with the real
 * `<StaffShell>` once D7 lands; nothing in `EvaluatorDashboardPage` should
 * need to change (it renders into `children` + registers tools the same way).
 *
 * What IS real here: the two-zone toolstrip layout (shell-global tools vs.
 * the surface's own tools, D7-011) and the absolutely-positioned flyout
 * layer anchored to its right edge, because `evaluatorTools.ts` and the
 * flyout components depend on that geometry existing somewhere.
 */

import { Box, Stack, Tooltip, Typography, IconButton } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faUserGroup } from '@fortawesome/free-solid-svg-icons'
import type { ReactNode } from 'react'

interface StaffShellStubProps {
  /** Work-area content — the real surface (EvaluatorDashboardPage). */
  children: ReactNode;
  /** Icon buttons for the surface's own toolstrip zone (below the divider). */
  toolstripTools: ReactNode;
  /** Flyout panels, absolutely positioned against this stub's work-area frame. */
  flyouts?: ReactNode;
}

export function StaffShellStub({ children, toolstripTools, flyouts }: StaffShellStubProps) {
  return (
    <Box
      sx={{
        height: '100vh',
        display: 'grid',
        gridTemplateRows: '56px minmax(0, 1fr)',
        fontSize: 13,
        bgcolor: '#f8f8f8',
      }}
    >
      {/* --- STUB header — real header is D7's job, see file header comment --- */}
      <Stack
        direction="row"
        spacing={1.75}
        sx={{
          alignItems: 'center',
          px: 1.75,
          bgcolor: '#1e3a5f',
          borderBottom: '1px solid #16293f',
          color: '#eef3f9',
        }}
      >
        <Stack sx={{ lineHeight: 1.05 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 800, letterSpacing: '.02em' }}>
            PULSE
          </Typography>
          <Typography sx={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.16em', color: '#7d93ad' }}>
            EVALUATOR DASHBOARD
          </Typography>
        </Stack>
        <Box
          sx={{
            font: '700 9px ui-monospace,Menlo,monospace',
            letterSpacing: '.1em',
            color: '#f5c56b',
            border: '1px dashed rgba(245,197,107,.5)',
            borderRadius: '5px',
            px: 0.75,
            py: 0.25,
          }}
        >
          STUB SHELL — D7 REPLACES THIS HEADER
        </Box>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Training use only — all content simulated">
          <Box
            sx={{
              font: '700 9px ui-monospace,Menlo,monospace',
              letterSpacing: '.12em',
              color: '#7d93ad',
              border: '1px solid rgba(255,255,255,.18)',
              px: 1,
              py: 0.375,
              borderRadius: '5px',
              whiteSpace: 'nowrap',
            }}
          >
            UNCLASSIFIED // FOUO
          </Box>
        </Tooltip>
      </Stack>

      {/* --- Work area + toolstrip dock (this geometry is real, D7-011) --- */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 56px', minHeight: 0, position: 'relative' }}>
        <Box sx={{ minHeight: 0, overflow: 'auto' }}>
          {children}
        </Box>

        <Stack
          sx={{
            alignItems: 'center',
            gap: 1.25,
            py: 1.5,
            borderLeft: '1px solid #dcdcdc',
            bgcolor: '#fff',
          }}
        >
          <Tooltip title="Participant admin — shell-global (COR-017). Placeholder only in this stub.">
            <span>
              <IconButton
                disabled
                sx={{ width: 40, height: 40, borderRadius: '10px', border: '1px solid #c4c4c4' }}
              >
                <FontAwesomeIcon icon={faUserGroup} size="sm" />
              </IconButton>
            </span>
          </Tooltip>
          <Typography sx={{ fontSize: 8, fontWeight: 700, letterSpacing: '.08em', color: '#848482', mt: '-6px' }}>
            ADMIN
          </Typography>
          <Box sx={{ width: 26, height: '1px', bgcolor: '#c4c4c4', my: 0.375 }} />
          {toolstripTools}
        </Stack>

        {flyouts}
      </Box>
    </Box>
  )
}
