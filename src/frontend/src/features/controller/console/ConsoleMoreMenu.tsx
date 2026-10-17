/**
 * features/controller/console/ConsoleMoreMenu.tsx
 * ---------------------------------------------------------------------------
 * The tablet title row's "More" (ellipsis) menu (feature: mobile-tablet, story 12; D5-026).
 * STAFF world. At tablet widths "Export posts" and "Exercise report" leave the title row and
 * live behind this one button. The two buttons are the SAME components the desktop title row
 * renders (`ExportPostsButton`, `ExerciseReportButton`), unchanged: this only gives them a home.
 *
 * It is a popover, not an action list: an export reports its progress, success and failure
 * next to its button, so the popover stays mounted (`keepMounted`) and stays open until the
 * controller dismisses it (Escape, a tap outside, or the Close button), rather than closing the
 * moment a button is pressed and swallowing that message. The trigger is at least 44px square,
 * labelled "More actions" with `aria-haspopup` / `aria-expanded`.
 */

import { useState } from 'react'
import { Box, Popover } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEllipsis } from '@fortawesome/free-solid-svg-icons'
import { CobraLinkButton, CobraSecondaryButton } from '@/theme/styledComponents'
import CobraStyles from '@/theme/CobraStyles'
import { ExportPostsButton } from '../export'
import { ExerciseReportButton } from '../report'

export function ConsoleMoreMenu() {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const close = () => setAnchor(null)

  return (
    <>
      <CobraSecondaryButton
        data-testid="console-more-menu"
        aria-label="More actions"
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        onClick={event => setAnchor(event.currentTarget)}
        sx={{ minWidth: 44, minHeight: 44 }}
      >
        <FontAwesomeIcon icon={faEllipsis} aria-hidden="true" />
      </CobraSecondaryButton>
      <Popover
        open={anchor !== null}
        anchorEl={anchor}
        onClose={close}
        keepMounted
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { 'aria-label': 'More actions' } }}
      >
        <Box
          data-testid="console-more-menu-panel"
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: CobraStyles.Spacing.FormFields,
            p: CobraStyles.Padding.PopoverContent,
            // 44px targets for the two buttons (touch), whatever their desktop size.
            '& .MuiButton-root': { minHeight: 44 },
          }}
        >
          <ExportPostsButton />
          <ExerciseReportButton />
          <CobraLinkButton onClick={close} sx={{ minHeight: 44 }}>Close</CobraLinkButton>
        </Box>
      </Popover>
    </>
  )
}
