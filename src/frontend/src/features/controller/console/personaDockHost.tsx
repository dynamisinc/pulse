/**
 * features/controller/console/personaDockHost.tsx
 * ---------------------------------------------------------------------------
 * The console-owned PERSONA-DOCK HOST flyout mount slot (feature:
 * console-shell, story 01 — "Toolstrip + flyouts"; D5-004/015/017/018,
 * D7-011; see docs/features/console-shell/01-toolstrip-flyouts.md AC
 * "Persona-dock host").
 *
 * A named flyout that `persona-operation`'s picker → composer → context panel
 * render INTO at the serial integration step (via the `slots` prop — an INPUT
 * contract, never an import of `persona-operation`'s files). This story ships
 * the host CHROME only: the positioned COBRA panel, its header + close, its
 * a11y wiring, and a neutral placeholder while the slots are empty.
 *
 * ## Positioning — within the console work area, never a portal
 * Absolutely positioned flush against the console work area's right edge
 * (`right: 0`), spanning its full height (`top/bottom: 0`) — mirroring the
 * evaluator's `AnnotationsFlyout`. It is rendered INSIDE the console (which
 * sits left of the shell's 56px toolstrip), so it anchors to the work area's
 * own edge, not the toolstrip's. The console root is the `position: relative`
 * context (see `ControllerConsole`). Rendered as an ordinary descendant
 * (deliberately NOT `createPortal(document.body)`) so it stays inside the
 * staff frame and unmounts/rebinds with it. Opening it does NOT displace the
 * (future) live-world / review-queue columns — it overlays them and closes
 * without disturbing their state (AC2).
 *
 * ## A11y (NFR-001)
 * `role="region"` + `aria-label` so a screen reader announces the flyout.
 * On open, focus moves to the close button (keyboard users land inside); Esc
 * closes; on close, focus returns to whatever opened it (captured on open) —
 * the "Personas" toolstrip button or the command palette trigger — so the AC
 * "focus returns to the toolstrip on flyout close" holds.
 *
 * World: staff (COBRA/Cadence) — `@/theme/styledComponents` + staff-shell
 * tokens; never a participant surface (XC-002).
 */

import { useEffect, useRef, type KeyboardEvent } from 'react'
import { Box, IconButton, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faXmark } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { PERSONA_DOCK_HOST_TITLE, type PersonaDockSlots } from './personaDockHost'

/** Flyout panel width — a touch wider than the admin flyout for compose content. */
const DOCK_WIDTH_PX = 380

export interface PersonaDockHostProps {
  /** Whether the dock is open (console-owned state — a persona is selected/active). */
  open: boolean
  /** Close the dock (clears the active persona in the console). */
  onClose: () => void
  /**
   * The persona-operation content slots (picker/composer/context panel). Empty
   * during the fan-out; filled at integration. See {@link PersonaDockSlots}.
   */
  slots?: PersonaDockSlots
}

/**
 * Renders the persona-dock host flyout while `open`. Empty of persona content
 * until the integration step fills `slots` — see module header. Returns focus
 * to the opener on close (AC), and closes on Esc.
 */
export function PersonaDockHost({ open, onClose, slots }: PersonaDockHostProps) {
  const closeButtonRef = useRef<HTMLButtonElement | null>(null)
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (open) {
      // Remember who opened us (the "Personas" toolstrip button or the palette
      // trigger) so focus can return there on close.
      openerRef.current = document.activeElement
      closeButtonRef.current?.focus()
      return
    }
    // On close, return focus to the opener if it is still in the document.
    const opener = openerRef.current
    if (opener instanceof HTMLElement && opener.isConnected) {
      opener.focus()
    }
    openerRef.current = null
  }, [open])

  if (!open) return null

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
    }
  }

  const hasSlotContent = Boolean(slots?.picker || slots?.composer || slots?.contextPanel)

  return (
    <Box
      data-testid="persona-dock-host"
      role="region"
      aria-label={PERSONA_DOCK_HOST_TITLE}
      onKeyDown={handleKeyDown}
      sx={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: DOCK_WIDTH_PX,
        bgcolor: staffShellTokens.toolstrip.background,
        borderLeft: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        boxShadow: '-16px 0 40px rgba(0, 0, 0, 0.14)',
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <Stack
        direction="row"
        sx={{
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 1.75,
          py: 1.5,
          borderBottom: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        }}
      >
        <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.12em' }}>
          {PERSONA_DOCK_HOST_TITLE.toUpperCase()}
        </Typography>
        <Tooltip title="Close">
          <IconButton
            ref={closeButtonRef}
            size="small"
            aria-label="Close post-as-persona panel"
            onClick={onClose}
            sx={{ color: staffShellTokens.accent.secondaryText }}
          >
            <FontAwesomeIcon icon={faXmark} size="sm" />
          </IconButton>
        </Tooltip>
      </Stack>

      {/* The named mount slots. `persona-operation` content renders here at
          integration; until then a neutral placeholder marks the seam. */}
      <Stack
        data-testid="persona-dock-slots"
        sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}
      >
        {slots?.contextPanel}
        {slots?.picker}
        {slots?.composer}

        {!hasSlotContent && (
          <Typography
            data-testid="persona-dock-placeholder"
            sx={{
              px: 1.75,
              py: 2,
              fontSize: 11.5,
              color: staffShellTokens.accent.secondaryText,
            }}
          >
            Persona picker, composer, and context panel mount here.
          </Typography>
        )}
      </Stack>
    </Box>
  )
}
