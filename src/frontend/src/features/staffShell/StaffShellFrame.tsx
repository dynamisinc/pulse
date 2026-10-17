/**
 * features/staffShell/StaffShellFrame.tsx
 * ---------------------------------------------------------------------------
 * The COBRA theme boundary + staff-shell frame (feature: staff-shell, story
 * 05 — "Cadence chrome tokens + thumbnail-distinguishability gate"; D7-009,
 * COR-063; see docs/features/staff-shell/05-cadence-chrome-tokens.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell owns" /
 * §4 hard gates).
 *
 * This is the ONE place in the codebase COBRA is mounted for a staff surface:
 * `<ThemeProvider theme={cobraTheme}>` + `<CssBaseline />` wrap the entire
 * frame, so every staff surface (controller console, evaluator dashboard)
 * that renders inside it — and everything those surfaces render — reaches
 * COBRA (`@/theme/cobraTheme`, `@/theme/styledComponents`, `CobraStyles`)
 * simply by being a descendant. Nothing else needs to re-mount the theme.
 *
 * This is also the enforcement point for the two-worlds hard gate
 * (SHELL-CONTRACT §4): a staff surface must be thumbnail-distinguishable from
 * a participant surface — dark navy header + single top bar, never the light
 * world framed by two green compliance banners. **Participant surfaces must
 * never mount this component or import `staffShellTokens`** — that absence is
 * enforced mechanically by `twoWorldsSeparation.test.ts` in this folder. The
 * one deliberate, labelled exception is "Preview as participant" (story 04),
 * which stages the participant shell INSIDE this frame's work area.
 *
 * ## Layout
 * A full-height (100vh) CSS grid:
 *   - Row 1: the {@link STAFF_HEADER_HEIGHT_PX}px navy header (`header` slot).
 *   - Row 2: a work-area column (flex, renders `children`) beside a
 *     {@link STAFF_TOOLSTRIP_WIDTH_PX}px right-edge toolstrip dock column
 *     (`toolstrip` slot).
 *
 * ## Slot props, not owned components
 * This story does NOT build `StaffHeader` (01) or `Toolstrip`/`toolRegistry`
 * (02) — those are built in parallel and own their own files. `header` and
 * `toolstrip` are plain `ReactNode` slots so this frame has no dependency on
 * either. When a slot is omitted, its region still renders at the correct
 * size (empty), so the frame is layout-testable standalone and never depends
 * on the slots being filled.
 */

import type { ReactNode } from 'react'
import { Box } from '@mui/material'
import { ThemeProvider } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'
import { cobraTheme } from '@/theme/cobraTheme'
import { useOptionalPreview } from './previewContext'
import {
  STAFF_HEADER_HEIGHT_PX,
  STAFF_HEADER_HEIGHT_TABLET_PX,
  STAFF_COARSE_POINTER_MEDIA,
  STAFF_TABLET_MEDIA,
  STAFF_TOUCH_TARGET_PX,
  STAFF_TOOLSTRIP_WIDTH_PX,
  STAFF_TOOLSTRIP_WIDTH_TABLET_PX,
  staffShellTokens,
} from './staffShellTokens'

export interface StaffShellFrameProps {
  /**
   * The 56px navy header row's content (story 01's `<StaffHeader>`).
   * Optional so this frame is standalone-testable.
   */
  header?: ReactNode
  /**
   * The 56px right-edge toolstrip dock's content (story 02's `<Toolstrip>`).
   * Optional so this frame is standalone-testable.
   */
  toolstrip?: ReactNode
  /**
   * The work area — the staff surface (controller console, evaluator
   * dashboard) that owns everything inside it.
   */
  children: ReactNode
  /**
   * Shell-owned overlays that span the work-area + toolstrip row and pin
   * themselves against the toolstrip's edge — e.g. the shell-global
   * participant-admin flyout (story 03), which positions itself at
   * `right: STAFF_TOOLSTRIP_WIDTH_PX`. Rendered inside the row's positioning
   * context (below), NOT a `document.body` portal, so a shell-global flyout
   * stays within the staff frame (SHELL-CONTRACT §1) and never escapes it.
   * Optional so the frame is standalone-testable.
   */
  globalOverlay?: ReactNode
}

/**
 * The staff-world COBRA theme boundary + Cadence chrome frame. See the module
 * header for the theme-boundary/two-worlds contract this component enforces.
 */
export function StaffShellFrame({
  header,
  toolstrip,
  children,
  globalOverlay,
}: StaffShellFrameProps) {
  // While "Preview as participant" is staged the work area hosts the real Social channel, which
  // brings its own `<main>`. A page has ONE main landmark (WCAG 1.3.1 / 2.4.1; a screen-reader user
  // jumps to "the" main), so the work area stops being one for as long as the preview is up and
  // becomes a plain container; the PREVIEW's labelled region + the channel's main carry the
  // landmarks. Without a `PreviewProvider` (the planner workspace) it is always `main`.
  const previewStaged = useOptionalPreview()?.active === true
  return (
    <ThemeProvider theme={cobraTheme}>
      <CssBaseline />
      <Box
        data-testid="staff-shell-frame"
        sx={{
          height: '100vh',
          display: 'grid',
          gridTemplateRows: `${STAFF_HEADER_HEIGHT_PX}px minmax(0, 1fr)`,
          // `minmax(0, 1fr)` (not the implicit `auto`) so an over-wide header/work-area child can
          // never stretch the frame past the viewport and push the toolstrip off-screen (story 13:
          // at 1180 the header's min-content was 1190 and clipped the toolstrip).
          gridTemplateColumns: 'minmax(0, 1fr)',
          [STAFF_TABLET_MEDIA]: {
            gridTemplateRows: `${STAFF_HEADER_HEIGHT_TABLET_PX}px minmax(0, 1fr)`,
          },
        }}
      >
        <Box
          component="header"
          data-testid="staff-shell-header"
          sx={{
            height: STAFF_HEADER_HEIGHT_PX,
            minHeight: 0,
            minWidth: 0,
            [STAFF_TABLET_MEDIA]: { height: STAFF_HEADER_HEIGHT_TABLET_PX },
            bgcolor: staffShellTokens.header.background,
            borderBottom: `1px solid ${staffShellTokens.header.borderColor}`,
            color: staffShellTokens.header.textPrimary,
          }}
        >
          {header}
        </Box>

        <Box
          sx={{
            // Positioning context for `globalOverlay` (shell-global flyouts
            // pin themselves against the toolstrip edge, e.g. right: 56px).
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: `minmax(0, 1fr) ${STAFF_TOOLSTRIP_WIDTH_PX}px`,
            minHeight: 0,
            minWidth: 0,
            [STAFF_TABLET_MEDIA]: {
              gridTemplateColumns: `minmax(0, 1fr) ${STAFF_TOOLSTRIP_WIDTH_TABLET_PX}px`,
            },
            // Persona dock host (controller/console/personaDockHost.tsx, story 12's file): it
            // predates `staffFlyout.ts` and is not edited here. Until it adopts the helper the
            // frame applies the SAME contract to it from outside: clamp to the viewport, sit
            // below `--staff-flyout-top`, and a 44px close button under a coarse pointer.
            '& [data-testid="persona-dock-host"]': {
              maxWidth: '100%',
              top: `var(${staffShellTokens.flyout.topVar}, 0px)`,
            },
            [STAFF_COARSE_POINTER_MEDIA]: {
              '& [data-testid="persona-dock-host"] button[aria-label^="Close"]': {
                width: STAFF_TOUCH_TARGET_PX,
                height: STAFF_TOUCH_TARGET_PX,
              },
            },
          }}
        >
          <Box
            component={previewStaged ? 'div' : 'main'}
            data-testid="staff-shell-work-area"
            sx={{
              minHeight: 0,
              overflow: 'auto',
              bgcolor: staffShellTokens.workArea.background,
            }}
          >
            {children}
          </Box>

          <Box
            component="nav"
            aria-label="Staff toolstrip"
            data-testid="staff-shell-toolstrip"
            sx={{
              width: STAFF_TOOLSTRIP_WIDTH_PX,
              [STAFF_TABLET_MEDIA]: { width: STAFF_TOOLSTRIP_WIDTH_TABLET_PX },
              minHeight: 0,
              overflow: 'auto',
              bgcolor: staffShellTokens.toolstrip.background,
              borderLeft: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
            }}
          >
            {toolstrip}
          </Box>

          {globalOverlay}
        </Box>
      </Box>
    </ThemeProvider>
  )
}
