/**
 * features/controller/noise/NoiseControl.tsx
 * ---------------------------------------------------------------------------
 * The console's WHITE NOISE knob (demo-feedback story 09; DF-12/DF-13; backend story 05). STAFF
 * world: dark COBRA operator chrome (`consoleChrome` tokens, like `PausePill` and
 * `EscalationDial`), MUI 9 `sx`-only, FontAwesome icons. It sits BESIDE the Pause pill in the
 * console's world-steering row.
 *
 * WHAT IT SHOWS.
 *   - a visible "White noise" label;
 *   - a four-option segmented control, Off / Low / Medium / High. Choosing one sends
 *     `PUT /api/staff/noise` (see `useNoiseState` for the serialised writes);
 *   - the current rate ("6 posts/min") and, as secondary text, the pool size and the posted count;
 *   - a status line: Off, Running, or WHY noise is stopped while a level is set ("Stopped: the
 *     world is frozen", "Stopped: the exercise has ended", "Stopped: the exercise is paused",
 *     "Stopped: the clock is not running", "No posts in the pool"; `noiseStatus.ts`), with an
 *     icon beside the words (never colour alone, NFR-001);
 *   - a failed read or write as visible text in an alert region.
 *
 * ACCESSIBILITY (story 09 cross-cutting AC; NFR-001). The segments are an ARIA radio group named by
 * the visible label: one tab stop (the checked option, or Off when nothing is known yet), and
 * Arrow Left/Up and Right/Down move AND choose (wrapping) from the FOCUSED option, Home and End
 * jump to Off and High, following the WAI-ARIA radio pattern. Space or Enter on a focused option
 * chooses it. The status line is a polite live region, so a stop is announced without stealing
 * focus.
 *
 * READ-ONLY FOR NON-CONTROLLERS (story 11, DF-14). Without `useCanControl()` the level buttons are
 * absent and the current level is shown as text instead; the rate, counts and status stay.
 */

import { useId, useRef, type KeyboardEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCirclePause,
  faCirclePlay,
  faCircleStop,
  faTriangleExclamation,
  faWaveSquare,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { consoleChrome as chrome } from '../consoleChrome'
import { usePauseState } from '../hooks/usePauseState'
import { formatNoiseCounts, formatNoiseRate, noiseStatusLine } from './noiseStatus'
import { NOISE_LEVEL_LABELS, NOISE_LEVELS, type NoiseLevel } from './noiseTypes'
import { useNoiseState } from './useNoiseState'
import { useCanControl } from '../access'

const FONT = "'Figtree', system-ui, sans-serif"

/** The level an arrow / Home / End key moves to from `index`, or `undefined` for another key. */
function levelForKey(key: string, index: number): NoiseLevel | undefined {
  const last = NOISE_LEVELS.length - 1
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return NOISE_LEVELS[index >= last ? 0 : index + 1]
    case 'ArrowLeft':
    case 'ArrowUp':
      return NOISE_LEVELS[index <= 0 ? last : index - 1]
    case 'Home':
      return NOISE_LEVELS[0]
    case 'End':
      return NOISE_LEVELS[last]
    default:
      return undefined
  }
}

export function NoiseControl() {
  const { state, selectedLevel, loadError, saveError, setLevel } = useNoiseState()
  const canControl = useCanControl()
  const { tier } = usePauseState()
  const { status: exerciseStatus } = useExerciseContext()
  const labelId = useId()
  const optionRefs = useRef<Partial<Record<NoiseLevel, HTMLButtonElement | null>>>({})

  const choose = (level: NoiseLevel) => {
    if (level !== selectedLevel) setLevel(level)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Move from the FOCUSED option (Gate-1 L4); fall back to the selected one, then Off.
    const focused = NOISE_LEVELS.find(level => optionRefs.current[level] === event.target)
    const from = focused ?? selectedLevel
    const index = from === undefined ? 0 : NOISE_LEVELS.indexOf(from)
    const next = levelForKey(event.key, index)
    if (next === undefined) return
    event.preventDefault()
    optionRefs.current[next]?.focus()
    choose(next)
  }

  // The tab stop: the checked option, else Off (nothing is known before the first read).
  const tabStop: NoiseLevel = selectedLevel ?? 'off'
  const status = state === undefined ? undefined : noiseStatusLine(state, tier, exerciseStatus)
  const statusIcon =
    status?.kind === 'running' ? faCirclePlay : status?.kind === 'stopped' ? faCirclePause : faCircleStop

  return (
    <Box
      data-testid="noise-control"
      sx={{
        display: 'inline-flex',
        flexDirection: 'column',
        gap: 0.75,
        p: 1,
        bgcolor: chrome.panel,
        border: `1px solid ${chrome.line}`,
        borderRadius: '8px',
        fontFamily: FONT,
        minWidth: 0,
      }}
    >
      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75 }}>
          <FontAwesomeIcon icon={faWaveSquare} color={chrome.inkMuted} aria-hidden="true" />
          <Typography
            id={labelId}
            component="span"
            sx={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              color: chrome.inkMuted,
            }}
          >
            White noise
          </Typography>
        </Stack>

        {canControl ? <Box
          role="radiogroup"
          aria-labelledby={labelId}
          data-testid="noise-level-group"
          onKeyDown={handleKeyDown}
          sx={{
            display: 'inline-flex',
            border: `1px solid ${chrome.line}`,
            borderRadius: '999px',
            overflow: 'hidden',
          }}
        >
          {NOISE_LEVELS.map(level => {
            const checked = level === selectedLevel
            return (
              <Box
                key={level}
                component="button"
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={level === tabStop ? 0 : -1}
                data-testid={`noise-level-${level}`}
                ref={(element: HTMLButtonElement | null) => {
                  optionRefs.current[level] = element
                }}
                onClick={() => choose(level)}
                sx={{
                  px: 1.25,
                  py: 0.375,
                  fontFamily: FONT,
                  fontSize: 11,
                  fontWeight: checked ? 800 : 600,
                  letterSpacing: '0.03em',
                  color: checked ? chrome.ink : chrome.inkMuted,
                  bgcolor: checked ? chrome.blue : 'transparent',
                  border: 'none',
                  borderLeft: level === NOISE_LEVELS[0] ? 'none' : `1px solid ${chrome.line}`,
                  cursor: 'pointer',
                  '&:hover': { color: chrome.ink },
                  '&:focus-visible': {
                    outline: `2px solid ${chrome.amber}`,
                    outlineOffset: '-2px',
                  },
                }}
              >
                {NOISE_LEVEL_LABELS[level]}
              </Box>
            )
          })}
        </Box> : (
          <Typography
            component="span"
            data-testid="noise-level-readonly"
            sx={{ fontSize: 12, fontWeight: 800, color: chrome.ink }}
          >
            {selectedLevel === undefined ? '' : NOISE_LEVEL_LABELS[selectedLevel]}
          </Typography>
        )}

        {state !== undefined && (
          <Typography
            component="span"
            data-testid="noise-rate"
            sx={{ fontSize: 12, fontWeight: 800, color: chrome.ink }}
          >
            {formatNoiseRate(state.ratePerMinute)}
          </Typography>
        )}
      </Stack>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
        <Stack
          direction="row"
          role="status"
          aria-live="polite"
          data-testid="noise-status"
          data-kind={status?.kind ?? 'loading'}
          sx={{ alignItems: 'center', gap: 0.5 }}
        >
          {status !== undefined && (
            <FontAwesomeIcon
              icon={statusIcon}
              color={status.kind === 'stopped' ? chrome.amber : chrome.inkMuted}
              aria-hidden="true"
              style={{ fontSize: 11 }}
            />
          )}
          <Typography
            component="span"
            sx={{
              fontSize: 11,
              fontWeight: status?.kind === 'stopped' ? 800 : 600,
              color: status?.kind === 'stopped' ? chrome.amber : chrome.inkMuted,
            }}
          >
            {status?.text ?? (loadError === null ? 'Reading white noise…' : '')}
          </Typography>
        </Stack>
        {state !== undefined && (
          <Typography
            component="span"
            data-testid="noise-counts"
            sx={{ fontSize: 11, color: chrome.inkFaint }}
          >
            {formatNoiseCounts(state)}
          </Typography>
        )}
      </Stack>

      {(saveError ?? loadError) !== null && (
        <Stack
          direction="row"
          role="alert"
          data-testid="noise-error"
          sx={{ alignItems: 'flex-start', gap: 0.5, maxWidth: 360 }}
        >
          <FontAwesomeIcon
            icon={faTriangleExclamation}
            color={chrome.amber}
            aria-hidden="true"
            style={{ fontSize: 11, marginTop: 2 }}
          />
          <Typography component="span" sx={{ fontSize: 11, color: chrome.ink }}>
            {saveError ?? loadError}
          </Typography>
        </Stack>
      )}
    </Box>
  )
}
