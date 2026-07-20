/**
 * features/controller/components/steering/PausePill.tsx
 * ---------------------------------------------------------------------------
 * The tiered-pause CONTROL (feature: world-steering, story 03; CTL-023,
 * D5-014/1.3, NFR-001, XC-002). STAFF world — dark COBRA operator chrome
 * (matches `SwampedModeToggle`/`ReviewQueue` D5 tokens), MUI 9 `sx`-only system
 * props, FontAwesome icons only. Never mounted on a participant path, and it
 * NEVER renders the participant pause/freeze overlay — that is
 * `participant-shell`'s `OverlayLayer`; this control only TRIGGERS state via
 * `usePauseState()`.
 *
 * STATE AS DOT + TEXT, never colour-only (NFR-001). The pill always shows the
 * active tier's LABEL text beside a status dot — the dot's colour is decorative
 * reinforcement, never the sole signal.
 *
 * THE PAUSE POPOVER (D5-014/1.3). Opening the pill reveals three radio tiers —
 * Pause injects / Pause engine / Freeze world — with Cancel + a primary action.
 * The primary reads "Resume" while paused. FREEZE IS GUARDED: choosing Freeze
 * routes through a deliberate confirm step before it takes effect, because
 * participants notice a world freeze. This is a confirm-step guard, NOT a
 * Director role-gate (that pattern belongs to Break Fiction, story 04).
 *
 * FULLY KEYBOARD-OPERABLE (NFR-001). The pill is a button (Enter/Space); the
 * popover traps focus; the radios are arrow/Tab navigable; every action is a
 * button; Escape dismisses the popover and the confirm step.
 */

import { useEffect, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCirclePause,
  faPause,
  faPlay,
  faSnowflake,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import {
  Box,
  FormControlLabel,
  Popover,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import { usePauseState, type PauseTier } from '../../hooks/usePauseState'

/** D5 dark operator-chrome tokens (matches `SwampedModeToggle`). Staff-only. */
const chrome = {
  card: '#111c2b',
  line: '#28384b',
  ink: '#e9eff7',
  inkMuted: '#9db1c8',
  inkFaint: '#63758b',
  running: '#37c46b',
  paused: '#4a90d9',
  amber: '#f5a623',
} as const

/** The tiers a controller can SELECT to pause (excludes the `running` baseline). */
type PauseChoice = Exclude<PauseTier, 'running'>

interface TierOption {
  readonly value: PauseChoice
  readonly label: string
  readonly hint: string
  readonly amber: boolean
}

const TIER_OPTIONS: readonly TierOption[] = [
  { value: 'injects', label: 'Pause injects', hint: 'World keeps living', amber: false },
  { value: 'engine', label: 'Pause engine', hint: 'No new AI content', amber: false },
  { value: 'freeze', label: 'Freeze world', hint: 'Participants notice — guarded', amber: true },
]

/** The dot colour for each tier — decorative reinforcement of the label text. */
const TIER_DOT: Readonly<Record<PauseTier, string>> = {
  running: chrome.running,
  injects: chrome.paused,
  engine: chrome.paused,
  freeze: chrome.amber,
}

/**
 * The tiered-pause pill + popover. Reads/drives the shared pause fact via
 * `usePauseState()`; renders the active tier as dot + text and the D5 pause
 * popover (three radio tiers, guarded Freeze confirm, Resume while paused).
 */
export function PausePill() {
  const { tier, label, isPaused, setTier, resume } = usePauseState()

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const [choice, setChoice] = useState<PauseChoice>('injects')
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)

  // Each time the popover opens, seed the radio from the active tier (or the
  // first option when running) and clear any stale confirm step.
  useEffect(() => {
    if (!open) return
    setChoice(tier === 'running' ? 'injects' : tier)
    setConfirmingFreeze(false)
  }, [open, tier])

  const closePopover = () => {
    setAnchorEl(null)
    setConfirmingFreeze(false)
  }

  const applyChoice = () => {
    // Freeze is guarded — route through the confirm step, don't apply yet.
    if (choice === 'freeze') {
      setConfirmingFreeze(true)
      return
    }
    setTier(choice)
    closePopover()
  }

  const confirmFreeze = () => {
    setTier('freeze')
    closePopover()
  }

  const handleResume = () => {
    resume()
    closePopover()
  }

  return (
    <>
      <Box
        component="button"
        type="button"
        data-testid="pause-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Pause control — current state: ${label}`}
        onClick={event => setAnchorEl(anchorEl ? null : event.currentTarget)}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          fontFamily: "'Figtree', system-ui, sans-serif",
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.04em',
          color: isPaused ? chrome.amber : chrome.ink,
          bgcolor: chrome.card,
          border: `1px solid ${isPaused ? chrome.amber : chrome.line}`,
          borderRadius: '999px',
          cursor: 'pointer',
          '&:hover': { borderColor: chrome.amber },
        }}
      >
        {/* Dot — decorative reinforcement only; the label text is the real signal. */}
        <Box
          component="span"
          aria-hidden="true"
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: TIER_DOT[tier],
            flexShrink: 0,
          }}
        />
        <FontAwesomeIcon
          icon={isPaused ? faCirclePause : faPlay}
          aria-hidden="true"
          style={{ fontSize: 10 }}
        />
        <Typography component="span" sx={{ fontSize: 'inherit', fontWeight: 'inherit' }}>
          {label}
        </Typography>
      </Box>

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closePopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            'aria-label': 'Pause tiers',
            sx: {
              mt: 0.5,
              p: 1.5,
              width: 300,
              bgcolor: chrome.card,
              border: `1px solid ${chrome.line}`,
              borderRadius: '10px',
              fontFamily: "'Figtree', system-ui, sans-serif",
            },
          },
        }}
      >
        <Box data-testid="pause-popover">
          {confirmingFreeze ? (
            <Stack data-testid="pause-freeze-confirm" sx={{ gap: 1.25 }}>
              <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
                <FontAwesomeIcon
                  icon={faTriangleExclamation}
                  color={chrome.amber}
                  aria-hidden="true"
                />
                <Typography
                  component="span"
                  sx={{ fontSize: 12, fontWeight: 800, letterSpacing: '0.03em', color: chrome.amber }}
                >
                  FREEZE THE WORLD?
                </Typography>
              </Stack>
              <Typography sx={{ fontSize: 11.5, color: chrome.inkMuted, lineHeight: 1.4 }}>
                Everything stops and the scenario clock halts. Participants will see the pause
                page — this is a deliberate, visible safety stop.
              </Typography>
              <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end' }}>
                <CobraSecondaryButton
                  data-testid="pause-freeze-back"
                  onClick={() => setConfirmingFreeze(false)}
                >
                  Back
                </CobraSecondaryButton>
                <CobraPrimaryButton
                  data-testid="pause-freeze-confirm-button"
                  onClick={confirmFreeze}
                  startIcon={<FontAwesomeIcon icon={faSnowflake} />}
                >
                  Confirm freeze
                </CobraPrimaryButton>
              </Stack>
            </Stack>
          ) : (
            <Stack sx={{ gap: 1 }}>
              <Typography
                sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.05em', color: chrome.inkFaint }}
              >
                PAUSE TIERS
              </Typography>

              <RadioGroup
                aria-label="Pause tier"
                value={choice}
                onChange={event => setChoice(event.target.value as PauseChoice)}
              >
                {TIER_OPTIONS.map(option => (
                  <FormControlLabel
                    key={option.value}
                    value={option.value}
                    data-testid={`pause-tier-option-${option.value}`}
                    control={<Radio size="small" sx={{ color: chrome.inkMuted, py: 0.4 }} />}
                    label={
                      <Stack sx={{ py: 0.2 }}>
                        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                          {option.amber && (
                            <FontAwesomeIcon
                              icon={faTriangleExclamation}
                              color={chrome.amber}
                              aria-hidden="true"
                              style={{ fontSize: 10 }}
                            />
                          )}
                          <Typography
                            component="span"
                            sx={{
                              fontSize: 12.5,
                              fontWeight: 700,
                              color: option.amber ? chrome.amber : chrome.ink,
                            }}
                          >
                            {option.label}
                          </Typography>
                        </Stack>
                        <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkFaint }}>
                          {option.hint}
                        </Typography>
                      </Stack>
                    }
                    sx={{ alignItems: 'flex-start', ml: 0, mr: 0 }}
                  />
                ))}
              </RadioGroup>

              <Stack direction="row" sx={{ gap: 1, justifyContent: 'flex-end', alignItems: 'center' }}>
                {isPaused && (
                  <CobraSecondaryButton
                    data-testid="pause-resume"
                    onClick={handleResume}
                    startIcon={<FontAwesomeIcon icon={faPlay} />}
                  >
                    Resume
                  </CobraSecondaryButton>
                )}
                <CobraPrimaryButton
                  data-testid="pause-apply"
                  onClick={applyChoice}
                  startIcon={<FontAwesomeIcon icon={faPause} />}
                >
                  Pause
                </CobraPrimaryButton>
              </Stack>
            </Stack>
          )}
        </Box>
      </Popover>
    </>
  )
}
