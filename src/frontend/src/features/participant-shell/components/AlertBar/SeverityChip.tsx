/**
 * features/participant-shell/components/AlertBar/SeverityChip.tsx
 * ---------------------------------------------------------------------------
 * The alert severity chip (feature: participant-shell, story 02; PRT-010/011,
 * NFR-001; see docs/design/D7-application-shells/SHELL-CONTRACT.md §2).
 *
 * One pill that carries an alert's severity through ICON + LABEL TEXT + color
 * together — never color alone (NFR-001 / D0 §4.1). Shared by every place an
 * alert is shown so the severity vocabulary cannot drift between them:
 *  - `AlertBar.tsx` (the persistent ticker / emergency band), and
 *  - `AlertsHistory.tsx` (the `/alerts` "Details" view the bar links to).
 *
 * World: participant. No COBRA, no MUI — plain React + inline style,
 * FontAwesome icons only. The severity vocabulary itself lives in
 * `severityMeta.ts`.
 */

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { SEVERITY_META, chipBaseStyle } from './severityMeta'
import type { AlertSeverity } from './alertTypes'

/**
 * The severity chip: icon + LABEL text + color, together (NFR-001 — severity
 * is never color-only).
 */
export function SeverityChip({ severity }: { severity: AlertSeverity }) {
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
