/**
 * features/participant-shell/components/AlertBar/AlertsHistory.tsx
 * ---------------------------------------------------------------------------
 * The alerts history view (PRT-012) — what the alert bar's "Details →" link
 * opens at {@link ALERTS_PATH} for an alert with no source item.
 *
 * Data: `GET /alerts/history` via `useAlertsHistory()` (channels-foundation
 * story 11, #707) — EVERY alert of the exercise, cleared and expired included,
 * REVERSE-CHRONOLOGICAL (newest first, the server's order), one page at a
 * time with "Show older alerts". The bar shows what is active now; this is the
 * record. It is refreshed by every `AlertsChanged` push (`useAlerts()`).
 *
 * Each entry: severity chip (icon + LABEL — never color-only, NFR-001), the
 * complete message verbatim (WX-011), the scenario time it was issued (COR-053
 * — never wall-clock), and "Details →" to its source item when it has one.
 *
 * Ownership: the shell owns the CONTENT (alert data + severity vocabulary);
 * the mounted channel owns the ROUTE and its frame (back header) — see
 * `features/social/layout/routes/AlertsRoute.tsx`.
 *
 * World: participant. No COBRA, no MUI — plain React + inline style,
 * FontAwesome icons only (via `SeverityChip`).
 */

import type { CSSProperties } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import { SeverityChip } from './SeverityChip'
import { AlertDetailsLink } from './AlertDetailsLink'
import { useAlertsHistory } from './useAlertsHistory'
import { touchTargetCss } from '../touchTarget'

const sectionStyle: CSSProperties = {
  boxSizing: 'border-box',
  padding: '12px 16px 24px',
  fontFamily: "'Figtree', system-ui, sans-serif",
  color: '#1f2328',
}

const headingStyle: CSSProperties = {
  margin: '0 0 12px',
  fontSize: '20px',
  fontWeight: 700,
}

const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: '10px',
}

const itemStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '6px',
  padding: '12px',
  border: '1px solid #e3e3e3',
  borderRadius: '10px',
  background: '#ffffff',
}

const messageStyle: CSSProperties = {
  margin: 0,
  fontSize: '15px',
  lineHeight: 1.45,
  overflowWrap: 'anywhere',
}

const timeStyle: CSSProperties = {
  fontFamily: "'JetBrains Mono', 'Courier New', monospace",
  fontSize: '12px',
  // #5a6470 on white is ~6:1 — clears WCAG 2.1 AA for normal text.
  color: '#5a6470',
}

const emptyStyle: CSSProperties = {
  margin: 0,
  fontSize: '15px',
  color: '#5a6470',
}

const detailsLinkStyle: CSSProperties = {
  fontFamily: "'Figtree', system-ui, sans-serif",
  fontWeight: 600,
  fontSize: '13px',
  // #0b5cad on white is ~6.6:1 — clears WCAG 2.1 AA for normal text.
  color: '#0b5cad',
}

const loadMoreStyle: CSSProperties = {
  marginTop: '12px',
  padding: '8px 14px',
  border: '1px solid #c4c9cf',
  borderRadius: '8px',
  background: '#ffffff',
  color: '#1f2328',
  font: "600 14px 'Figtree', system-ui, sans-serif",
  cursor: 'pointer',
}

/** Real 44 px targets on coarse pointers (mobile-tablet story 05). */
const TOUCH_TARGET_CLASS = 'pulse-alerts-history-hit'
const TOUCH_TARGET_STYLES = touchTargetCss(`.${TOUCH_TARGET_CLASS}`)

export function AlertsHistory() {
  const { alerts, isLoading, isError, hasMore, isLoadingMore, loadMore } = useAlertsHistory()
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)

  return (
    <section
      aria-labelledby="pulse-alerts-history-heading"
      aria-busy={isLoading || isLoadingMore}
      style={sectionStyle}
      data-testid="pulse-alerts-history"
    >
      <style>{TOUCH_TARGET_STYLES}</style>
      <h1 id="pulse-alerts-history-heading" style={headingStyle}>
        Alerts
      </h1>
      {isLoading ? (
        <p style={emptyStyle} data-testid="pulse-alerts-history-loading">
          Loading alerts…
        </p>
      ) : isError ? (
        <p style={emptyStyle} data-testid="pulse-alerts-history-error">
          Alerts can’t be shown right now.
        </p>
      ) : alerts.length === 0 ? (
        <p style={emptyStyle} data-testid="pulse-alerts-history-empty">
          No alerts have been issued.
        </p>
      ) : (
        <>
          <ul style={listStyle}>
            {alerts.map(alert => (
              <li key={alert.id} style={itemStyle} data-testid="pulse-alerts-history-item">
                <SeverityChip severity={alert.severity} />
                <p style={messageStyle}>{alert.message}</p>
                <time dateTime={alert.scenarioTime} style={timeStyle}>
                  {format(alert.scenarioTime)}
                </time>
                {typeof alert.href === 'string' && (
                  <AlertDetailsLink
                    href={alert.href}
                    className={TOUCH_TARGET_CLASS}
                    style={detailsLinkStyle}
                    testId="pulse-alerts-history-details"
                  >
                    Details →
                  </AlertDetailsLink>
                )}
              </li>
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={loadMore}
              disabled={isLoadingMore}
              className={TOUCH_TARGET_CLASS}
              style={loadMoreStyle}
              data-testid="pulse-alerts-history-more"
            >
              {isLoadingMore ? 'Loading older alerts…' : 'Show older alerts'}
            </button>
          )}
        </>
      )}
    </section>
  )
}
