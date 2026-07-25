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

/** The running (LIVE) pill styling — shared by COR-032 `live` and its legacy alias `active`. */
const LIVE_PILL: StatePillConfig = {
  label: 'LIVE',
  accentColor: STATE_PILL_LIVE_ACCENT,
  background: 'rgba(51, 160, 111, 0.16)',
  borderColor: 'rgba(51, 160, 111, 0.45)',
}

/**
 * The pre-StartEx (STAGED) pill styling — shared by COR-032 `staged` and its
 * legacy alias `scheduled`.
 */
const STAGED_PILL: StatePillConfig = {
  label: 'STAGED',
  accentColor: STATE_PILL_STAGED_ACCENT,
  background: 'rgba(245, 166, 35, 0.16)',
  borderColor: 'rgba(245, 166, 35, 0.5)',
}

/**
 * The conduct-has-ended (ENDEX) pill styling — shared by COR-032 `completed`
 * and its legacy alias `complete`.
 */
const ENDEX_PILL: StatePillConfig = {
  label: 'ENDEX',
  accentColor: staffShellTokens.header.textMuted,
  background: 'rgba(255, 255, 255, 0.08)',
  borderColor: 'rgba(255, 255, 255, 0.22)',
}

/**
 * The lifecycle-status pill config, keyed by the exercise's resolved status.
 *
 * Covers the TRANSITIONAL SUPERSET `ExerciseStatus` carries (exercise-
 * configuration story 01a): the COR-032 six plus the legacy four still valid
 * through the transition. This map is exhaustive by its `Record` type, which is
 * the point — a status the backend can emit always has a TEXT label, never a
 * bare colour (NFR-001) and never an undefined pill.
 *
 * The legacy literals are pure ALIASES of their COR-032 replacement (`active` ≡
 * `live`, `scheduled` ≡ `staged`, `complete` ≡ `completed`) so no new visual
 * vocabulary is coined here; `build` reuses the deliberately-unemphasised
 * archived/endex treatment (pre-conduct, staff-only content development) and
 * `paused` reuses the amber every world-steering pause tier already uses
 * (D5-014/1.3). The lifecycle BEHAVIOUR these states drive is story 03.
 */
export const STATE_PILL_CONFIG: Record<ExerciseStatus, StatePillConfig> = {
  // --- COR-032 -------------------------------------------------------------
  build: {
    label: 'BUILD',
    accentColor: staffShellTokens.header.textMuted,
    background: 'rgba(255, 255, 255, 0.08)',
    borderColor: 'rgba(255, 255, 255, 0.22)',
  },
  staged: STAGED_PILL,
  live: LIVE_PILL,
  // UNRECONCILED, story 03's to settle: this COR-032 Paused pill and world-
  // steering's CTL-023 Freeze (`pauseStatePillConfig` below) now render the
  // same amber register on the same pill, and `StaffHeader` resolves
  // `stateOverride ?? STATE_PILL_CONFIG[status]` — so a Freeze override
  // silently masks the lifecycle state. Nothing keys off it yet. See
  // implementation.md -> Integration hazard 1 (duplicate pause semantics):
  // compose them into ONE overlay/pill state deliberately, do not inherit this
  // as settled.
  paused: {
    label: 'PAUSED',
    accentColor: STATE_PILL_STAGED_ACCENT,
    background: 'rgba(245, 166, 35, 0.16)',
    borderColor: 'rgba(245, 166, 35, 0.5)',
  },
  completed: ENDEX_PILL,
  archived: {
    label: 'ARCHIVED',
    accentColor: staffShellTokens.header.textMuted,
    background: 'rgba(255, 255, 255, 0.05)',
    borderColor: 'rgba(255, 255, 255, 0.16)',
  },
  // --- Legacy aliases, valid through the transition ------------------------
  active: LIVE_PILL,
  scheduled: STAGED_PILL,
  complete: ENDEX_PILL,
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
