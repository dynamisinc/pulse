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
 * PHASE 1 GOVERNANCE (PROVIDER-GOVERNANCE §8). When the engine settings report
 * `timeoutAutoSendAuthorized === false`, the server refuses swamped mode ON, so
 * the ON control is DISABLED (it is a real control that cannot work here yet,
 * not a role gate) with a text + icon note it is described by. Turning an
 * already-on switch OFF is never blocked.
 *
 * The hook backing this (`useSwampedMode`) does all of the gating/telemetry —
 * this component only renders its state and calls its setter.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleInfo,
  faTriangleExclamation,
  faToggleOn,
  faToggleOff,
} from '@fortawesome/free-solid-svg-icons'
import { Box, Stack, Typography } from '@mui/material'
import { useSwampedMode } from '../hooks/useSwampedMode'
import { useEngineSettings } from '../hooks/useEngineSettings'
// D5 dark operator-chrome tokens (matches `ReviewQueue`'s `chrome`). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'
import { useCanControl } from '../../access'

export function SwampedModeToggle() {
  const { swampedMode, isLead, setSwampedMode } = useSwampedMode()
  const canControl = useCanControl()
  const settings = useEngineSettings().settings
  // Hold-on-cut (ADP-042): while cut to Fake, expiries hold even under swamped mode.
  const providerCutToFake = settings?.providerCutToFake ?? false
  // Phase 1 (PROVIDER-GOVERNANCE §8): the server refuses swamped ON while the
  // governed flag is false. Only an explicit `false` disables; OFF stays open.
  const onRefused = settings?.timeoutAutoSendAuthorized === false && !swampedMode

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
      {canControl && isLead && (
        <Box
          component="button"
          type="button"
          data-testid="swamped-mode-enable-toggle"
          role="switch"
          aria-checked={swampedMode}
          disabled={onRefused}
          aria-describedby={onRefused ? 'swamped-mode-not-authorized-note' : undefined}
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
            '&:disabled': {
              cursor: 'not-allowed',
              color: chrome.inkFaint,
              borderColor: chrome.line,
            },
          }}
        >
          <FontAwesomeIcon icon={swampedMode ? faToggleOn : faToggleOff} aria-hidden="true" />
          Swamped mode: {swampedMode ? 'ON' : 'OFF'}
        </Box>
      )}

      {canControl && isLead && onRefused && (
        <Stack
          direction="row"
          id="swamped-mode-not-authorized-note"
          data-testid="swamped-mode-not-authorized-note"
          sx={{ alignItems: 'center', gap: 0.75 }}
        >
          <FontAwesomeIcon icon={faCircleInfo} color={chrome.inkMuted} aria-hidden="true" />
          <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
            Timeout auto-send is off until the lead-controller role ships.
          </Typography>
        </Stack>
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
            {providerCutToFake ? 'TIMEOUT AUTO-SEND IS SUSPENDED' : 'TIMEOUT AUTO-SEND IS ACTIVE'}
          </Typography>
          <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkMuted }}>
            {providerCutToFake
              ? '— swamped mode is on, but auto-send is SUSPENDED while generation is cut to Fake; expired timers hold.'
              : '— swamped mode is on; expired timers publish instead of holding.'}
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
