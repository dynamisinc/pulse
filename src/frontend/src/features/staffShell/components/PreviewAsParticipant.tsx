/**
 * features/staffShell/components/PreviewAsParticipant.tsx
 * ---------------------------------------------------------------------------
 * "Preview as participant" STAGE (feature: staff-shell, story 04 — COR-041;
 * see docs/features/staff-shell/04-preview-as-participant.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Variants" →
 * preview-as-participant).
 *
 * This is the component the ORCHESTRATOR renders IN PLACE OF a staff
 * surface's work area, driven by `usePreview().active` (`../previewContext`):
 *
 * ```tsx
 * const { active, toggle } = usePreview()
 * <StaffHeader previewActive={active} onTogglePreview={toggle} />
 * {active ? <PreviewAsParticipant /> : <ControllerConsoleWorkArea />}
 * ```
 *
 * This component deliberately does NOT read `active` itself and does not
 * navigate or open a real participant session — the orchestrator's
 * conditional (work-area XOR stage) IS the "replaces the work area"
 * behavior (AC1/AC3); exiting (the Exit control below) only calls
 * `toggle()`, which flips `active` back and lets the orchestrator's same
 * conditional restore the prior work area.
 *
 * Anatomy, top → bottom (matches `Pulse Staff Shell.dc.html`'s `.pvbar` /
 * `.pvstage`):
 *  1. A staff-world (COBRA) label strip, UNMISTAKABLY marking the stage as a
 *     preview ("PREVIEW AS PARTICIPANT — READ-ONLY") + the scenario-moment
 *     picker (AC2: STARTEX/ADVISORY/BURST/NOW, mutually exclusive —
 *     `role="radiogroup"` / `role="radio"` + `aria-checked`, NFR-001) + an
 *     Exit control that calls `toggle()`.
 *  2. The stage itself: a neutral staff-world mat framing the PARTICIPANT-
 *     WORLD render — `PortalStub` wrapped in `ShellContextProvider` with
 *     `{variant: 'preview', scenarioNow: <the selected moment's instant>}`
 *     (AC1/AC4) — participant-shell's own mount contract, imported (never
 *     reimplemented) from `@/features/participant-shell/mountContract`.
 *
 * The picker drives BOTH the alert state/content (via `momentConfig`, from
 * `../previewContext`'s mock model) AND the `scenarioNow` handed to the
 * participant render (via `resolvePreviewMomentInstant`) — always scenario
 * time, never wall-clock (COR-053).
 *
 * World: staff (COBRA/Cadence) for THIS component's own chrome (the label
 * strip + stage mat, `staffShellTokens`-sourced). `PortalStub`, mounted
 * below, is the ONE deliberate exception the hard gate carves out
 * (SHELL-CONTRACT §4): a staff-world frame hosting a labelled
 * participant-world render, never the reverse.
 */

import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import {
  ShellContextProvider,
  type ShellMountProps,
  type ShellVariant,
} from '@/features/participant-shell/mountContract'
import { staffShellTokens } from '../staffShellTokens'
import {
  getPreviewMomentConfig,
  PREVIEW_MOMENT_ORDER,
  resolvePreviewMomentInstant,
  usePreview,
  type PreviewMoment,
} from '../previewContext'
import { PortalStub } from './PortalStub'

/** `ShellMountProps.variant` this stage ALWAYS mounts the stub under (AC4). */
const PREVIEW_VARIANT: ShellVariant = 'preview'

export function PreviewAsParticipant() {
  const { moment, setMoment, toggle } = usePreview()

  const momentConfig = getPreviewMomentConfig(moment)
  const momentInstant = resolvePreviewMomentInstant(moment)

  const mountProps: ShellMountProps = {
    variant: PREVIEW_VARIANT,
    scenarioNow: momentInstant,
  }

  return (
    <Stack
      data-testid="preview-as-participant"
      sx={{
        height: '100%',
        gap: 1.5,
        p: 1.5,
        bgcolor: staffShellTokens.workArea.background,
      }}
    >
      {/* 1. Staff-world label strip + moment picker + Exit (AC1/AC2/AC3/AC5). */}
      <Stack
        direction="row"
        data-testid="preview-bar"
        sx={{
          alignItems: 'center',
          gap: 1.25,
          bgcolor: staffShellTokens.toolstrip.background,
          border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
          borderRadius: '10px',
          px: 1.5,
          py: 1,
          flex: 'none',
          flexWrap: 'wrap',
        }}
      >
        <Typography
          data-testid="preview-bar-label"
          sx={{
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: '0.12em',
            color: staffShellTokens.accent.cadenceRed,
            whiteSpace: 'nowrap',
          }}
        >
          PREVIEW AS PARTICIPANT — READ-ONLY
        </Typography>

        <Stack
          direction="row"
          role="radiogroup"
          aria-label="Preview scenario moment"
          data-testid="preview-moment-picker"
          sx={{ gap: 0.75 }}
        >
          {PREVIEW_MOMENT_ORDER.map(id => (
            <MomentChip
              key={id}
              id={id}
              label={getPreviewMomentConfig(id).label}
              selected={moment === id}
              onSelect={setMoment}
            />
          ))}
        </Stack>

        <Box sx={{ flex: 1 }} />

        <Typography
          sx={{
            fontSize: 10.5,
            fontWeight: 500,
            color: staffShellTokens.accent.secondaryText,
            whiteSpace: 'nowrap',
          }}
        >
          Nothing here reaches the exercise
        </Typography>

        <Box
          component="button"
          type="button"
          data-testid="preview-exit"
          onClick={toggle}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.625,
            border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
            borderRadius: '999px',
            background: 'transparent',
            color: staffShellTokens.accent.secondaryText,
            font: '700 11px ui-sans-serif, system-ui, sans-serif',
            px: 1.25,
            py: 0.625,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
            flex: 'none',
          }}
        >
          <FontAwesomeIcon icon={faXmark} size="sm" />
          Exit preview
        </Box>
      </Stack>

      {/* 2. The stage: a neutral staff-world mat framing the participant-world render. */}
      <Box
        data-testid="preview-stage"
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          bgcolor: '#e9edf1',
          border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
          borderRadius: '12px',
          p: { xs: 1.5, md: 3 },
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <Box
          sx={{
            width: '100%',
            maxWidth: 820,
            borderRadius: '8px',
            overflow: 'hidden',
            boxShadow: '0 18px 50px rgba(0, 0, 0, 0.22)',
            alignSelf: 'flex-start',
          }}
        >
          <ShellContextProvider value={mountProps}>
            <PortalStub momentConfig={momentConfig} />
          </ShellContextProvider>
        </Box>
      </Box>
    </Stack>
  )
}

interface MomentChipProps {
  id: PreviewMoment
  label: string
  selected: boolean
  onSelect: (id: PreviewMoment) => void
}

/**
 * One moment chip — a real `<button>` (via MUI's `component="button"`, so it
 * is natively focusable and Enter/Space-activatable, NFR-001) carrying
 * `role="radio"` + `aria-checked` so assistive tech announces the
 * mutually-exclusive selection (AC2/AC5). Selection is never color-only: the
 * selected chip also gets a filled background AND `aria-checked="true"`.
 */
function MomentChip({ id, label, selected, onSelect }: MomentChipProps) {
  return (
    <Box
      component="button"
      type="button"
      role="radio"
      aria-checked={selected}
      data-testid={`preview-moment-${id}`}
      onClick={() => onSelect(id)}
      sx={{
        font: '700 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        padding: '5px 12px',
        borderRadius: '999px',
        border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        color: selected ? '#fff' : staffShellTokens.accent.secondaryText,
        background: selected ? staffShellTokens.header.background : 'transparent',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </Box>
  )
}
