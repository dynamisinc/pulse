/**
 * features/staffShell/components/PreviewAsParticipant.tsx
 * ---------------------------------------------------------------------------
 * "Preview as participant" STAGE (feature: staff-shell, story 04 — COR-041;
 * see docs/features/staff-shell/04-preview-as-participant.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Variants" →
 * preview-as-participant). Reworked by demo-polish C6 (docs/features/demo-polish/
 * 23-preview-and-startex.md, #442): the stage now hosts the REAL participant
 * Social channel instead of the `PortalStub` mock.
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
 *     Exit control that calls `toggle()`. UNCHANGED by C6.
 *  2. The stage itself: a neutral staff-world mat framing the PARTICIPANT-
 *     WORLD render — `PreviewChannelHost` (`./PreviewChannelHost`), which mounts
 *     the real `SocialChannel` under `ShellContextProvider { variant: 'preview',
 *     scenarioNow: <the selected moment's instant> }`, the brand providers, an
 *     in-memory navigation provider and a read-only session scope. See that
 *     file's header for the composition, why nothing in it can write, and why a
 *     link inside it never moves the staff page.
 *
 * The picker hands the participant render the selected moment's instant (via
 * `resolvePreviewMomentInstant`) through the shell mount contract — always
 * scenario time, never wall-clock (COR-053). NOTE: the Social channel's own
 * per-post ages ("2h ago") come from the live scenario clock (`useScenarioTime`),
 * not from the shell mount's `scenarioNow`, so choosing a moment re-times what a
 * channel reads from the mount contract but does not re-date the feed's posts.
 *
 * The mat is sized for the channel's own frame (nav rail | 600px main | sidebar,
 * `previewFrameMetrics`) and scrolls (it does not shrink the frame): the channel's
 * responsive breakpoints are VIEWPORT media queries, so the frame is given the
 * width the matching breakpoint assumes and the mat scrolls when the work area
 * is narrower. The frame is a containing block for `position: fixed` (a
 * transform), so the channel's skip link and any fixed element stay inside the
 * frame instead of landing on the staff header.
 *
 * World: staff (COBRA/Cadence) for THIS component's own chrome (the label
 * strip + stage mat, `staffShellTokens`-sourced). `PreviewChannelHost`, mounted
 * below, is the ONE deliberate exception the hard gate carves out
 * (SHELL-CONTRACT §4): a staff-world frame hosting a labelled
 * participant-world render, never the reverse. That split is why the participant
 * half is its own file: it is scanned for COBRA imports on its own
 * (`previewStubTwoWorlds.test.ts`), and this file is scanned for the opposite —
 * no participant tokens in the staff strip.
 */

import { useMemo } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '../staffShellTokens'
import { PREVIEW_FRAME_FULL_WIDTH_PX, PREVIEW_FRAME_NAV_WIDTH_PX } from '../previewFrameMetrics'
import {
  getPreviewMomentConfig,
  PREVIEW_MOMENT_ORDER,
  resolvePreviewMomentInstant,
  usePreview,
  type PreviewMoment,
} from '../previewContext'
import { PreviewChannelHost } from './PreviewChannelHost'

export function PreviewAsParticipant() {
  const { moment, setMoment, toggle } = usePreview()

  // One instant per selected moment: the channel below must not re-render (and every
  // memoized feed row with it) because the staff strip did.
  const momentInstant = useMemo(() => resolvePreviewMomentInstant(moment), [moment])

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
        }}
      >
        <Box
          data-testid="preview-frame"
          sx={{
            width: '100%',
            maxWidth: PREVIEW_FRAME_FULL_WIDTH_PX,
            // Centered when there is room, start-aligned (never clipped on the left)
            // when the mat scrolls.
            mx: 'auto',
            borderRadius: '8px',
            // `clip`, not `hidden`: `hidden` would make this the scroll container the
            // channel's sticky rails bind to; they must bind to the mat.
            overflow: 'clip',
            boxShadow: '0 18px 50px rgba(0, 0, 0, 0.22)',
            alignSelf: 'flex-start',
            // A transform makes this the containing block for `position: fixed`
            // descendants (the channel's skip link), keeping them off the staff header.
            transform: 'translateZ(0)',
            // The channel's breakpoints are VIEWPORT media queries (3 columns at
            // >= 1184px, nav + main at >= 840px): give the frame the width the matching
            // breakpoint lays out for, and let the mat scroll when the work area is narrower.
            [`@media (min-width: ${PREVIEW_FRAME_FULL_WIDTH_PX}px)`]: {
              minWidth: PREVIEW_FRAME_FULL_WIDTH_PX,
            },
            [`@media (min-width: ${PREVIEW_FRAME_NAV_WIDTH_PX}px) and (max-width: ${PREVIEW_FRAME_FULL_WIDTH_PX - 1}px)`]: {
              minWidth: PREVIEW_FRAME_NAV_WIDTH_PX,
            },
          }}
        >
          <PreviewChannelHost scenarioNow={momentInstant} />
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
