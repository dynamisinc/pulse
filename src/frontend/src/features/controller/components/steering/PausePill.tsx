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
 * "PAUSE INJECTS" IS LIVE (inject-queue story 07; IQ-5; CTL-023). The radio was a
 * disabled "No inject queue yet" placeholder (world-steering story 07), then removed
 * by demo-polish C4 because a tier that paused nothing read as unfinished. There IS
 * an inject queue now (the console's run sheet, backed by story 06's server queue),
 * so C4's RE-ENABLE note is carried out: the option is back in `TIER_OPTIONS` as a
 * REAL control. It sets the existing `injects` tier through the existing
 * `usePauseState().setTier` action — no second path: while it is active the server
 * suspends running bursts (manual fire still works) and the run sheet shows "Injects
 * paused: bursts are suspended; manual fire still works". It is listed FIRST (mildest to
 * strongest) but it is NOT the default selection: opening the pill and pressing Pause
 * still pauses the ENGINE, exactly as it has since #449 (the demo plan's pause step is
 * the engine). Pausing injects is a deliberate pick of its radio.
 *
 * THE PAUSE POPOVER (D5-014/1.3). Opening the pill reveals three radio tiers —
 * Pause injects / Pause engine / Freeze world. The footer has a **Cancel** link
 * (dismiss, no change), a **Resume** button that appears while any tier is
 * active (returns to `running`), and the primary **Pause** action that applies
 * the selected tier. FREEZE IS GUARDED: choosing Freeze routes through a
 * deliberate confirm step (Back / Confirm freeze) before it takes effect,
 * because participants notice a world freeze. This is a confirm-step guard, NOT
 * a Director role-gate (that pattern belongs to Break Fiction, story 04).
 *
 * THE PARTICIPANT PAUSE PAGE (world-steering story 08; D7-004). Beside the tier
 * radios, a two-option selector chooses WHICH holding page a Freeze shows
 * participants — the one participant-visible training-design choice this control
 * carries, so it is labelled by its CONSEQUENCE, not by the internal register
 * jargon:
 *   - **out of fiction** ("EXERCISE PAUSED") — names the exercise; breaks the
 *     fiction on purpose. The DEFAULT, because it is the safe choice when the
 *     fiction is already broken.
 *   - **in fiction** ("We'll be right back") — reads like an ordinary outage and
 *     keeps participants inside the scenario.
 * It writes through `usePauseState().setOverlayRegister` — the shared ambient
 * store — and there is deliberately NO second path: the live pause-tier POST
 * sends whatever the store holds, and the backend's overlay publisher pushes
 * that register to the participant shell. Selection is conveyed by TEXT (the
 * radio's own checked state + its consequence copy), never colour (NFR-001), and
 * the Freeze confirm step restates which page participants will get.
 *
 * A REFUSED FREEZE IS ANNOUNCED (world-steering story 08, Gate-1 WR-003). The
 * server refuses a Freeze outright when the exercise is not in a running
 * lifecycle state (pre-start, or past EndEx), recording nothing. This control then
 * renders the server's plain reason beside the pill in a `role="status"` /
 * `aria-live="polite"` region — TEXT next to a non-colour icon, with a real
 * keyboard-reachable Dismiss — rather than letting the pill quietly snap back. Per
 * NFR-001 the explanation is never colour alone and never a bare status code.
 *
 * TOUCH (mobile-tablet story 15, D5-025, TABLET-AMENDMENT §5). Behaviour is unchanged. On a COARSE
 * pointer (`useCoarsePointer()`, never a width):
 *   - the pill, the radio rows, Cancel / Resume / Pause and Back / Confirm freeze are real 44px
 *     boxes (`minHeight`, no pseudo-element slop); Back and Confirm freeze are 16px apart with
 *     Confirm at the far edge;
 *   - the Freeze confirm step opens with NO focused button, on ALL pointers (rule 2 holds
 *     everywhere): focus goes to the step's own (non-interactive, `tabIndex -1`) container, so
 *     the first thing a keyboard or screen-reader user meets is the "FREEZE THE WORLD?" text,
 *     and Enter/Space cannot fire the freeze;
 *   - Confirm freeze ignores taps for 400ms after the step opens (`useArmedConfirm`, shown as
 *     `aria-disabled`), fires once, and carries `touch-action: manipulation` / no selection / no
 *     long-press callout;
 *   - the step is shorter than the tier list and anchored to the top of the popover, so the
 *     "Pause" button the controller just tapped is no longer under the finger's second tap;
 *   - the popover's height is capped to the room under the pill (its paper scrolls past that,
 *     re-measured on resize and rotation while open), so MUI's edge shift cannot move it up over
 *     the pill that opened it, and it stays inside the viewport at 768 and 1180.
 * The focus-trap and Escape contract above is MUI `Popover`'s own and is untouched.
 *
 * FULLY KEYBOARD-OPERABLE (NFR-001). The pill is a button (Enter/Space); the
 * popover traps focus; the radios are arrow/Tab navigable; every action is a
 * button; Escape dismisses the popover and the confirm step.
 */

import { useEffect, useRef, useState } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCirclePause,
  faMasksTheater,
  faPause,
  faPlay,
  faSnowflake,
  faTriangleExclamation,
  faUserSlash,
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
import { CobraLinkButton, CobraPrimaryButton, CobraSecondaryButton } from '@/theme/styledComponents'
import {
  PAUSE_TIER_LABELS,
  usePauseState,
  type OverlayRegister,
  type PauseTier,
} from '../../hooks/usePauseState'
import {
  ARMING_SX,
  CONFIRM_GAP_PX,
  destructiveTouchSx,
  touchRadioRowSx,
  touchTargetSx,
  useArmedConfirm,
  useCoarsePointer,
} from '../confirm'
// D5 dark operator-chrome tokens (matches `SwampedModeToggle`). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'
import { useCanControl } from '../../access'

/** The tiers a controller can SELECT to pause (excludes the `running` baseline). */
type PauseChoice = Exclude<PauseTier, 'running'>

interface TierOption {
  readonly value: PauseChoice
  readonly label: string
  readonly hint: string
  readonly amber: boolean
}

/** The three pause tiers, mildest first — see the module header on `injects`. */
const TIER_OPTIONS: readonly TierOption[] = [
  { value: 'injects', label: 'Pause injects', hint: 'World keeps living', amber: false },
  { value: 'engine', label: 'Pause engine', hint: 'No new AI content', amber: false },
  { value: 'freeze', label: 'Freeze world', hint: 'Participants notice — guarded', amber: true },
]

/**
 * The tier the popover pre-selects when running: Pause ENGINE, set explicitly rather than
 * taken from the list order. "Open the pill, press Pause" has paused the engine since #449
 * and the demo plan's pause step relies on it; Pause injects (listed first) is a deliberate
 * choice, never the default.
 */
const DEFAULT_CHOICE: PauseChoice = 'engine'

/**
 * The radio to pre-select for the active `tier`: the tier itself when it is
 * one of the offered options, otherwise the default. A tier the server/store
 * reports that is NOT offered must not leave the radio group with a value that
 * matches nothing — otherwise Pause would apply a tier the controller cannot see
 * selected. (Every tier but `running` is offered today; the guard keeps it so.)
 */
function choiceForTier(tier: PauseTier): PauseChoice {
  return TIER_OPTIONS.find(option => option.value === tier)?.value ?? DEFAULT_CHOICE
}

/**
 * One participant-pause-page option (story 08). `label` names the CONSEQUENCE and
 * quotes the copy participants actually read; `hint` explains the training
 * intent. Both are text — the selection is never conveyed by colour (NFR-001).
 */
interface RegisterOption {
  readonly value: OverlayRegister
  readonly label: string
  readonly hint: string
  readonly icon: typeof faMasksTheater
}

/**
 * Out of fiction FIRST because it is the default and the conservative choice: an
 * explicit "EXERCISE PAUSED" is safe when the fiction is already broken, whereas
 * wrongly staying in fiction hides a real stop from participants.
 */
const DEFAULT_REGISTER_OPTION: RegisterOption = {
  value: 'out-of-fiction',
  label: 'Out of fiction — "EXERCISE PAUSED"',
  hint: 'Names the exercise. Breaks the fiction on purpose.',
  icon: faUserSlash,
}

const REGISTER_OPTIONS: readonly RegisterOption[] = [
  DEFAULT_REGISTER_OPTION,
  {
    value: 'in-fiction',
    label: "In fiction — \"We'll be right back\"",
    hint: 'Reads like an ordinary outage. Keeps participants in the scenario.',
    icon: faMasksTheater,
  },
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
  const canControl = useCanControl()
  const {
    tier,
    label,
    isPaused,
    overlayRegister,
    setTier,
    resume,
    setOverlayRegister,
    refusal,
    dismissRefusal,
  } = usePauseState()

  // The selected participant pause page, restated on the Freeze confirm step so the
  // guarded action names exactly what participants will see.
  const selectedRegister =
    REGISTER_OPTIONS.find(option => option.value === overlayRegister) ?? DEFAULT_REGISTER_OPTION

  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  const open = Boolean(anchorEl)
  const [choice, setChoice] = useState<PauseChoice>(DEFAULT_CHOICE)
  const [confirmingFreeze, setConfirmingFreeze] = useState(false)
  const coarse = useCoarsePointer()
  const touchSx = coarse ? touchTargetSx : {}
  const { armed: freezeArmed, guard: guardFreeze } = useArmedConfirm({
    open: open && confirmingFreeze,
    enabled: coarse,
  })
  // The Freeze step's own container takes focus on open (never a button).
  const freezeStepRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (confirmingFreeze) freezeStepRef.current?.focus({ preventScroll: true })
  }, [confirmingFreeze])
  // Room under the pill (coarse only): the popover is capped to it (its paper scrolls) so MUI's
  // edge shift can never move it up over the pill. Re-measured on resize / rotation while open.
  const [roomBelow, setRoomBelow] = useState<number | null>(null)
  useEffect(() => {
    if (anchorEl === null || !coarse) {
      setRoomBelow(null)
      return undefined
    }
    const measure = () => {
      setRoomBelow(Math.max(0, Math.round(
        window.innerHeight - anchorEl.getBoundingClientRect().bottom - 16,
      )))
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('orientationchange', measure)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('orientationchange', measure)
    }
  }, [anchorEl, coarse])

  // Each time the popover opens, seed the radio from the active tier (or the
  // first offered option when running) and clear any stale confirm step.
  useEffect(() => {
    if (!open) return
    setChoice(choiceForTier(tier))
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

  // Story 11 (DF-14): every pill action writes, so a non-controller gets the tier as a readout.
  if (!canControl) {
    return (
      <Box
        component="span"
        role="status"
        data-testid="pause-readout"
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
        }}
      >
        <Box
          component="span"
          aria-hidden="true"
          sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: TIER_DOT[tier], flexShrink: 0 }}
        />
        <FontAwesomeIcon icon={isPaused ? faCirclePause : faPlay} aria-hidden="true" style={{ fontSize: 10 }} />
        {`Pause state: ${label}`}
      </Box>
    )
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
          ...touchSx,
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

      {/*
        THE SERVER REFUSED THE CHANGE (world-steering story 08, Gate-1 WR-003).
        A Freeze outside a running world is refused outright server-side — nothing
        recorded, no clock touched, no participant overlay — so the console has
        already backed its optimistic flip out. Announcing WHY is the whole point:
        a control that silently snaps back is the same "asserts a state the server
        never applied" defect from the other direction.

        NFR-001: the reason is TEXT beside a non-colour icon (never colour alone),
        the region is `role="status"` + `aria-live="polite"` so it is ANNOUNCED
        without stealing focus, and Dismiss is a real keyboard-reachable button.
        It persists until the controller's next action or an explicit dismiss —
        never a timer, which would hide it from anyone who looked away.
      */}
      {refusal && (
        <Box
          role="status"
          aria-live="polite"
          data-testid="pause-refusal"
          sx={{
            display: 'inline-flex',
            alignItems: 'flex-start',
            gap: 0.75,
            maxWidth: 380,
            ml: 1,
            px: 1,
            py: 0.5,
            fontFamily: "'Figtree', system-ui, sans-serif",
            color: chrome.ink,
            bgcolor: chrome.card,
            border: `1px solid ${chrome.amber}`,
            borderRadius: '6px',
          }}
        >
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            aria-hidden="true"
            style={{ fontSize: 11, marginTop: 3, flexShrink: 0 }}
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em' }}>
              {`${PAUSE_TIER_LABELS[refusal.tier]} NOT APPLIED`}
            </Typography>
            <Typography sx={{ fontSize: 11, color: chrome.inkMuted, mt: 0.25 }}>
              {refusal.reason}
            </Typography>
          </Box>
          <CobraLinkButton
            onClick={dismissRefusal}
            aria-label="Dismiss the refused pause notice"
            sx={{ fontSize: 11, flexShrink: 0, ...touchSx }}
          >
            Dismiss
          </CobraLinkButton>
        </Box>
      )}

      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={closePopover}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        slotProps={{
          paper: {
            role: 'dialog',
            // MUI's Popover is a modal (it aria-hides the app and traps focus), so it says so:
            // the console's ⌘K stands aside while it is open instead of opening the palette
            // hidden behind it (`core/a11y/modalPriority`; Gate-2 A L-2).
            'aria-modal': true,
            'aria-label': 'Pause tiers',
            sx: {
              mt: 0.5,
              p: 1.5,
              ...(roomBelow === null ? {} : { maxHeight: `${roomBelow}px`, overflowY: 'auto' }),
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
            <Stack
              ref={freezeStepRef}
              tabIndex={-1}
              data-testid="pause-freeze-confirm"
              sx={{ gap: 1.25, outline: 'none' }}
            >
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
              {/* Story 08: name the page participants will actually get, so the
                  guarded step states the participant-visible consequence. */}
              <Typography
                data-testid="pause-freeze-confirm-register"
                sx={{ fontSize: 11.5, color: chrome.ink, lineHeight: 1.4 }}
              >
                {`They will see: ${selectedRegister.label}`}
              </Typography>
              <Stack
                direction="row"
                sx={{ gap: coarse ? `${CONFIRM_GAP_PX}px` : 1, justifyContent: 'flex-end' }}
              >
                <CobraSecondaryButton
                  data-testid="pause-freeze-back"
                  onClick={() => setConfirmingFreeze(false)}
                  sx={touchSx}
                >
                  Back
                </CobraSecondaryButton>
                <CobraPrimaryButton
                  data-testid="pause-freeze-confirm-button"
                  onClick={guardFreeze(confirmFreeze)}
                  aria-disabled={!freezeArmed}
                  onContextMenu={event => event.preventDefault()}
                  sx={coarse
                    ? { ...touchTargetSx, ...destructiveTouchSx, ...ARMING_SX }
                    : undefined}
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
                        {/* NFR-001: the consequence is TEXT inside the radio's own
                            accessible name, never colour alone. */}
                        <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkFaint }}>
                          {option.hint}
                        </Typography>
                      </Stack>
                    }
                    sx={{ alignItems: 'flex-start', ml: 0, mr: 0, ...(coarse ? touchRadioRowSx : {}) }}
                  />
                ))}
              </RadioGroup>

              {/* Story 08 — the participant pause page. Writes straight through to
                  the shared pause store (no local copy, no second path): the live
                  pause-tier POST sends whatever the store holds. */}
              <Box
                data-testid="pause-register-group"
                sx={{ borderTop: `1px solid ${chrome.line}`, pt: 1 }}
              >
                <Typography
                  sx={{
                    fontSize: 11,
                    fontWeight: 800,
                    letterSpacing: '0.05em',
                    color: chrome.inkFaint,
                  }}
                >
                  PARTICIPANT PAUSE PAGE
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: chrome.inkFaint, mb: 0.25 }}>
                  What participants see while the world is frozen
                </Typography>

                <RadioGroup
                  aria-label="Participant pause page"
                  value={overlayRegister}
                  onChange={event => setOverlayRegister(event.target.value as OverlayRegister)}
                >
                  {REGISTER_OPTIONS.map(option => (
                    <FormControlLabel
                      key={option.value}
                      value={option.value}
                      data-testid={`pause-register-option-${option.value}`}
                      control={<Radio size="small" sx={{ color: chrome.inkMuted, py: 0.4 }} />}
                      label={
                        <Stack sx={{ py: 0.2 }}>
                          <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
                            <FontAwesomeIcon
                              icon={option.icon}
                              aria-hidden="true"
                              style={{ fontSize: 10, color: chrome.inkMuted }}
                            />
                            <Typography
                              component="span"
                              sx={{ fontSize: 12.5, fontWeight: 700, color: chrome.ink }}
                            >
                              {option.label}
                            </Typography>
                          </Stack>
                          {/* NFR-001: the consequence is TEXT inside the radio's own
                              accessible name — never colour, never icon-only. */}
                          <Typography component="span" sx={{ fontSize: 10.5, color: chrome.inkFaint }}>
                            {option.hint}
                          </Typography>
                        </Stack>
                      }
                      sx={{ alignItems: 'flex-start', ml: 0, mr: 0, ...(coarse ? touchRadioRowSx : {}) }}
                    />
                  ))}
                </RadioGroup>
              </Box>

              <Stack
                direction="row"
                sx={{ gap: coarse ? 1.5 : 1, justifyContent: 'flex-end', alignItems: 'center' }}
              >
                <CobraLinkButton data-testid="pause-cancel" onClick={closePopover} sx={touchSx}>
                  Cancel
                </CobraLinkButton>
                {isPaused && (
                  <CobraSecondaryButton
                    data-testid="pause-resume"
                    onClick={handleResume}
                    sx={touchSx}
                    startIcon={<FontAwesomeIcon icon={faPlay} />}
                  >
                    Resume
                  </CobraSecondaryButton>
                )}
                <CobraPrimaryButton
                  data-testid="pause-apply"
                  onClick={applyChoice}
                  sx={touchSx}
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
