/**
 * features/participant-shell/components/AlertBar/AlertBar.tsx
 * ---------------------------------------------------------------------------
 * The alert-bar host (feature: participant-shell, story 02; PRT-010/011/012,
 * NFR-001, COR-053; see docs/features/participant-shell/02-alert-bar-host.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §2 "Alert bar
 * component contract").
 *
 * The EAS analog — one alert host directly below the top compliance-chrome
 * banner (story 01) that PERSISTS across every channel (PRT-010). The shell
 * supplies the container, severities, collapse, stacking, scenario
 * timestamp, and the Details link-through (PRT-012); channels/controllers
 * supply alert CONTENT (out of scope here — see `useAlerts.ts`).
 *
 * SELF-CONTAINED (mirrors `ComplianceChrome.tsx`): reads its own
 * `useAlerts()` mock hook internally, so mounting `<AlertBar />` anywhere in
 * the participant shell needs no prop threading. Positions itself with
 * `position: fixed; top: var(--pulse-chrome-top, 0px)` — the SAME published
 * inset var name `ComplianceChrome` sets (`mountContract.ts`'s
 * `SHELL_CHROME_TOP_VAR`) — so it sits directly below the top chrome banner
 * whether chrome is on or off (D7-008), with no parent/child coupling to
 * `ComplianceChrome` itself (the shared CSS var name IS the contract, exactly
 * as that component's own header describes). Layered at `SHELL_Z.alertBar`
 * (above channel nav, below the overlay layer) per the z-order contract.
 *
 * ## Four states (story AC)
 * `none` (no active alerts) renders nothing — zero height, no reserved
 * space. Otherwise the host picks one of two TREATMENTS across the whole
 * active set (SHELL-CONTRACT.md §2, D7-002):
 *  - **`ticker`** (the decided DEFAULT, D7-002) — used whenever no active
 *    alert is `emergency`. A dark `#14181c` bar (one line on desktop widths;
 *    wraps on a phone — see "Mobile wrapping" below); a severity chip
 *    (icon + LABEL) using this alert's palette, a monospace message, the
 *    scenario timestamp, and the Details link. With more than one alert, it
 *    auto-rotates every {@link ROTATE_INTERVAL_MS} through ALL of them — the
 *    chip swaps color/label/icon to match whichever alert is currently
 *    showing.
 *  - **`emergencyBand`** — forced the instant ANY active alert is
 *    `emergency` (an emergency always escapes the ticker to the full band,
 *    SHELL-CONTRACT.md §2). Solid `#b3261e`, white text, NEVER collapses.
 *    Shows the highest-severity (emergency) alert plus a "+N more" chip when
 *    other alerts are also active, expanding the full stack in place.
 *
 * ## Collapse-on-scroll (ticker only)
 * SHELL-CONTRACT.md §2 is explicit that "the ticker is already one-line and
 * does not collapse" (only the alternate, unshipped "band" treatment
 * height-collapses) — yet the story's own AC requires "info/advisory
 * collapse on scroll ... re-expand on tap". This component reconciles the
 * two the same way: the ticker does not height-collapse into a band, but its
 * CONTENT DENSITY drops — scrolling past
 * {@link SCROLL_COLLAPSE_THRESHOLD_PX} hides the secondary anatomy (scenario
 * timestamp + Details link), leaving only the chip + message as a compact
 * strip (message clamped to two lines); tapping that compact strip re-expands
 * the full anatomy until the next scroll re-collapses it. The emergency band
 * ignores scroll entirely — it never collapses, by contract.
 *
 * ## Mobile wrapping (D0 §4.6 mobile-first, PRT-010 readability)
 * D7-002's "one-line ticker" holds wherever it fits. On a phone (390px) the
 * one-line form left ~3 characters of message ("Boi…"), so each row WRAPS:
 * the message is never ellipsized, and the timestamp + Details link drop to
 * a second line when they no longer fit beside it (`rowStyle` /
 * `messageStyle`). The bar's height therefore varies with content, which the
 * published `--pulse-alert-height` already reports — `ShellLayout` reserves
 * it in the shell's flow so nothing in-flow (the channel nav) sits under it.
 *
 * ## Accessibility (NFR-001 hard gate)
 * The host is `role="status"` (a polite, atomic live region by ARIA default;
 * emergency explicitly upgrades to `aria-live="assertive"` given the higher
 * urgency — SHELL-CONTRACT.md still names the ROLE as `status`, which this
 * preserves). Severity is carried by the chip's ICON *and* LABEL TEXT
 * together with color — never color alone. Content changes (a new/rotated
 * alert, a severity escalation) update the live region's text, so assistive
 * tech announces the change without any separate announcer element.
 *
 * ## Scenario time (COR-053)
 * Every rendered timestamp comes from `formatScenarioTime()` /
 * `useScenarioTime()` (`@/core/clock`) against the exercise's configured
 * `timeZone` (`useExerciseContext()`) — never wall-clock. `Alert.scenarioTime`
 * is a fixed WIRE instant (when the alert went active), not "now"; only the
 * rendering is bound to the live scenario clock.
 *
 * ## Publishing its own height (`--pulse-alert-height`)
 * Being `position: fixed`, the bar reserves no space -- so a channel's sticky
 * rails / headers / modal backdrop / skip link, which pin to the viewport top,
 * would slide UNDER an active alert. The bar therefore measures itself and
 * publishes its rendered height on `:root` as `SHELL_ALERT_HEIGHT_VAR` (px;
 * `0px` while no alert is active), kept current by a `ResizeObserver` (the ticker
 * wrapping, the emergency band's "+N more" stack expanding, an alert arriving or
 * clearing). A channel offsets its top pins by `chrome-top + alert-height`. The
 * var is removed when the last bar unmounts, so no stale inset outlives the shell.
 * Several bars at once (an outer shell + a `preview` shell) share the one `:root`
 * var: it carries the TALLEST, and only the last one out clears it -- the same
 * ref-counting `ComplianceChrome` uses for the chrome insets (WR-001).
 *
 * ## Vs a fullscreen element (`useExitFullscreenOnNewAlert`)
 * The browser paints a fullscreen element above EVERYTHING, this bar included, so a
 * channel's fullscreen video would hide a new alert indefinitely. When a NEW advisory or
 * emergency alert becomes active the bar leaves fullscreen ONCE for it (info does not);
 * re-entering fullscreen with the same alert still active is allowed. It uses
 * `core/dom/fullscreen` only -- the shell imports nothing from a channel.
 *
 * Never user-dismissable (PRT-010) — there is intentionally no close/dismiss
 * affordance anywhere in this component. Alerts here are in-fiction/simulated
 * only; a real-world message is the break-fiction overlay (story 05), never
 * this bar.
 *
 * World: participant. No COBRA, no MUI, no default MUI look (D0 §2) — plain
 * React + inline style, FontAwesome icons only.
 */

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { SHELL_ALERT_HEIGHT_VAR, SHELL_CHROME_TOP_VAR, SHELL_Z } from '../../mountContract'
import { useAlerts } from './useAlerts'
import { useExitFullscreenOnNewAlert } from './useExitFullscreenOnNewAlert'
import { AlertDetailsLink } from './AlertDetailsLink'
import { SeverityChip } from './SeverityChip'
import { SEVERITY_META, chipBaseStyle } from './severityMeta'
import type { Alert } from './alertTypes'
import { touchHitAreaCss } from '../touchHitArea'

/** Ticker auto-rotation interval (SHELL-CONTRACT.md §2: "~3.5s"). */
const ROTATE_INTERVAL_MS = 3500

/** Scroll distance past which the ticker collapses to its compact strip. */
const SCROLL_COLLAPSE_THRESHOLD_PX = 8

/**
 * Class on the compact band controls ("Details →", "+N more") that extends
 * their tap box to 44 px on coarse pointers without growing the band
 * (mobile-tablet story 05, gap G1: they measured 52×18 and 67×16 on phones).
 */
const TOUCH_HIT_CLASS = 'pulse-alert-bar-hit'
const TOUCH_HIT_STYLES = touchHitAreaCss(`.${TOUCH_HIT_CLASS}`)

const detailsLinkStyle: CSSProperties = {
  fontFamily: "'Figtree', system-ui, sans-serif",
  fontWeight: 600,
  fontSize: '12px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
  // Pins the link to the row's trailing edge -- including when the row wraps on
  // a phone and the timestamp + link drop to their own second line.
  marginLeft: 'auto',
  // Ticker default — a legible accent against the dark #14181c ticker bg.
  // The emergency band overrides this to white (see its inline usage below).
  color: '#8ab4f8',
}

const timestampStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontSize: '11px',
  opacity: 0.85,
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

/**
 * One alert row. WRAPS (mobile-first, D0 §4.6): on a desktop-width bar every
 * part fits on one line exactly as before; on a phone the fixed-width parts
 * (timestamp, Details link) drop to a second line instead of squeezing the
 * message to a few ellipsized characters. See {@link messageStyle}.
 */
const rowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  alignItems: 'center',
  columnGap: '10px',
  rowGap: '4px',
  minWidth: 0,
}

/**
 * The alert message. Never truncated -- the EAS analog must be READABLE
 * (PRT-010, NFR-001). It wraps across lines; `overflowWrap: anywhere` also
 * breaks a single unbroken token (a long URL) rather than overflowing.
 *
 * The `12rem` flex-basis is what drives the row's wrapping: it keeps the message
 * on the chip's line with at least ~12rem of width, and once the timestamp + link
 * no longer fit beside that, flexbox moves THEM to the next line (the message
 * then grows to take the whole remaining width of its line).
 */
const messageStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontSize: '13px',
  lineHeight: 1.35,
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
  minWidth: 0,
  flex: '1 1 12rem',
}

/**
 * The collapsed (scrolled) ticker's message: clamped to two lines so the compact
 * strip stays compact, but still far more than the old one-line ellipsis. The
 * FULL text stays available -- the strip's button `aria-label` carries it, and a
 * tap re-expands the bar.
 */
const collapsedMessageStyle: CSSProperties = {
  ...messageStyle,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
}

const hostBaseStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: `var(${SHELL_CHROME_TOP_VAR}, 0px)`,
  zIndex: SHELL_Z.alertBar,
  boxSizing: 'border-box',
  padding: '6px 14px',
}

const tickerHostStyle: CSSProperties = {
  ...hostBaseStyle,
  backgroundColor: '#14181c',
  color: '#e6e6e6',
}

const emergencyHostStyle: CSSProperties = {
  ...hostBaseStyle,
  backgroundColor: '#b3261e',
  color: '#ffffff',
}

/**
 * The `none` state (AC1): the live region stays MOUNTED (so the none→first-alert
 * transition is announced — see the return block) but collapses to zero height
 * with no padding/background, so it reserves NO space and is invisible.
 * `position: fixed` also keeps it out of normal flow, exactly like the visible
 * treatments — "no reserved space" holds.
 */
const noneHostStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  top: `var(${SHELL_CHROME_TOP_VAR}, 0px)`,
  height: 0,
  padding: 0,
  overflow: 'hidden',
  zIndex: SHELL_Z.alertBar,
}

/** Unstyled-button reset so the collapsed tap target reads as ticker content, not a control. */
const tapToExpandStyle: CSSProperties = {
  ...rowStyle,
  // A <button> shrink-wraps by default; full width gives the row room to wrap.
  width: '100%',
  minWidth: 0,
  background: 'none',
  border: 'none',
  padding: 0,
  margin: 0,
  color: 'inherit',
  font: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
}

const moreChipStyle: CSSProperties = {
  ...chipBaseStyle,
  backgroundColor: 'rgba(255, 255, 255, 0.18)',
  color: '#ffffff',
  border: 'none',
  cursor: 'pointer',
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
}

const stackListStyle: CSSProperties = {
  marginTop: '6px',
  display: 'flex',
  flexDirection: 'column',
  gap: '4px',
}

/**
 * Picks the alert to render for the current treatment: the first `emergency`
 * alert when one is present (emergency treatment), otherwise the alert at
 * `tickerIndex` (ticker treatment). Falls back to the first alert if the
 * index is momentarily out of range (`noUncheckedIndexedAccess` — never a
 * non-null assertion, WAVE0-REVIEW precedent 23) and, failing that, `null` —
 * which callers only reach when `alerts` is non-empty, so this is a type
 * guard against indexing, not an expected runtime path.
 */
function pickActiveAlert(
  alerts: readonly Alert[],
  hasEmergency: boolean,
  tickerIndex: number,
): Alert | null {
  const preferred = hasEmergency
    ? alerts.find(alert => alert.severity === 'emergency')
    : alerts[tickerIndex]
  return preferred ?? alerts[0] ?? null
}

/**
 * Rendered height of each live `AlertBar`, keyed per instance. The shared `:root`
 * var publishes the tallest (and is removed when the map empties) so one bar
 * unmounting never clears the inset a still-mounted sibling needs.
 */
const alertBarHeights = new Map<symbol, number>()

function publishAlertHeight(): void {
  const root = document.documentElement
  if (alertBarHeights.size === 0) {
    root.style.removeProperty(SHELL_ALERT_HEIGHT_VAR)
    return
  }
  root.style.setProperty(SHELL_ALERT_HEIGHT_VAR, `${Math.max(...alertBarHeights.values())}px`)
}

export function AlertBar() {
  const alerts = useAlerts()
  // A fullscreen element paints above this fixed bar: leave it once when a NEW advisory /
  // emergency alert arrives (see the hook's header for the tiers and the once-only rule).
  useExitFullscreenOnNewAlert(alerts)
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)

  // Publish this bar's rendered height (see the module header). A layout effect so
  // the inset is correct before the first paint; the observer keeps it current.
  // `ResizeObserver` is feature-detected (jsdom has none): the initial measurement
  // still publishes.
  const hostRef = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const host = hostRef.current
    if (host === null) return
    const id = Symbol('alert-bar')
    const measure = () => {
      alertBarHeights.set(id, host.getBoundingClientRect().height)
      publishAlertHeight()
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(host)
    return () => {
      observer?.disconnect()
      alertBarHeights.delete(id)
      publishAlertHeight()
    }
  }, [])

  const hasEmergency = alerts.some(alert => alert.severity === 'emergency')
  const treatment: 'none' | 'ticker' | 'emergencyBand' =
    alerts.length === 0 ? 'none' : hasEmergency ? 'emergencyBand' : 'ticker'

  // Ticker auto-rotation (multi-alert AC) — only runs for the ticker
  // treatment, and only when there is more than one alert to rotate through.
  const [tickerIndex, setTickerIndex] = useState(0)
  useEffect(() => {
    if (treatment !== 'ticker' || alerts.length <= 1) return
    const id = setInterval(() => {
      setTickerIndex(current => (current + 1) % alerts.length)
    }, ROTATE_INTERVAL_MS)
    return () => clearInterval(id)
  }, [treatment, alerts.length])
  // A shrinking alert list can leave a stale index — wrap it back in range
  // rather than indexing out of bounds.
  const safeTickerIndex = alerts.length === 0 ? 0 : tickerIndex % alerts.length

  // Collapse-on-scroll (ticker only; the emergency band never collapses —
  // see module header). `manuallyExpanded` is the "tap re-expands" override;
  // any further scroll event recomputes it fresh, so a tap only holds the
  // full anatomy open until the next scroll.
  const [scrolledPast, setScrolledPast] = useState(false)
  const [manuallyExpanded, setManuallyExpanded] = useState(false)
  useEffect(() => {
    if (treatment !== 'ticker') return
    const onScroll = () => {
      setScrolledPast(window.scrollY > SCROLL_COLLAPSE_THRESHOLD_PX)
      setManuallyExpanded(false)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [treatment])
  const collapsed = treatment === 'ticker' && scrolledPast && !manuallyExpanded

  // "+N more" stack expansion (emergency band multi-alert AC only).
  const [stackExpanded, setStackExpanded] = useState(false)

  // A single, ALWAYS-MOUNTED live region. A `role="status"` inserted into the
  // DOM already-populated is not reliably announced by assistive tech, so the
  // most important transition — `none` → the first alert (which may itself be
  // an emergency) — would be SILENT if the bar returned `null` while empty.
  // Keeping ONE persistent host means the region exists (empty) before any
  // content arrives, so every state change announces. In `none` it carries
  // `noneHostStyle` (zero-height, no padding, out of flow), so AC1's "no
  // reserved space" still holds — the region is present but invisible.
  const activeAlert =
    treatment === 'none' ? null : pickActiveAlert(alerts, hasEmergency, safeTickerIndex)
  const liveAnnounceLevel = activeAlert?.severity === 'emergency' ? 'assertive' : 'polite'
  const otherAlerts =
    activeAlert && treatment === 'emergencyBand'
      ? alerts.filter(alert => alert.id !== activeAlert.id)
      : []
  const hostStyle =
    treatment === 'none'
      ? noneHostStyle
      : treatment === 'emergencyBand'
        ? emergencyHostStyle
        : tickerHostStyle
  const dataTreatment =
    treatment === 'none' ? 'none' : treatment === 'emergencyBand' ? 'band' : 'ticker'

  return (
    <>
      {/* Outside the live region so the stylesheet is never part of an announcement. */}
      <style>{TOUCH_HIT_STYLES}</style>
      <div
        ref={hostRef}
        role="status"
        aria-live={liveAnnounceLevel}
        aria-atomic="true"
        data-testid="pulse-alert-bar"
        data-alert-severity={activeAlert?.severity ?? 'none'}
        data-alert-treatment={dataTreatment}
        style={hostStyle}
      >
        {treatment === 'emergencyBand' && activeAlert && (
          <>
            <div style={rowStyle}>
              <SeverityChip severity={activeAlert.severity} />
              <span data-testid="pulse-alert-bar-message" style={messageStyle}>
                {activeAlert.message}
              </span>
              <span data-testid="pulse-alert-bar-timestamp" style={timestampStyle}>
                {format(activeAlert.scenarioTime)}
              </span>
              <AlertDetailsLink
                className={TOUCH_HIT_CLASS}
                style={{ ...detailsLinkStyle, color: '#ffffff' }}
              >
                Details →
              </AlertDetailsLink>
              {otherAlerts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setStackExpanded(current => !current)}
                  aria-expanded={stackExpanded}
                  aria-controls="pulse-alert-bar-stack"
                  data-testid="pulse-alert-bar-more-chip"
                  className={TOUCH_HIT_CLASS}
                  style={moreChipStyle}
                >
                  +{otherAlerts.length} more
                </button>
              )}
            </div>
            {stackExpanded && (
              <div id="pulse-alert-bar-stack" data-testid="pulse-alert-bar-stack" style={stackListStyle}>
                {otherAlerts.map(alert => (
                  <div key={alert.id} data-testid="pulse-alert-bar-stack-item" style={rowStyle}>
                    <SeverityChip severity={alert.severity} />
                    <span style={messageStyle}>{alert.message}</span>
                    <span style={timestampStyle}>{format(alert.scenarioTime)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
        {treatment === 'ticker' && activeAlert && (
          collapsed ? (
            <button
              type="button"
              onClick={() => setManuallyExpanded(true)}
              aria-label={`${SEVERITY_META[activeAlert.severity].label} alert: ${activeAlert.message}. Tap for details.`}
              data-testid="pulse-alert-bar-expand"
              style={tapToExpandStyle}
            >
              <SeverityChip severity={activeAlert.severity} />
              <span data-testid="pulse-alert-bar-message" style={collapsedMessageStyle}>
                {activeAlert.message}
              </span>
            </button>
          ) : (
            <div style={rowStyle}>
              <SeverityChip severity={activeAlert.severity} />
              <span data-testid="pulse-alert-bar-message" style={messageStyle}>
                {activeAlert.message}
              </span>
              <span data-testid="pulse-alert-bar-timestamp" style={timestampStyle}>
                {format(activeAlert.scenarioTime)}
              </span>
              <AlertDetailsLink className={TOUCH_HIT_CLASS} style={detailsLinkStyle}>
                Details →
              </AlertDetailsLink>
            </div>
          )
        )}
      </div>
    </>
  )
}
