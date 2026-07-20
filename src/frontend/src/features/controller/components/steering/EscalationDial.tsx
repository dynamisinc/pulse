/**
 * features/controller/components/steering/EscalationDial.tsx
 * ---------------------------------------------------------------------------
 * The storyline escalation dial (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2).
 * STAFF world (COBRA) — dark operator-chrome tokens matching the console's
 * other steering/engine surfaces (`EngineControlBar`, `ReviewQueue`); MUI 9
 * `sx`-only system props; FontAwesome icons only; fully keyboard-operable
 * (NFR-001).
 *
 * D5-014/2.2 AMENDMENT (the shape this renders). ONE track — the storyline's
 * actual intensity as a solid FILL (0-100, `Storyline.Intensity`) and the
 * controller-set target as a distinct TICK marker (0-100 or absent,
 * `Storyline.TargetIntensity`). The two are distinguishable WITHOUT color
 * alone (NFR-001): the fill is a full-height block, the tick is a pin-shaped
 * marker sitting above the track, and both are additionally called out by
 * icon + text label ("ACTUAL n" / "TARGET n | none") below the track.
 *
 * INTERACTION. Click or drag anywhere on the track sets the target to that
 * position (pointer capture keeps the drag live even if the pointer leaves
 * the track's bounding box mid-drag). The SAME track is a `role="slider"`
 * that arrow keys (±1), Home (0), and End (100) operate with no loss of the
 * click/drag path. Every commit goes through `useStorylineTarget().setTarget`,
 * which clamps, records the change on the mock storyline, and emits the one
 * `steering_action` telemetry event (XC-004) — this component owns no
 * telemetry/clamping logic itself.
 *
 * DRAG = ONE COMMIT (Gate-1 Minor). A drag's in-progress position is tracked
 * in local state (`dragValue`) purely for LIVE visual feedback (the tick/fill
 * follow the pointer); `setTarget` — and therefore the telemetry emit — is
 * called exactly ONCE, on pointer-up (drag end), not per `pointermove`. A
 * plain click (pointerdown -> pointerup, no intervening move) is just a
 * one-sample drag and behaves the same way. Keyboard sets remain immediate
 * (each key press is already a single discrete commit).
 *
 * CONTAINER-AGNOSTIC (Phase 0 reconciliation). This widget assumes nothing
 * about its mount point (inline work-area vs. a future "Stories" flyout,
 * D5-016/017) — no flyout/popover chrome of its own, no fixed width. The
 * orchestrator mounts it into `ControllerConsole.tsx`'s work area as an
 * interim step; this component/story does not touch that file.
 */

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { Box, Stack, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faGaugeHigh, faLocationDot } from '@fortawesome/free-solid-svg-icons'
import { useStorylineTarget } from '../../hooks/useStorylineTarget'

/** Dark operator-chrome tokens (matches `EngineControlBar`/`ReviewQueue`'s tokens). Staff-only. */
const chrome = {
  panel: '#0f1826',
  line: '#28384b',
  ink: '#e9eff7',
  inkMuted: '#9db1c8',
  blue: '#4d97d1',
  amber: '#f5a623',
} as const

/** Props for {@link EscalationDial}. */
export interface EscalationDialProps {
  /**
   * Which storyline to target — defaults to `useStorylineTarget`'s default
   * (the mock's single seeded storyline). Accepted so a future storyline
   * board (D5-016/017, deferred) can mount one dial per card.
   */
  readonly storylineId?: string
}

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function valueFromClientX(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) return 0
  const ratio = (clientX - rect.left) / rect.width
  return clamp0to100(ratio * 100)
}

/**
 * The one-track actual+target escalation dial. See the module header for the
 * full contract. Self-contained — reads/writes via `useStorylineTarget()`;
 * callers pass nothing but an optional `storylineId`.
 */
export function EscalationDial({ storylineId }: EscalationDialProps) {
  const dial = useStorylineTarget(storylineId)
  const trackRef = useRef<HTMLDivElement | null>(null)
  const isDraggingRef = useRef(false)
  // The in-progress drag position — LIVE visual feedback only. The telemetry-
  // emitting `dial.setTarget` is committed exactly once, on pointer-up (see
  // module header, "DRAG = ONE COMMIT"). A ref mirrors the latest value so
  // pointer-up reads it without depending on (and re-creating callbacks on)
  // React state.
  const [dragValue, setDragValue] = useState<number | null>(null)
  const dragValueRef = useRef<number | null>(null)

  const readValueFromClientX = useCallback((clientX: number): number | null => {
    const track = trackRef.current
    if (!track) return null
    return valueFromClientX(track, clientX)
  }, [])

  const handlePointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      isDraggingRef.current = true
      event.currentTarget.setPointerCapture(event.pointerId)
      const value = readValueFromClientX(event.clientX)
      dragValueRef.current = value
      setDragValue(value)
    },
    [readValueFromClientX],
  )

  const handlePointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (!isDraggingRef.current) return
      const value = readValueFromClientX(event.clientX)
      dragValueRef.current = value
      setDragValue(value)
    },
    [readValueFromClientX],
  )

  const handlePointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      isDraggingRef.current = false
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId)
      }
      const value = dragValueRef.current
      dragValueRef.current = null
      setDragValue(null)
      // The ONE commit for the whole gesture (click or drag alike).
      if (value !== null) dial.setTarget(value)
    },
    [dial],
  )

  const handlePointerCancel = useCallback((event: PointerEvent<HTMLDivElement>) => {
    // A canceled gesture (e.g. touch interrupted mid-drag) discards the
    // in-progress value rather than committing it.
    isDraggingRef.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    dragValueRef.current = null
    setDragValue(null)
  }, [])

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const current = dial.targetIntensity ?? dial.intensity
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          event.preventDefault()
          dial.setTarget(clamp0to100(current + 1))
          break
        case 'ArrowLeft':
        case 'ArrowDown':
          event.preventDefault()
          dial.setTarget(clamp0to100(current - 1))
          break
        case 'Home':
          event.preventDefault()
          dial.setTarget(0)
          break
        case 'End':
          event.preventDefault()
          dial.setTarget(100)
          break
        default:
          break
      }
    },
    [dial],
  )

  // Live visual value: the in-progress drag position while dragging, else the
  // last COMMITTED target (telemetry has already fired for the latter).
  const displayTargetIntensity = dragValue ?? dial.targetIntensity
  const targetLabel = displayTargetIntensity === null ? 'none' : String(displayTargetIntensity)
  const relationshipText =
    dial.lastChangeDetail ?? 'Click, drag, or use arrow keys / Home / End on the track to set a target.'

  return (
    <Box
      data-testid="escalation-dial"
      sx={{
        p: 1.5,
        bgcolor: chrome.panel,
        border: `1px solid ${chrome.line}`,
        borderRadius: '8px',
        fontFamily: "'Figtree', system-ui, sans-serif",
      }}
    >
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 1 }}
      >
        <Typography
          component="span"
          sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkMuted }}
        >
          ESCALATION
        </Typography>
        {/* Phase label — text, uppercase, NOT a color-only indicator (NFR-001). */}
        <Typography
          component="span"
          data-testid="escalation-dial-phase"
          sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: chrome.ink }}
        >
          {dial.phaseLabel}
        </Typography>
      </Stack>

      <Box
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Storyline escalation target"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayTargetIntensity ?? dial.intensity}
        aria-valuetext={`actual ${dial.intensity}, target ${targetLabel}`}
        data-testid="escalation-dial-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        sx={{
          position: 'relative',
          height: 28,
          mt: 2,
          borderRadius: '6px',
          bgcolor: '#0a1017',
          border: `1px solid ${chrome.line}`,
          cursor: 'pointer',
          touchAction: 'none',
          '&:focus-visible': { outline: `2px solid ${chrome.blue}`, outlineOffset: '2px' },
        }}
      >
        {/* Actual — a solid full-height fill (shape-distinct from the target tick, NFR-001). */}
        <Box
          data-testid="escalation-dial-actual-fill"
          aria-hidden="true"
          sx={{
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: 0,
            width: `${dial.intensity}%`,
            bgcolor: chrome.blue,
            borderRadius: '6px 0 0 6px',
          }}
        />

        {/* Target — a distinct pin marker above the track, never merely a second hue. */}
        {displayTargetIntensity !== null ? (
          <Box
            data-testid="escalation-dial-target-tick"
            aria-hidden="true"
            sx={{
              position: 'absolute',
              top: -16,
              left: `${displayTargetIntensity}%`,
              transform: 'translateX(-50%)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              lineHeight: 1,
            }}
          >
            <FontAwesomeIcon icon={faLocationDot} color={chrome.amber} size="sm" />
            <Box sx={{ width: '2px', height: 14, bgcolor: chrome.amber }} />
          </Box>
        ) : null}
      </Box>

      <Stack direction="row" sx={{ alignItems: 'center', gap: 2, mt: 1.25, flexWrap: 'wrap' }}>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <FontAwesomeIcon icon={faGaugeHigh} color={chrome.blue} aria-hidden="true" />
          <Typography
            component="span"
            data-testid="escalation-dial-actual-label"
            sx={{ fontSize: 11, fontWeight: 700, color: chrome.ink }}
          >
            ACTUAL {dial.intensity}
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <FontAwesomeIcon icon={faLocationDot} color={chrome.amber} aria-hidden="true" />
          <Typography
            component="span"
            data-testid="escalation-dial-target-label"
            sx={{ fontSize: 11, fontWeight: 700, color: chrome.ink }}
          >
            TARGET {targetLabel}
          </Typography>
        </Stack>
      </Stack>

      {/* Relationship text — the from/to transition (XC-004 detail convention). */}
      <Typography
        component="p"
        data-testid="escalation-dial-relationship"
        role="status"
        aria-live="polite"
        sx={{ fontSize: 11, color: chrome.inkMuted, mt: 0.75, m: 0 }}
      >
        {relationshipText}
      </Typography>
    </Box>
  )
}
