/**
 * features/controller/console/ConsoleSteeringDisclosure.tsx
 * ---------------------------------------------------------------------------
 * The tablet "Steering" disclosure row (feature: mobile-tablet, story 12; D5-026, signed by
 * Tom 10/16: "Escalation dial one tap away by default: yes"). STAFF world.
 *
 * At tablet widths the work area is too tight to keep `EscalationDial` and `NoiseControl` open
 * all the time, so they live behind ONE disclosure button that is COLLAPSED BY DEFAULT. While
 * collapsed the button carries a one-line TEXT summary, "Storyline target 60 · Noise Medium",
 * so the controller can read both without opening it. The button is a toggle
 * (`aria-expanded`, `aria-controls`), at least 44px tall, with a chevron icon that is
 * decoration only: the state is the word "Steering" plus the summary plus `aria-expanded`
 * (never colour alone, NFR-001).
 *
 * BOTH controls stay MOUNTED while collapsed (hidden with `display: none`), so a half-dragged
 * dial, the noise poll and any pending write are not torn down by closing the row, and the
 * noise level reaches the summary through `NoiseControl`'s `onLevelChange` (no second poll).
 * `PausePill` is NOT here: it is in the command band (D5-023). Roles are unchanged: the dial and
 * the noise knob are read-only for a non-controller exactly as on the desktop console.
 */

import { useId, useState } from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faChevronDown, faChevronRight, faSliders } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import CobraStyles from '@/theme/CobraStyles'
import { useStorylineTarget } from '../hooks/useStorylineTarget'
import { EscalationDial } from '../components/steering/EscalationDial'
import { NoiseControl, type NoiseLevel } from '../noise'
import { steeringSummary } from './steeringSummary'

const NAVY = staffShellTokens.header.background
const MUTED = staffShellTokens.accent.secondaryText

export function ConsoleSteeringDisclosure() {
  const [open, setOpen] = useState(false)
  const [noise, setNoise] = useState<NoiseLevel | undefined>(undefined)
  const storyline = useStorylineTarget()
  const regionId = useId()
  const target = storyline.dataStatus === 'live' ? storyline.targetIntensity : 'unknown'

  return (
    <Box data-testid="console-steering-disclosure">
      <Box
        component="button"
        type="button"
        data-testid="console-steering-toggle"
        aria-expanded={open}
        aria-controls={regionId}
        onClick={() => setOpen(current => !current)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: CobraStyles.Spacing.IconAndText,
          width: '100%',
          minHeight: 44,
          px: CobraStyles.Spacing.FormFields,
          textAlign: 'left',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: 12,
          color: NAVY,
          bgcolor: staffShellTokens.toolstrip.background,
          border: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
          borderRadius: '4px',
          '&:focus-visible': { outline: `2px solid ${NAVY}`, outlineOffset: '2px' },
        }}
      >
        <FontAwesomeIcon icon={open ? faChevronDown : faChevronRight} aria-hidden="true" />
        <FontAwesomeIcon icon={faSliders} aria-hidden="true" />
        <Box component="span" sx={{ fontWeight: 800, letterSpacing: '0.06em' }}>STEERING</Box>
        {!open && (
          <Box
            component="span"
            data-testid="console-steering-summary"
            sx={{ color: MUTED, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {steeringSummary(target, noise)}
          </Box>
        )}
      </Box>
      <Box
        id={regionId}
        data-testid="world-steering-panel"
        sx={{
          display: open ? 'flex' : 'none',
          flexDirection: 'column',
          gap: CobraStyles.Spacing.FormFields,
          pt: CobraStyles.Spacing.FormFields,
        }}
      >
        <NoiseControl onLevelChange={setNoise} />
        <Box sx={{ maxWidth: 520 }}>
          <EscalationDial />
        </Box>
      </Box>
    </Box>
  )
}
