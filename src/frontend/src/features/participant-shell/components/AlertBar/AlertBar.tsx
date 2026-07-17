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
 *    alert is `emergency`. A dark `#14181c` one-line bar; a severity chip
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
 * two the same way: the ticker's HEIGHT never changes (it is always exactly
 * one line, per D7-002), but its CONTENT DENSITY does — scrolling past
 * {@link SCROLL_COLLAPSE_THRESHOLD_PX} hides the secondary anatomy (scenario
 * timestamp + Details link), leaving only the chip + message as a compact
 * strip; tapping that compact strip re-expands the full anatomy until the
 * next scroll re-collapses it. The emergency band ignores scroll entirely —
 * it never collapses, by contract.
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
 * Never user-dismissable (PRT-010) — there is intentionally no close/dismiss
 * affordance anywhere in this component. Alerts here are in-fiction/simulated
 * only; a real-world message is the break-fiction overlay (story 05), never
 * this bar.
 *
 * World: participant. No COBRA, no MUI, no default MUI look (D0 §2) — plain
 * React + inline style, FontAwesome icons only.
 */

import { useEffect, useState, type CSSProperties } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faBullhorn, faCircleInfo, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { SHELL_CHROME_TOP_VAR, SHELL_Z } from '../../mountContract'
import { useAlerts } from './useAlerts'
import type { Alert, AlertSeverity } from './alertTypes'

/** Ticker auto-rotation interval (SHELL-CONTRACT.md §2: "~3.5s"). */
const ROTATE_INTERVAL_MS = 3500

/** Scroll distance past which the ticker collapses to its compact strip. */
const SCROLL_COLLAPSE_THRESHOLD_PX = 8

/**
 * Placeholder alerts-history target (PRT-012). The history PAGE is out of
 * scope for this story — only the link-through affordance is required.
 */
const ALERTS_HISTORY_HREF = '/alerts'

interface SeverityMeta {
  readonly label: string
  readonly icon: IconDefinition
  /** Chip background — D1/D2 palette (info/advisory), or emergency's translucent-on-red pill. */
  readonly chipBg: string
  /** Chip icon/text color. */
  readonly chipFg: string
}

/**
 * Severity chip palette (SHELL-CONTRACT.md §2 convention): the CHIP — and the
 * ticker's severity tab — is the SATURATED severity color with a WHITE LABEL
 * (info `#3d6a96`, advisory `#8a5a00`), matching the D7 mockups' `.tk-*` ticker
 * tabs / `.ab-* .chip` band chips and the README ticker spec. The pale
 * `#edf3f9` / `#fff3dd` tints are the alternate BAND *container* background,
 * NOT the chip. Advisory was darkened from the D1/D2 `#b97a00` to `#8a5a00` so
 * white-on-amber clears WCAG AA (4.5:1) on the 11px bold LABEL — `#b97a00`
 * rendered ~3.3–3.6:1 in every arrangement, failing NFR-001 (DECISIONS.md
 * D7-012, participant-shell story 02 Gate-1). Emergency's chip is a translucent
 * white pill (not its own hue) because the surrounding band is ALREADY solid
 * `#b3261e` — a same-color chip would be invisible against it; the band
 * background itself carries the "solid #b3261e, white text" requirement.
 */
const SEVERITY_META: Record<AlertSeverity, SeverityMeta> = {
  info: { label: 'INFO', icon: faCircleInfo, chipBg: '#3d6a96', chipFg: '#ffffff' },
  advisory: { label: 'ADVISORY', icon: faTriangleExclamation, chipBg: '#8a5a00', chipFg: '#ffffff' },
  emergency: { label: 'EMERGENCY', icon: faBullhorn, chipBg: 'rgba(255, 255, 255, 0.18)', chipFg: '#ffffff' },
}

const chipBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '6px',
  padding: '2px 8px',
  borderRadius: '999px',
  fontFamily: "'Figtree', system-ui, sans-serif",
  fontWeight: 700,
  fontSize: '11px',
  letterSpacing: '0.06em',
  whiteSpace: 'nowrap',
  flexShrink: 0,
}

/**
 * The severity chip: icon + LABEL text + color, together (NFR-001 — severity
 * is never color-only). Shared by both the ticker and the emergency band.
 */
function SeverityChip({ severity }: { severity: AlertSeverity }) {
  const meta = SEVERITY_META[severity]
  return (
    <span
      data-testid="pulse-alert-bar-chip"
      data-alert-severity={severity}
      style={{ ...chipBaseStyle, backgroundColor: meta.chipBg, color: meta.chipFg }}
    >
      <FontAwesomeIcon icon={meta.icon} aria-hidden="true" />
      {meta.label}
    </span>
  )
}

const detailsLinkStyle: CSSProperties = {
  fontFamily: "'Figtree', system-ui, sans-serif",
  fontWeight: 600,
  fontSize: '12px',
  whiteSpace: 'nowrap',
  flexShrink: 0,
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

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  minWidth: 0,
}

const messageStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontSize: '13px',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  minWidth: 0,
  flex: '1 1 auto',
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

/** Unstyled-button reset so the collapsed tap target reads as ticker content, not a control. */
const tapToExpandStyle: CSSProperties = {
  ...rowStyle,
  flex: '1 1 auto',
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

export function AlertBar() {
  const alerts = useAlerts()
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)

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

  if (treatment === 'none') return null

  const activeAlert = pickActiveAlert(alerts, hasEmergency, safeTickerIndex)
  if (!activeAlert) return null // Unreachable given the `alerts.length === 0` guard above.

  const liveAnnounceLevel = activeAlert.severity === 'emergency' ? 'assertive' : 'polite'

  if (treatment === 'emergencyBand') {
    const otherAlerts = alerts.filter(alert => alert.id !== activeAlert.id)

    return (
      <div
        role="status"
        aria-live={liveAnnounceLevel}
        aria-atomic="true"
        data-testid="pulse-alert-bar"
        data-alert-severity={activeAlert.severity}
        data-alert-treatment="band"
        style={emergencyHostStyle}
      >
        <div style={rowStyle}>
          <SeverityChip severity={activeAlert.severity} />
          <span data-testid="pulse-alert-bar-message" style={messageStyle}>
            {activeAlert.message}
          </span>
          <span data-testid="pulse-alert-bar-timestamp" style={timestampStyle}>
            {format(activeAlert.scenarioTime)}
          </span>
          <a
            href={ALERTS_HISTORY_HREF}
            data-testid="pulse-alert-bar-details"
            style={{ ...detailsLinkStyle, color: '#ffffff' }}
          >
            Details →
          </a>
          {otherAlerts.length > 0 && (
            <button
              type="button"
              onClick={() => setStackExpanded(current => !current)}
              aria-expanded={stackExpanded}
              aria-controls="pulse-alert-bar-stack"
              data-testid="pulse-alert-bar-more-chip"
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
      </div>
    )
  }

  // Ticker (default treatment, D7-002).
  return (
    <div
      role="status"
      aria-live={liveAnnounceLevel}
      aria-atomic="true"
      data-testid="pulse-alert-bar"
      data-alert-severity={activeAlert.severity}
      data-alert-treatment="ticker"
      style={tickerHostStyle}
    >
      {collapsed ? (
        <button
          type="button"
          onClick={() => setManuallyExpanded(true)}
          aria-label={`${SEVERITY_META[activeAlert.severity].label} alert: ${activeAlert.message}. Tap for details.`}
          data-testid="pulse-alert-bar-expand"
          style={tapToExpandStyle}
        >
          <SeverityChip severity={activeAlert.severity} />
          <span data-testid="pulse-alert-bar-message" style={messageStyle}>
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
          <a href={ALERTS_HISTORY_HREF} data-testid="pulse-alert-bar-details" style={detailsLinkStyle}>
            Details →
          </a>
        </div>
      )}
    </div>
  )
}
