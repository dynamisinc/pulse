/**
 * features/controller/components/steering/EscalationDial.tsx
 * ---------------------------------------------------------------------------
 * The storyline escalation dial (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2;
 * story 09 — "Escalation dial live" — adds the explanatory legend/tooltip
 * below and the live data branch via `useStorylineTarget`). STAFF world
 * (COBRA) — dark operator-chrome tokens matching the console's other
 * steering/engine surfaces (`EngineControlBar`, `ReviewQueue`); MUI 9
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
 * which clamps, records the change (mock or live), and emits the one
 * `steering_action` telemetry event (XC-004) — this component owns no
 * telemetry/clamping/data-source logic itself (mock vs. live is entirely the
 * hook's concern).
 *
 * DRAG = ONE COMMIT (Gate-1 Minor). A drag's in-progress position is tracked
 * in local state (`dragValue`) purely for LIVE visual feedback (the tick/fill
 * follow the pointer); `setTarget` — and therefore the telemetry emit — is
 * called exactly ONCE, on pointer-up (drag end), not per `pointermove`. A
 * plain click (pointerdown -> pointerup, no intervening move) is just a
 * one-sample drag and behaves the same way. Keyboard sets remain immediate
 * (each key press is already a single discrete commit).
 *
 * NEVER FABRICATE A CALM WORLD (Gate-1 CR-002). Before a live storyline read
 * is CONFIRMED (`dial.dataStatus === 'live'`), this component renders NO
 * numeric readout at all — no `ACTUAL 0 / DORMANT` masquerading as fact. It
 * instead shows a plain, explicit status (icon + text, NFR-001): "loading"
 * before the first GET resolves, or "no live storyline" if the most recent
 * GET failed (including the accepted post-App-Service-restart 404-forever
 * limitation). Always `'live'` under mock (synchronously seeded).
 *
 * NEVER CLAIM AN UNCONFIRMED CHANGE (Gate-1 CR-001, qualified further at
 * Gate-2 W-101). The relationship line (`role="status" aria-live="polite"`)
 * distinguishes a PENDING change (`dial.pendingChangeDetail`, in flight) from
 * a CONFIRMED one (`dial.lastChangeDetail`, only ever set after the backend
 * actually applied it) — NOT ONLY by which field is set, but in the RENDERED
 * TEXT itself: the pending case reads "Setting target: X… (not yet
 * confirmed)" with an hourglass icon, never the bare "X" a confirmed commit
 * shows, so a screen reader never announces an in-flight request identically
 * to a settled one. A failed write surfaces `dial.writeError` as an
 * explicit, separate icon+text line, never silently reverting with no
 * signal.
 *
 * EXPLANATORY UX (story 09, AC5 — static, not per-exercise configured copy).
 * The D5-amended dial shipped with no explanation of what it shows, so this
 * story adds, in place:
 *   - a one-line SCALE legend (what 0-100 means);
 *   - a labeled ACTUAL-vs-TARGET legend (what each value on the track MEANS,
 *     distinct from the "ACTUAL n"/"TARGET n" live VALUE badges above, which
 *     already carry icon + text per story 02's NFR-001 pass);
 *   - a one-line PHASE-MEANING description on hover/focus of the phase label
 *     (an MUI `Tooltip` with `describeChild` — Gate-1 W-003: WITHOUT
 *     `describeChild`, MUI sets the tooltip title as the trigger's
 *     `aria-label`, which REPLACES "ESCALATING" as the phase label's
 *     accessible name, so a screen-reader user would never hear the phase
 *     itself. `describeChild` keeps the phase text as the accessible name
 *     and moves the description to `aria-describedby`, present only while
 *     the tooltip is open).
 * None of this is color-only (NFR-001): every explanation is icon + text.
 *
 * THE HONESTY CAVEAT (story 09, AC4). `Storyline.Tick` only drives actual
 * toward a target while the storyline is `Escalating`/`Peak` (see
 * `Storyline.cs`'s own gating) — a target set on a `Seeded`/`Addressed`/
 * `Decaying`/`Resolved`/`Dormant` storyline is recorded but the engine will
 * NOT chase it. Rather than silently implying an immediate chase that will
 * not happen, this component states that plainly whenever a target is set on
 * a non-chasing phase — mirroring the backend's own gate, never re-deriving
 * new domain logic here. Once a live target exists, `TargetFollow.Modulate`
 * (already shipped, unmodified) ALSO shapes burst direction/count on the
 * SAME storyline — that DECIDE-stage effect is out of this component's
 * concern (it renders only the MEASURE-stage actual/target relationship).
 *
 * CONTAINER-AGNOSTIC (Phase 0 reconciliation). This widget assumes nothing
 * about its mount point (inline work-area vs. a future "Stories" flyout,
 * D5-016/017) — no flyout/popover chrome of its own, no fixed width. The
 * orchestrator mounts it into `ControllerConsole.tsx`'s work area as an
 * interim step; this component/story does not touch that file.
 */

import { useCallback, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Box, Stack, Tooltip, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import {
  faCircleInfo,
  faGaugeHigh,
  faHourglassHalf,
  faLocationDot,
  faTriangleExclamation,
} from '@fortawesome/free-solid-svg-icons'
import { useStorylineTarget } from '../../hooks/useStorylineTarget'
import type { StorylinePhase } from '../../services/storylineMock'
// Dark operator-chrome tokens (matches `EngineControlBar`/`ReviewQueue`'s tokens). Staff-only.
import { consoleChrome as chrome } from '../../consoleChrome'

/**
 * The phases in which `Storyline.Tick` actually drives actual intensity
 * toward a live target (story 09, AC4).
 */
const CHASING_PHASES: ReadonlySet<StorylinePhase> = new Set(['Escalating', 'Peak'])

/**
 * A one-line, plain-language description of what each phase means — read on
 * hover/focus of the phase label (AC5). Mirrors the lifecycle documented on
 * `StorylinePhase.cs`; text only, never re-deriving new domain meaning.
 */
const PHASE_DESCRIPTIONS: Record<StorylinePhase, string> = {
  Dormant: 'not yet active — the world isn’t reacting to this yet',
  Seeded: 'planted; the silence window is running',
  Escalating: 'gaining attention, no qualifying response yet',
  Peak: 'at maximum public pressure',
  Addressed: 'an official response was matched; pressure is coming off',
  Decaying: 'cooling off toward baseline',
  Resolved: 'burned out; re-openable by a new trigger',
}

/** The one-line, plain-language scale legend (AC5) — static, not per-exercise configured copy. */
const SCALE_LEGEND = '0 = quiet · 100 = crisis-level attention'

function clamp0to100(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function valueFromClientX(track: HTMLElement, clientX: number): number {
  const rect = track.getBoundingClientRect()
  if (rect.width === 0) return 0
  const ratio = (clientX - rect.left) / rect.width
  return clamp0to100(ratio * 100)
}

/** The shared panel chrome both the "unavailable" and the live render paths use. */
function DialPanel({ children }: { children: ReactNode }) {
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
      {children}
    </Box>
  )
}

/**
 * The one-track actual+target escalation dial. See the module header for the
 * full contract. Self-contained and prop-less — reads/writes the single
 * storyline via `useStorylineTarget()` (Wave-1/2 is single-storyline; a
 * future per-card board reuse arrives with the multi-storyline store,
 * D5-016/017).
 */
export function EscalationDial() {
  const dial = useStorylineTarget()
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

  // Gate-1 CR-002: before a live read is CONFIRMED, render NOTHING numeric —
  // an explicit, plain status instead of a fabricated calm/quiet world.
  if (dial.dataStatus !== 'live') {
    const isLoading = dial.dataStatus === 'loading'
    return (
      <DialPanel>
        <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, mb: 1 }}>
          <Typography
            component="span"
            sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkMuted }}
          >
            ESCALATION
          </Typography>
        </Stack>
        <Stack
          direction="row"
          data-testid="escalation-dial-unavailable"
          data-status={dial.dataStatus}
          sx={{ alignItems: 'flex-start', gap: 0.75 }}
        >
          <FontAwesomeIcon
            icon={isLoading ? faHourglassHalf : faTriangleExclamation}
            color={chrome.inkMuted}
            aria-hidden="true"
          />
          <Typography component="p" role="status" aria-live="polite" sx={{ fontSize: 11, color: chrome.inkMuted, m: 0 }}>
            {isLoading
              ? 'Loading storyline…'
              : 'No live storyline — engine loop not registered. This is NOT a quiet storyline; ' +
                'the read failed (a restart may have cleared it — re-seed via ops to recover).'}
          </Typography>
        </Stack>
      </DialPanel>
    )
  }

  // Live visual value: the in-progress drag position while dragging, else the
  // last COMMITTED target (telemetry has already fired for the latter).
  const displayTargetIntensity = dragValue ?? dial.targetIntensity
  const targetLabel = displayTargetIntensity === null ? 'none' : String(displayTargetIntensity)

  // Gate-1 CR-001 / Gate-2 W-101: a PENDING (unconfirmed) change takes
  // priority over a CONFIRMED one, which takes priority over the default
  // prompt — and the PENDING case is worded distinctly (never the bare
  // confirmed string) so a screen reader never announces an in-flight
  // request as settled fact.
  const isPending = dial.pendingChangeDetail !== null
  const relationshipText = isPending
    ? `Setting target: ${dial.pendingChangeDetail}… (not yet confirmed)`
    : (dial.lastChangeDetail ?? 'Click, drag, or use arrow keys / Home / End on the track to set a target.')

  // AC4 — the honesty caveat: a target is recorded on ANY phase, but the
  // engine only chases it while Escalating/Peak (mirrors Storyline.Tick's own
  // gating). Shown whenever a target is set on a non-chasing phase — never
  // silently implying an immediate chase that will not happen.
  const chasesTowardTarget = CHASING_PHASES.has(dial.phase)
  const showTargetWontMoveCaveat = dial.targetIntensity !== null && !chasesTowardTarget

  return (
    <DialPanel>
      <Stack
        direction="row"
        sx={{ alignItems: 'baseline', justifyContent: 'space-between', gap: 1, mb: 0.25 }}
      >
        <Typography
          component="span"
          sx={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', color: chrome.inkMuted }}
        >
          ESCALATION
        </Typography>
        {/*
          Phase label — text, uppercase, NOT a color-only indicator (NFR-001).
          Story 09, AC5: a one-line phase-meaning description on hover/focus
          (a Tooltip; tabIndex makes it keyboard-reachable, not mouse-only).
          `describeChild` (Gate-1 W-003): keeps "ESCALATING" as the phase
          label's accessible NAME and moves the description to
          `aria-describedby` instead of overwriting the name with `aria-label`.
        */}
        <Tooltip title={PHASE_DESCRIPTIONS[dial.phase]} describeChild>
          <Typography
            component="span"
            tabIndex={0}
            data-testid="escalation-dial-phase"
            sx={{
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.04em',
              color: chrome.ink,
              cursor: 'help',
              '&:focus-visible': { outline: `2px solid ${chrome.blue}`, outlineOffset: '2px' },
            }}
          >
            {dial.phaseLabel}
          </Typography>
        </Tooltip>
      </Stack>

      {/* Storyline title (Gate-1 W-008) — names what the dial is steering, never just numbers. */}
      {dial.title ? (
        <Typography
          component="p"
          data-testid="escalation-dial-title"
          sx={{ fontSize: 11, fontWeight: 600, color: chrome.ink, m: 0, mb: 0.5 }}
        >
          {dial.title}
        </Typography>
      ) : null}

      {/* Scale legend — story 09, AC5: a one-line, plain-language meaning of the 0-100 scale. */}
      <Typography
        component="p"
        data-testid="escalation-dial-scale-legend"
        sx={{ fontSize: 11, color: chrome.inkMuted, m: 0 }}
      >
        {SCALE_LEGEND}
      </Typography>

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
          bgcolor: chrome.bg,
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

      {/*
        Actual-vs-target MEANING legend — story 09, AC5: distinct from the
        live VALUE badges above ("ACTUAL n" / "TARGET n"), this defines what
        each one IS, so the relationship between them is never inferred from
        position on the track alone. Icon + text, matching each badge's own
        icon (NFR-001 — never color-only).
      */}
      <Stack
        direction="row"
        data-testid="escalation-dial-actual-target-legend"
        sx={{ alignItems: 'flex-start', gap: 2, mt: 0.5, flexWrap: 'wrap' }}
      >
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <FontAwesomeIcon icon={faGaugeHigh} color={chrome.blue} aria-hidden="true" />
          <Typography component="span" sx={{ fontSize: 11, color: chrome.inkMuted }}>
            ACTUAL = current real-world attention
          </Typography>
        </Stack>
        <Stack direction="row" sx={{ alignItems: 'center', gap: 0.5 }}>
          <FontAwesomeIcon icon={faLocationDot} color={chrome.amber} aria-hidden="true" />
          <Typography component="span" sx={{ fontSize: 11, color: chrome.inkMuted }}>
            TARGET = your controller-set goal
          </Typography>
        </Stack>
      </Stack>

      {/*
        Relationship text — pending / confirmed transition (Gate-1 CR-001 /
        Gate-2 W-101: the PENDING case is worded + icon-distinct from a
        CONFIRMED commit, never the bare same string in the same aria-live
        region).
      */}
      <Stack
        direction="row"
        data-testid="escalation-dial-relationship"
        role="status"
        aria-live="polite"
        sx={{ alignItems: 'flex-start', gap: 0.5, mt: 0.75 }}
      >
        {isPending ? (
          <FontAwesomeIcon icon={faHourglassHalf} color={chrome.inkMuted} aria-hidden="true" />
        ) : null}
        <Typography component="p" sx={{ fontSize: 11, color: chrome.inkMuted, m: 0 }}>
          {relationshipText}
        </Typography>
      </Stack>

      {/*
        Write-failure notice (Gate-1 CR-001) — a rejected POST never reverts
        silently; icon + text (NFR-001), a distinct line from the
        relationship status above.
      */}
      {dial.writeError ? (
        <Stack
          direction="row"
          data-testid="escalation-dial-write-error"
          role="alert"
          sx={{ alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}
        >
          <FontAwesomeIcon icon={faTriangleExclamation} color={chrome.amber} aria-hidden="true" />
          <Typography component="p" sx={{ fontSize: 11, color: chrome.inkMuted, m: 0 }}>
            {dial.writeError}
          </Typography>
        </Stack>
      ) : null}

      {/*
        Story 09, AC4 — the honesty caveat. Never silently implies an
        immediate chase that will not happen: text + icon (NFR-001), not
        color-only, and not an aria-live interruption (it is contextual, not a
        fresh event notification like the relationship text above).
      */}
      {showTargetWontMoveCaveat ? (
        <Stack
          direction="row"
          data-testid="escalation-dial-target-caveat"
          sx={{ alignItems: 'flex-start', gap: 0.5, mt: 0.5 }}
        >
          <FontAwesomeIcon icon={faCircleInfo} color={chrome.inkMuted} aria-hidden="true" />
          <Typography component="p" sx={{ fontSize: 11, color: chrome.inkMuted, m: 0 }}>
            This target will not move intensity until the storyline reaches ESCALATING or PEAK
            (currently {dial.phaseLabel}).
          </Typography>
        </Stack>
      ) : null}
    </DialPanel>
  )
}
