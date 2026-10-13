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
 * conditional restore the prior work area. Because it is a swap, the work
 * area UNMOUNTS while the preview is up: see "WHAT THE SWAP COSTS" below.
 *
 * Anatomy, top → bottom (matches `Pulse Staff Shell.dc.html`'s `.pvbar` /
 * `.pvstage`):
 *  1. A staff-world (COBRA) label strip, UNMISTAKABLY marking the stage as a
 *     preview ("PREVIEW AS PARTICIPANT — READ-ONLY") + an Exit control that
 *     calls `toggle()` and hands focus back to the header's preview toggle
 *     (the Exit button unmounts with the stage; focus must not fall to <body>).
 *  2. The stage itself: a neutral staff-world mat framing the PARTICIPANT-
 *     WORLD render — `PreviewChannelHost` (`./PreviewChannelHost`), which mounts
 *     the real `SocialChannel` under `ShellContextProvider { variant: 'preview',
 *     scenarioNow }`, the brand providers, an in-memory navigation provider and
 *     a read-only session scope. See that file's header for the composition, why
 *     nothing in it can write, and why a link inside it never moves the staff
 *     page. The host sits inside `PreviewErrorBoundary`: a render error in the
 *     channel shows "Participant preview unavailable" there and never reaches
 *     the app's fail-closed boundary (which would redirect to /login); the
 *     strip and Exit are siblings of the boundary and keep working.
 *
 * NO MOMENT PICKER (amended after Gate-1; story 23, AC1). The STARTEX / ADVISORY /
 * BURST / NOW picker this strip used to carry is NOT rendered. The Social channel
 * dates every post from the live scenario clock (`useScenarioTime`), not from the
 * shell mount's `scenarioNow`, so choosing a moment changed nothing the audience
 * could see — on stage, worse than no picker. The moment MODEL and its context
 * (`../previewContext`) are kept for a channel that can honour one; until then the
 * stage mounts the channel at its default moment, `now` — the live scenario clock.
 * Scenario time only (COR-053), never wall-clock.
 *
 * WHAT THE SWAP COSTS (decided, not accidental). The console's work area unmounts for
 * as long as the preview is up, so React state it held is gone on Exit. What SURVIVES
 * lives above the swap or in a module store: the active persona (`ActivePersonaProvider`),
 * persona-composer drafts and the reply they were written against (the draft store; the
 * composer restores the reply when it remounts), the engine / review queue data
 * (module stores) and the toolstrip. What is LOST: an open inline edit in a console
 * panel (a run-sheet item, a review-queue draft edit), whether the persona dock was open,
 * and panel scroll positions. See the controller `lifecycle` README for the full list.
 *
 * The mat is sized for the channel's own frame (nav rail | 600px main | sidebar,
 * `previewFrameMetrics`) and scrolls (it does not shrink the frame): the channel's
 * responsive breakpoints are VIEWPORT media queries, so the frame is given the
 * width the matching breakpoint assumes and the mat scrolls when the work area
 * is narrower. The frame is a containing block for `position: fixed` (a
 * transform), so the channel's skip link and any fixed element stay inside the
 * frame instead of landing on the staff header. (The media viewer is portalled to
 * <body> and, while open, covers the staff chrome until Esc — accepted for the demo.)
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
import { resolvePreviewMomentInstant, usePreview } from '../previewContext'
import { PreviewChannelHost } from './PreviewChannelHost'
import { PreviewErrorBoundary } from './PreviewErrorBoundary'

/**
 * The header's "Preview as participant" toggle. It stays mounted across the work-area swap, so
 * it is where focus returns when Exit unmounts the stage.
 */
const HEADER_PREVIEW_TOGGLE_SELECTOR = '[data-testid="staff-header-preview-toggle"]'

export function PreviewAsParticipant() {
  const { moment, toggle } = usePreview()

  // One instant per selected moment (always the default, `now`, while no picker is rendered): the
  // channel below must not re-render (and every memoized feed row with it) because the staff
  // strip did.
  const momentInstant = useMemo(() => resolvePreviewMomentInstant(moment), [moment])

  // Exit unmounts this stage, and the button the keyboard user pressed with it: hand focus to the
  // header toggle (still mounted) in the same gesture so it never falls to <body> (NFR-001).
  const exit = () => {
    toggle()
    document.querySelector<HTMLElement>(HEADER_PREVIEW_TOGGLE_SELECTOR)?.focus()
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
      {/* 1. Staff-world label strip + Exit (AC1/AC3/AC5). */}
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
          onClick={exit}
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
          <PreviewErrorBoundary>
            <PreviewChannelHost scenarioNow={momentInstant} />
          </PreviewErrorBoundary>
        </Box>
      </Box>
    </Stack>
  )
}
