/**
 * features/staffShell/components/statePillConfig.ts
 * ---------------------------------------------------------------------------
 * The exercise-state pill's config — the lifecycle-status map (LIVE / STAGED /
 * ENDEX / ARCHIVED, COR-005/D7-010) plus the world-steering tiered-pause
 * override factory (INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN, D5-014/1.3).
 *
 * Split out of `StaffHeader.tsx` so that file exports only its component
 * (react-refresh/only-export-components) and so every on-navy pill colour lives
 * in exactly one non-component module. The pill's TEXT half (`label`) is always
 * required — the state is never colour-only (NFR-001).
 */

import type { ExerciseStatus } from '@/core/exerciseContext'
import { staffShellTokens } from '../staffShellTokens'

export interface StatePillConfig {
  /** The conduct-state label — the pill's REQUIRED text half (NFR-001: never color-only). */
  label: string
  /** The dot + text color for this state. */
  accentColor: string
  background: string
  borderColor: string
}

// On-navy severity accents for the exercise-state pill. Base COBRA palette
// hues (`cobraTheme.palette.success`/`error`/etc., via `staffShellTokens.
// accent`) are calibrated for the LIGHT work-area background, not this navy
// header — reusing them verbatim here would render low-contrast/muddy
// against `#1e3a5f`. These two navy-safe accents follow the same "define next
// to what renders it" rationale `staffShellTokens.ts`'s module header gives
// for the header background itself. The complete/archived states intentionally
// reuse `staffShellTokens.header.textMuted` instead of adding two more one-off
// colors — those states are deliberately unemphasized (conduct has ended).
const STATE_PILL_LIVE_ACCENT = '#5fce9a'
const STATE_PILL_STAGED_ACCENT = '#f5c56b'

/** The lifecycle-status pill config, keyed by the exercise's resolved status. */
export const STATE_PILL_CONFIG: Record<ExerciseStatus, StatePillConfig> = {
  active: {
    label: 'LIVE',
    accentColor: STATE_PILL_LIVE_ACCENT,
    background: 'rgba(51, 160, 111, 0.16)',
    borderColor: 'rgba(51, 160, 111, 0.45)',
  },
  scheduled: {
    label: 'STAGED',
    accentColor: STATE_PILL_STAGED_ACCENT,
    background: 'rgba(245, 166, 35, 0.16)',
    borderColor: 'rgba(245, 166, 35, 0.5)',
  },
  complete: {
    label: 'ENDEX',
    accentColor: staffShellTokens.header.textMuted,
    background: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  archived: {
    label: 'ARCHIVED',
    accentColor: staffShellTokens.header.textMuted,
    background: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
}

/**
 * Builds a `stateOverride` for a world-steering pause tier (D5-014/1.3): all
 * paused tiers render amber (D5 "INJECTS PAUSED / ENGINE PAUSED / WORLD FROZEN
 * amber"), reusing the same navy-safe amber accent as the STAGED state so the
 * on-navy accent lives in exactly one place. `label` is the tier's text half
 * (NFR-001 — never color-only). The `/console` route calls this with
 * `usePauseState().label` while a tier is active.
 */
export function pauseStatePillConfig(label: string): StatePillConfig {
  return {
    label,
    accentColor: STATE_PILL_STAGED_ACCENT,
    background: 'rgba(245, 166, 35, 0.16)',
    borderColor: 'rgba(245, 166, 35, 0.5)',
  }
}
