/**
 * features/participant-shell/components/OverlayLayer/OverlayLayer.tsx
 * ---------------------------------------------------------------------------
 * The overlay layer (feature: participant-shell, story 05; COR-065,
 * CTL-023/024, COR-054, NFR-001/008; see
 * docs/features/participant-shell/05-overlay-layer.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §3).
 *
 * Self-contained, exactly like `ComplianceChrome.tsx`: it reads its OWN mock
 * state (`useOverlayState()`, `./overlayState.ts`) and renders directly, so a
 * caller drops `<OverlayLayer />` in once near the shell root — alongside
 * `<ComplianceChrome />`, as a SIBLING of `<ShellLayout>`, never inside its
 * content region — with no prop threading. This story RENDERS mock overlay
 * state only; it does not build the triggers that set it (world-steering
 * #26/#27, STORY-UPDATES §B) or the SignalR push that will one day deliver it
 * (`./overlayState.ts`'s module header).
 *
 * Three families, per `SHELL-CONTRACT.md` §3:
 *
 *  1. **Break-fiction** (`state: 'broadcast'`, CTL-024/D7-003) — the one
 *     alarm treatment. Rendered at `SHELL_Z.breakFiction`, ABOVE compliance
 *     chrome, covering EVERYTHING. It is deliberately ALIEN to both worlds by
 *     design (black/amber hazard, monospace, wall-clock) — not a "no COBRA on
 *     participant surfaces" violation, and not a participant brand skin
 *     either: no logo, no product type/color from either world, so a real
 *     control message can never be mistaken for in-fiction content or for
 *     COBRA staff chrome. Its wall-clock read is COR-053's sole exception
 *     (`./wallClock.ts`).
 *  2. **Pause** (`state: 'pause'`, CTL-023/D7-004) and **3. EndEx**
 *     (`state: 'endex'`, COR-054) — the calm control-page family, rendered at
 *     `SHELL_Z.overlay` (above content/nav/alert-bar, below chrome). Each has
 *     an `'in-fiction'` register (neutral, system-ui, ZERO exercise language
 *     — reads like an ordinary "service unavailable" page) and an
 *     `'out-of-fiction'` register (slate `#1b232c`/mono, names the exercise
 *     explicitly). Holding-page CONTENT AUTHORING (COR-032) is out of scope —
 *     the copy here is static, generic filler, not per-exercise configured
 *     text.
 *
 * None of the four control-page renders (pause/endex × register) — nor
 * break-fiction — include a dismiss control: overlays are server-pushed
 * states, not user actions (AC "not user-dismissable"); they clear only when
 * `useOverlayState()`'s resolved `state` changes.
 *
 * A11y (NFR-001): each render is a modal region (`role="dialog"` /
 * `role="alertdialog"` for break-fiction's higher urgency, `aria-modal`,
 * `aria-labelledby` pointing at its own heading) and focus-trapped via
 * `useOverlayFocusTrap` — see that module for why a sibling-mounted overlay
 * needs an active trap rather than relying on DOM order/visual stacking
 * alone.
 *
 * Watermark readiness (NFR-008): the in-fiction control pages are the one
 * register here with ZERO exercise language of their own — if compliance
 * chrome is ALSO disabled (a legal state, D7-008), there would be no exercise
 * signal on screen at all. `ExerciseWatermarkSlot` reserves that fallback
 * signal, driven by `chromeConfig.ts`'s `isWatermarkRequired()` (the same
 * signal that feature already exposes) — it renders nothing while chrome is
 * on. Out-of-fiction pages already say "EXERCISE" explicitly and don't need
 * it; break-fiction is explicitly forbidden from carrying ANY such signal (an
 * "EXERCISE" mark would defeat break-fiction's entire premise of reading as
 * genuinely real).
 *
 * World: participant, except break-fiction (alien to both worlds by design —
 * see point 1 above). No COBRA, no MUI, no default MUI look — plain React +
 * inline style, mirroring `ComplianceChrome.tsx`.
 */

import { useEffect, useId, useState, type CSSProperties, type RefObject } from 'react'
import { SHELL_Z } from '../../mountContract'
import { isWatermarkRequired, useChromeConfig } from '../../chromeConfig'
import { useOverlayState } from './overlayState'
import { useOverlayFocusTrap } from './useOverlayFocusTrap'
import { formatWallClockNow, readWallClockNow } from './wallClock'

// -----------------------------------------------------------------------------
// Static copy (holding-page CONTENT AUTHORING, COR-032, is out of scope for
// this story — these are generic, non-configured placeholders, not per-
// exercise authored text).
// -----------------------------------------------------------------------------

const PAUSE_IN_FICTION_HEADING = "We'll be right back"
const PAUSE_IN_FICTION_BODY =
  'This service is temporarily unavailable. Please check back shortly.'

const PAUSE_OUT_OF_FICTION_HEADING = 'EXERCISE PAUSED'
const PAUSE_OUT_OF_FICTION_BODY =
  'Scenario clock stopped. Participant channels are held until exercise control resumes.'

const ENDEX_IN_FICTION_HEADING = 'This service is no longer available'
const ENDEX_IN_FICTION_BODY = 'Thank you for visiting.'

const ENDEX_OUT_OF_FICTION_HEADING = 'ENDEX'
const ENDEX_OUT_OF_FICTION_BODY =
  "Exercise concluded. Report to the hot wash per your controller's instructions."

/** Exact AC copy (CTL-024) — matched verbatim, not paraphrased. */
const BREAK_FICTION_HEADER = 'REAL-WORLD MESSAGE · EXERCISE CONTROL'
const BREAK_FICTION_REMAINS_LINE =
  'This message remains in effect until cleared by exercise control.'

// -----------------------------------------------------------------------------
// Styles. Layout facts only (position/size/z-index/type); no channel/brand
// styling ever lives here — see the module header.
// -----------------------------------------------------------------------------

const fullViewportStyle: CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  boxSizing: 'border-box',
}

const inFictionPageStyle: CSSProperties = {
  ...fullViewportStyle,
  zIndex: SHELL_Z.overlay,
  backgroundColor: '#f7f7f8',
  color: '#1a1a1a',
  fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
  padding: '24px',
  textAlign: 'center',
}

const inFictionCardStyle: CSSProperties = {
  maxWidth: '420px',
}

const inFictionHeadingStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '22px',
  fontWeight: 600,
}

const inFictionBodyStyle: CSSProperties = {
  margin: 0,
  fontSize: '15px',
  lineHeight: 1.5,
  color: '#4a4a4a',
}

const outOfFictionPageStyle: CSSProperties = {
  ...fullViewportStyle,
  zIndex: SHELL_Z.overlay,
  backgroundColor: '#1b232c',
  color: '#e6edf3',
  fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
  padding: '24px',
  textAlign: 'center',
}

const outOfFictionCardStyle: CSSProperties = {
  maxWidth: '480px',
}

const outOfFictionHeadingStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '0.08em',
}

const outOfFictionBodyStyle: CSSProperties = {
  margin: 0,
  fontSize: '14px',
  lineHeight: 1.6,
  color: '#aab6c2',
}

const breakFictionContainerStyle: CSSProperties = {
  ...fullViewportStyle,
  zIndex: SHELL_Z.breakFiction,
  flexDirection: 'column',
  backgroundColor: '#0d0d0d',
  color: '#ffb300',
  fontFamily: 'ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
}

/** The amber/black hazard-stripe bar, top and bottom of the break-fiction field. */
const hazardBarStyle: CSSProperties = {
  flexShrink: 0,
  width: '100%',
  height: '18px',
  backgroundImage:
    'repeating-linear-gradient(45deg, #ffb300, #ffb300 20px, #0d0d0d 20px, #0d0d0d 40px)',
}

const breakFictionBodyStyle: CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '18px',
  padding: '24px',
  textAlign: 'center',
}

const breakFictionHeadingStyle: CSSProperties = {
  margin: 0,
  fontSize: '20px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
}

const breakFictionMessageStyle: CSSProperties = {
  margin: 0,
  maxWidth: '640px',
  fontSize: '18px',
  lineHeight: 1.6,
}

const breakFictionMetaStyle: CSSProperties = {
  margin: 0,
  fontSize: '13px',
  letterSpacing: '0.04em',
  color: '#e6a800',
}

const watermarkSlotStyle: CSSProperties = {
  position: 'absolute',
  bottom: '12px',
  right: '16px',
  fontSize: '11px',
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'rgba(0, 0, 0, 0.35)',
  pointerEvents: 'none',
}

// -----------------------------------------------------------------------------
// Internal helpers
// -----------------------------------------------------------------------------

/**
 * Ticks once a second while `active`, seeded from `readWallClockNow()` (the
 * feature's one wall-clock read, `./wallClock.ts`). Idle (no interval) while
 * inactive so no other overlay state pays for a timer it doesn't render.
 */
function useWallClockNow(active: boolean): Date {
  const [now, setNow] = useState<Date>(() => readWallClockNow())

  useEffect(() => {
    if (!active) return undefined
    const id = setInterval(() => setNow(readWallClockNow()), 1000)
    return () => clearInterval(id)
  }, [active])

  return now
}

/**
 * The NFR-008 reserved watermark slot — see the module header. Renders
 * nothing unless compliance chrome is disabled (`isWatermarkRequired`,
 * `chromeConfig.ts`); non-interactive, announced as supplementary context
 * (mirrors `ComplianceChrome`'s `role="note"` treatment).
 */
function ExerciseWatermarkSlot() {
  const chromeConfig = useChromeConfig()
  if (!isWatermarkRequired(chromeConfig)) return null

  return (
    <div
      role="note"
      aria-label="Exercise watermark"
      data-testid="pulse-overlay-watermark-slot"
      style={watermarkSlotStyle}
    >
      EXERCISE
    </div>
  )
}

interface ControlPageProps {
  containerRef: RefObject<HTMLDivElement | null>
  variant: 'pause' | 'endex'
}

/** The in-fiction control-page register: neutral, system-ui, zero exercise language. */
function InFictionMaintenancePage({ containerRef, variant }: ControlPageProps) {
  const headingId = useId()
  const heading = variant === 'pause' ? PAUSE_IN_FICTION_HEADING : ENDEX_IN_FICTION_HEADING
  const body = variant === 'pause' ? PAUSE_IN_FICTION_BODY : ENDEX_IN_FICTION_BODY
  const testId = variant === 'pause'
    ? 'pulse-overlay-pause-in-fiction'
    : 'pulse-overlay-endex-in-fiction'

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid={testId}
      style={inFictionPageStyle}
    >
      <div style={inFictionCardStyle}>
        <h1
          id={headingId}
          style={inFictionHeadingStyle}
        >
          {heading}
        </h1>
        <p style={inFictionBodyStyle}>{body}</p>
      </div>
      <ExerciseWatermarkSlot />
    </div>
  )
}

/** The out-of-fiction control-page register: calm slate/mono, names the exercise explicitly. */
function OutOfFictionControlPage({ containerRef, variant }: ControlPageProps) {
  const headingId = useId()
  const heading = variant === 'pause' ? PAUSE_OUT_OF_FICTION_HEADING : ENDEX_OUT_OF_FICTION_HEADING
  const body = variant === 'pause' ? PAUSE_OUT_OF_FICTION_BODY : ENDEX_OUT_OF_FICTION_BODY
  const testId = variant === 'pause'
    ? 'pulse-overlay-pause-out-of-fiction'
    : 'pulse-overlay-endex-out-of-fiction'

  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid={testId}
      style={outOfFictionPageStyle}
    >
      <div style={outOfFictionCardStyle}>
        <h1
          id={headingId}
          style={outOfFictionHeadingStyle}
        >
          {heading}
        </h1>
        <p style={outOfFictionBodyStyle}>{body}</p>
      </div>
    </div>
  )
}

interface BreakFictionOverlayProps {
  containerRef: RefObject<HTMLDivElement | null>
  message: string
  wallClockNow: Date
}

/**
 * The break-fiction broadcast (CTL-024/D7-003) — the one alarm treatment,
 * alien to both worlds by design. `role="alertdialog"` (rather than plain
 * `"dialog"`) for its higher urgency — see the module header's a11y note.
 */
function BreakFictionOverlay({ containerRef, message, wallClockNow }: BreakFictionOverlayProps) {
  const headingId = useId()

  return (
    <div
      ref={containerRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={headingId}
      tabIndex={-1}
      data-testid="pulse-overlay-break-fiction"
      style={breakFictionContainerStyle}
    >
      <div
        aria-hidden="true"
        data-testid="pulse-overlay-break-fiction-hazard-bar"
        style={hazardBarStyle}
      />
      <div style={breakFictionBodyStyle}>
        <p
          id={headingId}
          style={breakFictionHeadingStyle}
        >
          {BREAK_FICTION_HEADER}
        </p>
        <p style={breakFictionMessageStyle}>{message}</p>
        <p style={breakFictionMetaStyle}>
          {`WALL CLOCK: ${formatWallClockNow(wallClockNow)}`}
        </p>
        <p style={breakFictionMetaStyle}>{BREAK_FICTION_REMAINS_LINE}</p>
      </div>
      <div
        aria-hidden="true"
        data-testid="pulse-overlay-break-fiction-hazard-bar"
        style={hazardBarStyle}
      />
    </div>
  )
}

/**
 * Mount once, near the root of the participant shell (alongside
 * `<ComplianceChrome />`, as a sibling of `<ShellLayout>`) — see the module
 * header. Renders nothing while `state === 'none'`.
 */
export function OverlayLayer() {
  const { state, register, message } = useOverlayState()
  const isActive = state !== 'none'
  const isBreakFiction = state === 'broadcast'

  const containerRef = useOverlayFocusTrap<HTMLDivElement>(isActive)
  const wallClockNow = useWallClockNow(isBreakFiction)

  if (state === 'none') return null

  if (state === 'broadcast') {
    return (
      <BreakFictionOverlay
        containerRef={containerRef}
        message={message}
        wallClockNow={wallClockNow}
      />
    )
  }

  const PageComponent = register === 'in-fiction' ? InFictionMaintenancePage : OutOfFictionControlPage

  return (
    <PageComponent
      containerRef={containerRef}
      variant={state}
    />
  )
}
