/**
 * features/controller/engine/components/SwampedModeToggle.tsx
 * ---------------------------------------------------------------------------
 * The lead-gated "swamped mode" control (feature: engine-review-cockpit,
 * story 03; ADP-040, D5-014/1.1, NFR-001, COR-015, XC-002). STAFF world — dark
 * COBRA operator chrome (matches `ReviewQueue`'s D5 tokens), MUI 9 `sx`-only
 * system props, FontAwesome icons only. Never mounted on a participant path.
 *
 * LEAD GATE (COR-015 "absent, not disabled"). A non-lead controller has NO way
 * to enable swamped mode from this control — the enable affordance is simply
 * ABSENT for them (not rendered greyed-out), rather than present-but-disabled,
 * so a non-lead never sees a control that looks like it might work. A non-lead
 * still sees the persistent on-state indicator when the exercise's lead has
 * turned it on (the exercise-scoped state is real regardless of who is
 * watching) — they just cannot flip it themselves.
 *
 * ON-STATE INDICATOR (NFR-001). While swamped mode is on, this renders a
 * persistent, unmissable TEXT + ICON banner — "TIMEOUT AUTO-SEND IS ACTIVE" —
 * never colour alone. It stays mounted for as long as `swampedMode` is true;
 * there is no dismiss.
 *
 * The hook backing this (`useSwampedMode`) does all of the gating/telemetry —
 * this component only renders its state and calls its setter.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, faToggleOn, faToggleOff } from '@fortawesome/free-solid-svg-icons'
import { Box, Stack, Typography } from '@mui/material'
import { useSwampedMode } from '../hooks/useSwampedMode'
// D5 dark operator-chrome tokens (matches `ReviewQueue`'s `chrome`). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'

export function SwampedModeToggle() {
  const { swampedMode, isLead, setSwampedMode } = useSwampedMode()

  return (
    <Stack
      data-testid="swamped-mode-toggle"
      sx={{
        gap: 0.75,
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      {/* The enable/disable affordance — LEAD ONLY. Absent (not disabled) for a
          non-lead controller (COR-015). */}
      {isLead && (
        <Box
          component="button"
          type="button"
          data-testid="swamped-mode-enable-toggle"
          role="switch"
          aria-checked={swampedMode}
          aria-label={
            swampedMode
              ? 'Swamped mode is on — turn off timeout auto-send'
              : 'Swamped mode is off — turn on timeout auto-send'
          }
          onClick={() => setSwampedMode(!swampedMode)}
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.5,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.03em',
            color: swampedMode ? chrome.amber : chrome.ink,
            bgcolor: 'transparent',
            border: `1px solid ${swampedMode ? chrome.amber : chrome.line}`,
            borderRadius: '7px',
            cursor: 'pointer',
            alignSelf: 'flex-start',
            '&:hover': { borderColor: chrome.amber },
          }}
        >
          <FontAwesomeIcon icon={swampedMode ? faToggleOn : faToggleOff} aria-hidden="true" />
          Swamped mode: {swampedMode ? 'ON' : 'OFF'}
        </Box>
      )}

      {/* The persistent on-state indicator — text + icon, never colour alone
          (NFR-001). Visible to every controller viewing this exercise, lead or
          not, for as long as swampedMode is true; no dismiss. */}
      {swampedMode && (
        <Stack
          direction="row"
          data-testid="swamped-mode-active-banner"
          role="status"
          aria-live="polite"
          sx={{
            alignItems: 'center',
            gap: 0.75,
            px: 1,
            py: 0.6,
            bgcolor: chrome.card,
            border: `1px solid ${chrome.amber}`,
            borderRadius: '7px',
          }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
          <Typography
            component="span"
            sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: chrome.amber }}
          >
            TIMEOUT AUTO-SEND IS ACTIVE
          </Typography>
          <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
            — swamped mode is on; expired timers publish instead of holding.
          </Typography>
        </Stack>
      )}

      {!isLead && !swampedMode && (
        <Typography
          data-testid="swamped-mode-non-lead-note"
          sx={{ fontSize: 10.5, color: chrome.inkFaint }}
        >
          Only the lead controller can enable swamped mode.
        </Typography>
      )}
    </Stack>
  )
}
