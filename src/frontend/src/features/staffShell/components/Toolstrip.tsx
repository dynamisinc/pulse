/**
 * features/staffShell/components/Toolstrip.tsx
 * ---------------------------------------------------------------------------
 * The ONE shell-owned 56px right-edge toolstrip dock (feature: staff-shell,
 * story 02 — D7-011, COR-063; see docs/features/staff-shell/02-toolstrip-dock.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell
 * owns" → "Toolstrip").
 *
 * Renders two zones read from `useToolstrip()` (`../toolRegistry`):
 *  - SHELL-GLOBAL (top) — tools registered via `useRegisterShellGlobalTool()`
 *    (story 03's Participant Admin is the first consumer).
 *  - a DIVIDER — always rendered; the dock's two-zone structure is
 *    shell-owned chrome, present whether or not either zone has tools yet.
 *  - SURFACE (below) — tools registered via `useRegisterSurfaceTool()` (the
 *    `console-shell` toolbox, the evaluator dashboard's own tools).
 *
 * A surface draws NO strip of its own (D7-011) — it only calls
 * `useRegisterSurfaceTool()`; this component is the single place any tool
 * button renders.
 *
 * OUT OF SCOPE (per the story): flyout CONTENT. Each registrant renders its
 * OWN flyout, keyed off `useToolstrip().activeToolId` / `isActive(id)`,
 * inside the staff frame's work area (never a portal that escapes it) — this
 * component only owns the dock's buttons, badges, and the shared
 * active-tool toggle.
 *
 * A11y (NFR-001): every tool is a real `<button>` (via MUI `IconButton` —
 * focusable, Enter/Space-activatable out of the box) with `aria-pressed`
 * reflecting active state. Active is never color-only: it also gets a
 * heavier border + `aria-pressed`, not just a color swap. A badge's
 * `aria-label` spells out its count in words (e.g. "Stories: 3 pending") so a
 * screen reader announces the same signal a sighted user sees from the
 * digits, not a colored dot; an escalating badge additionally pulses (CSS
 * animation, disabled under `prefers-reduced-motion`) but the count TEXT is
 * what carries the signal either way.
 *
 * World: staff (COBRA/Cadence) — Cadence tokens from `../staffShellTokens`
 * (never a participant surface, XC-002).
 */

import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { alpha, keyframes } from '@mui/material/styles'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { staffShellTokens } from '../staffShellTokens'
import { useToolstrip, type SurfaceTool } from '../toolRegistry'

/** Escalating-badge pulse (D5-017 consult-on-demand signal) — see module header. */
const escalatingPulse = keyframes`
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.2); opacity: 0.7; }
`

interface ToolstripZoneProps {
  testId: string
  tools: SurfaceTool[]
  activeToolId: string | null
  onToggle: (id: string) => void
}

function ToolstripZone({ testId, tools, activeToolId, onToggle }: ToolstripZoneProps) {
  return (
    <Stack data-testid={testId} sx={{ width: '100%', alignItems: 'center', gap: 1.25 }}>
      {tools.map(tool => (
        <ToolstripToolButton
          key={tool.id}
          tool={tool}
          active={activeToolId === tool.id}
          onToggle={onToggle}
        />
      ))}
    </Stack>
  )
}

interface ToolstripToolButtonProps {
  tool: SurfaceTool
  active: boolean
  onToggle: (id: string) => void
}

function ToolstripToolButton({ tool, active, onToggle }: ToolstripToolButtonProps) {
  const badge = tool.badge
  // The badge's own text already carries the count; this button's accessible
  // name spells it out too, so a screen-reader user gets the same "3
  // pending"/"escalating" signal a sighted user reads off the digits +
  // pulse — never a color-only or visual-only cue (NFR-001).
  const accessibleLabel = badge
    ? `${tool.label}: ${badge.count} pending${badge.escalating ? ', escalating' : ''}`
    : tool.label

  return (
    <Stack sx={{ alignItems: 'center', gap: 0 }}>
      <Tooltip title={tool.tooltip}>
        <IconButton
          data-testid={`toolstrip-tool-${tool.id}`}
          aria-label={accessibleLabel}
          aria-pressed={active}
          onClick={() => onToggle(tool.id)}
          sx={{
            position: 'relative',
            width: 40,
            height: 40,
            borderRadius: '10px',
            border: active
              ? `2px solid ${staffShellTokens.header.background}`
              : `1px solid ${staffShellTokens.toolstrip.borderColor}`,
            bgcolor: active ? alpha(staffShellTokens.header.background, 0.08) : 'transparent',
            color: active
              ? staffShellTokens.header.background
              : staffShellTokens.accent.secondaryText,
          }}
        >
          <FontAwesomeIcon icon={tool.icon} size="sm" />

          {badge && (
            <Box
              aria-hidden="true"
              data-testid={`toolstrip-badge-${tool.id}`}
              data-escalating={badge.escalating ? 'true' : 'false'}
              sx={{
                position: 'absolute',
                top: -6,
                right: -6,
                minWidth: 16,
                height: 16,
                px: '4px',
                borderRadius: '8px',
                bgcolor: badge.escalating
                  ? staffShellTokens.accent.cadenceRed
                  : staffShellTokens.accent.secondaryText,
                color: '#fff',
                fontSize: 9,
                fontWeight: 800,
                lineHeight: '16px',
                textAlign: 'center',
                animation: badge.escalating ? `${escalatingPulse} 1.1s ease-in-out infinite` : 'none',
                '@media (prefers-reduced-motion: reduce)': {
                  animation: 'none',
                },
              }}
            >
              {badge.count}
            </Box>
          )}
        </IconButton>
      </Tooltip>
      <Typography
        aria-hidden="true"
        sx={{
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: '.08em',
          color: staffShellTokens.accent.secondaryText,
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        {tool.label}
      </Typography>
    </Stack>
  )
}

/**
 * The staff shell's ONE right-edge toolstrip dock. Reads the registry via
 * `useToolstrip()` — see module header for the zone layout and a11y
 * contract. Throws (via `useToolstrip()`) if rendered outside a
 * `<ToolstripProvider>`.
 */
export function Toolstrip() {
  const { shellGlobalTools, surfaceTools, activeToolId, toggleTool } = useToolstrip()

  return (
    <Stack
      data-testid="staff-toolstrip"
      sx={{
        width: staffShellTokens.toolstrip.widthPx,
        alignItems: 'center',
        gap: 1.25,
        py: 1.5,
        bgcolor: staffShellTokens.toolstrip.background,
      }}
    >
      <ToolstripZone
        testId="toolstrip-zone-shell-global"
        tools={shellGlobalTools}
        activeToolId={activeToolId}
        onToggle={toggleTool}
      />

      <Box
        aria-hidden="true"
        data-testid="toolstrip-divider"
        sx={{ width: 28, height: '1px', bgcolor: staffShellTokens.toolstrip.borderColor, my: 0.25 }}
      />

      <ToolstripZone
        testId="toolstrip-zone-surface"
        tools={surfaceTools}
        activeToolId={activeToolId}
        onToggle={toggleTool}
      />
    </Stack>
  )
}
