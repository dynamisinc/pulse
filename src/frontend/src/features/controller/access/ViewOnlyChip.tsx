/**
 * features/controller/access/ViewOnlyChip.tsx
 * ---------------------------------------------------------------------------
 * The "View only" chip in the controller console's title row (demo-feedback story 11, #507;
 * DF-14). STAFF world: COBRA navy on the COBRA work-area grey (staff shell tokens), FontAwesome
 * icon, MUI 9 `sx`-only.
 *
 * It renders for anyone who is NOT a controller (`useCanControl()` false) and nothing for a
 * controller, so the controller's console is unchanged. The state is said in WORDS with an eye
 * icon beside them (never colour alone, NFR-001). WHY the write controls are missing is part of
 * the chip's text, visually hidden, so a screen reader reads it with the label (Gate-1 L-2: a
 * `title` reaches mouse users only).
 */

import { Box, Chip } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye, faPenRuler } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { useCanControl, useCanEditContent } from './useCanControl'

const NAVY = staffShellTokens.header.background

/** Visually hidden, still read by assistive technology. */
const SR_ONLY = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
} as const

const CHIP_SX = {
  fontWeight: 800,
  fontSize: 10.5,
  letterSpacing: '.06em',
  textTransform: 'uppercase',
  borderRadius: '999px',
  border: `1px solid ${NAVY}`,
  bgcolor: staffShellTokens.workArea.background,
  color: NAVY,
  '& .MuiChip-icon': { color: NAVY, ml: '6px' },
} as const

/** The reason, read after the label. */
const VIEW_ONLY_REASON =
  'You can watch this console. Only a controller can change the exercise.'

/** The planner's role-accurate reason (WR-002): they hold the content tools, not conduct. */
const PLANNER_REASON = 'You can edit content here. Only a controller can run the exercise.'

/**
 * "View only" for a non-controller who cannot edit content (evaluator); "Planner: content only"
 * for a planner (who holds the edit tools); nothing for a controller.
 */
export function ViewOnlyChip() {
  const canControl = useCanControl()
  const canEditContent = useCanEditContent()
  if (canControl) return null
  if (canEditContent) {
    return (
      <Chip
        data-testid="console-planner-chip"
        icon={<FontAwesomeIcon icon={faPenRuler} aria-hidden="true" style={{ fontSize: 11 }} />}
        label={
          <>
            Planner: content only. Conduct is controller-only
            <Box component="span" data-testid="console-planner-reason" sx={SR_ONLY}>
              {`. ${PLANNER_REASON}`}
            </Box>
          </>
        }
        size="small"
        sx={CHIP_SX}
      />
    )
  }
  return (
    <Chip
      data-testid="console-view-only-chip"
      icon={<FontAwesomeIcon icon={faEye} aria-hidden="true" style={{ fontSize: 11 }} />}
      label={
        <>
          View only
          <Box component="span" data-testid="console-view-only-reason" sx={SR_ONLY}>
            {`. ${VIEW_ONLY_REASON}`}
          </Box>
        </>
      }
      size="small"
      sx={CHIP_SX}
    />
  )
}
