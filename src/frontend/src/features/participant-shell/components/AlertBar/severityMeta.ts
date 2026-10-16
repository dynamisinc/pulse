/**
 * features/participant-shell/components/AlertBar/severityMeta.ts
 * ---------------------------------------------------------------------------
 * The alert severity vocabulary (PRT-011, NFR-001): label, icon, and chip
 * palette per severity, plus the shared pill geometry. Kept in a plain module
 * (not `SeverityChip.tsx`) so component files export only components (React
 * Fast Refresh). Consumed by `SeverityChip`, and by `AlertBar` for the
 * collapsed strip's accessible name and the band's "+N more" chip.
 */

import type { CSSProperties } from 'react'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import { faBullhorn, faCircleInfo, faTriangleExclamation } from '@fortawesome/free-solid-svg-icons'
import type { AlertSeverity } from './alertTypes'

export interface SeverityMeta {
  readonly label: string
  readonly icon: IconDefinition
  /** Chip background — D1/D2 palette (info/advisory), or emergency's white pill. */
  readonly chipBg: string
  /** Chip icon/text color. */
  readonly chipFg: string
}

/**
 * Exact palettes per story AC / SHELL-CONTRACT.md §2: info `#edf3f9/#3d6a96`,
 * advisory `#fff3dd/#8a5a00` (D1/D2's `#b97a00` fg darkened to `#8a5a00` for WCAG
 * AA — DECISIONS.md D7-012). Emergency's chip is a solid white pill with dark-red
 * `#8f150c` text (the D7 mockup `.ab-emg .chip` spec): it stays legible against the
 * solid `#b3261e` band and clears WCAG AA (dark-red on white).
 */
export const SEVERITY_META: Record<AlertSeverity, SeverityMeta> = {
  info: { label: 'INFO', icon: faCircleInfo, chipBg: '#edf3f9', chipFg: '#3d6a96' },
  advisory: { label: 'ADVISORY', icon: faTriangleExclamation, chipBg: '#fff3dd', chipFg: '#8a5a00' },
  emergency: { label: 'EMERGENCY', icon: faBullhorn, chipBg: '#fff', chipFg: '#8f150c' },
}

/** Pill geometry shared by the severity chip and the band's "+N more" chip. */
export const chipBaseStyle: CSSProperties = {
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
