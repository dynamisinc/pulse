/**
 * features/participant-shell/components/AlertBar/AlertsHistory.tsx
 * ---------------------------------------------------------------------------
 * The alerts "Details" view content (PRT-012) — what the alert bar's
 * "Details →" link opens at {@link ALERTS_PATH}.
 *
 * The bar can only show ONE alert at a time (the ticker rotates; the
 * emergency band shows the emergency and a "+N more" chip), so this view is
 * where a participant reads EVERY active alert in full: severity chip
 * (icon + LABEL — never color-only, NFR-001), the complete message, and the
 * scenario time it went active (COR-053 — never wall-clock).
 *
 * Ordering: most severe first (emergency → advisory → info), then newest
 * first within a severity — the order a participant should act on them.
 *
 * Data: the SAME `useAlerts()` seam the bar reads, so the view and the bar
 * can never disagree about what is active. A full alert HISTORY (expired /
 * cleared alerts) needs the backend's `/alerts` feed and is out of scope;
 * until then this lists the active set.
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
import { useAlerts } from './useAlerts'
import { sortAlertsForHistory } from './sortAlertsForHistory'

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

export function AlertsHistory() {
  const alerts = useAlerts()
  const { timeZone } = useExerciseContext()
  const { format } = useScenarioTime(timeZone)
  const sorted = sortAlertsForHistory(alerts)

  return (
    <section
      aria-labelledby="pulse-alerts-history-heading"
      style={sectionStyle}
      data-testid="pulse-alerts-history"
    >
      <h1 id="pulse-alerts-history-heading" style={headingStyle}>
        Alerts
      </h1>
      {sorted.length === 0 ? (
        <p style={emptyStyle} data-testid="pulse-alerts-history-empty">
          No active alerts.
        </p>
      ) : (
        <ul style={listStyle}>
          {sorted.map(alert => (
            <li key={alert.id} style={itemStyle} data-testid="pulse-alerts-history-item">
              <SeverityChip severity={alert.severity} />
              <p style={messageStyle}>{alert.message}</p>
              <time dateTime={alert.scenarioTime} style={timeStyle}>
                {format(alert.scenarioTime)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
