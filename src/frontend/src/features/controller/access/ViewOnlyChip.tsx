/**
 * features/controller/access/ViewOnlyChip.tsx
 * ---------------------------------------------------------------------------
 * The "View only" chip in the controller console's title row (demo-feedback story 11, #507;
 * DF-14). STAFF world: COBRA navy on white, FontAwesome icon, MUI 9 `sx`-only.
 *
 * It renders for anyone who is NOT a controller (`useCanControl()` false) and nothing for a
 * controller, so the controller's console is unchanged. The state is said in WORDS with an eye
 * icon beside them (never colour alone, NFR-001), and its `title` says why the write controls
 * are missing.
 */

import { Chip } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faEye } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { useCanControl } from './useCanControl'

const NAVY = staffShellTokens.header.background

/** "View only" for a non-controller; nothing for a controller. */
export function ViewOnlyChip() {
  const canControl = useCanControl()
  if (canControl) return null
  return (
    <Chip
      data-testid="console-view-only-chip"
      icon={<FontAwesomeIcon icon={faEye} aria-hidden="true" style={{ fontSize: 11 }} />}
      label="View only"
      size="small"
      title="You can watch this console. Only a controller can change the exercise."
      sx={{
        fontWeight: 800,
        fontSize: 10.5,
        letterSpacing: '.06em',
        textTransform: 'uppercase',
        borderRadius: '999px',
        border: `1px solid ${NAVY}`,
        bgcolor: '#eaf1f9',
        color: NAVY,
        '& .MuiChip-icon': { color: NAVY, ml: '6px' },
      }}
    />
  )
}
