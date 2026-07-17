/**
 * features/staffShell/previewContext.ts
 * ---------------------------------------------------------------------------
 * "Preview as participant" toggle + scenario-moment model (feature:
 * staff-shell, story 04 — "Preview as participant (staged, read-only,
 * scenario-moment picker)"; COR-041; see
 * docs/features/staff-shell/04-preview-as-participant.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Staff shell owns"
 * → "Variants" → preview-as-participant).
 *
 * ## This is the toggle SEAM the orchestrator wires at Integration B
 * ```tsx
 * const { active, toggle } = usePreview()
 * <StaffHeader previewActive={active} onTogglePreview={toggle} />
 * {active ? <PreviewAsParticipant /> : <ControllerConsoleWorkArea />}
 * ```
 * `PreviewProvider` must be mounted exactly once per staff frame; `usePreview()`
 * is the only way any component (the header button, the stage) reads or
 * drives that state.
 *
 * ## Why a React context, not a module-global boolean
 * Mirrors `toolRegistry.ts`'s `ToolstripProvider` rationale exactly: a
 * module-level `let active = false` would leak across mounts/unmounts and —
 * worse — across EXERCISES. Mounting `PreviewProvider` under the exercise
 * scope (a descendant of `ExerciseContextProvider`, in the orchestrator's
 * frame assembly) makes the preview toggle exercise-scoped (XC-001) by
 * construction: a remount for a new exercise resets it, with no explicit
 * exercise-change handling needed in this module.
 *
 * ## Fail-closed, mirroring `useExerciseContext()` / `useToolstrip()`
 * `usePreview()` THROWS when called outside a `<PreviewProvider>` — there is
 * no default/module-global preview state a caller could silently read.
 *
 * ## The scenario-moment model (mock, AC2)
 * Four mutually-exclusive moments — STARTEX / ADVISORY / BURST / NOW — each
 * carrying a mock alert state (`none` / `info` / `advisory` / `emergency`,
 * exactly NFR-001's four states), mock in-fiction content (kicker/headline/
 * dek), and a scenario instant. `now` reads the LIVE scenario clock
 * (`scenarioNow()` from `@/core/clock`, never wall-clock — COR-053); the
 * other three are FIXED MINUTE OFFSETS before it, so selecting a moment
 * drives both the preview's alert state/content and the `scenarioNow` handed
 * to the staged participant render. This is deliberately a LOCAL, MOCK model
 * — participant-shell owns the real alert bar (D7-002); this story never
 * builds it, only stages a labelled stand-in inside the read-only preview.
 *
 * World: staff (COBRA/Cadence hosts the toggle this module backs) — but this
 * module itself renders no UI and imports neither COBRA nor MUI. The moment
 * CONTENT strings (kicker/headline/dek/alert message) are participant-world
 * copy, consumed only by the participant-world stub (`components/
 * PortalStub.tsx`); keeping them here (not duplicated) is what lets the
 * moment picker and the staged render agree on exactly one source of truth.
 */

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { scenarioNow } from '@/core/clock'

/** The four scenario moments the picker offers (AC2), in display order. */
export type PreviewMoment = 'startex' | 'advisory' | 'burst' | 'now'

/** Display/iteration order for the moment picker — the single source of order. */
export const PREVIEW_MOMENT_ORDER: readonly PreviewMoment[] = [
  'startex',
  'advisory',
  'burst',
  'now',
]

/**
 * The mock alert severity a moment drives — NFR-001's four states exactly
 * (none/info/advisory/emergency). A LOCAL mock model only; never the real
 * alert bar (participant-shell owns that contract, D7-002).
 */
export type PreviewAlertState = 'none' | 'info' | 'advisory' | 'emergency'

/** One moment's mock alert state + in-fiction content + scenario offset. */
export interface PreviewMomentConfig {
  readonly id: PreviewMoment
  /** Chip caption, e.g. "STARTEX". */
  readonly label: string
  readonly alertState: PreviewAlertState
  /** Mock alert message. Present whenever `alertState !== 'none'`. */
  readonly alertMessage?: string
  /** Mock in-fiction masthead kicker/section label. */
  readonly kicker: string
  /** Mock in-fiction headline. */
  readonly headline: string
  /** Mock in-fiction dek/summary. */
  readonly dek: string
  /**
   * Minutes BEFORE the live scenario "now" this moment represents (`0` for
   * `now` itself). Never positive — a preview never shows the future.
   */
  readonly offsetMinutes: number
}

const PREVIEW_MOMENT_CONFIGS: Record<PreviewMoment, PreviewMomentConfig> = {
  startex: {
    id: 'startex',
    label: 'STARTEX',
    alertState: 'none',
    kicker: 'FAIRHAVEN TODAY',
    headline: 'Exercise operations underway across the region',
    dek: 'Local agencies are coordinating routine readiness activities this morning.',
    offsetMinutes: -180,
  },
  advisory: {
    id: 'advisory',
    label: 'ADVISORY',
    alertState: 'advisory',
    alertMessage: 'Boil Water Advisory — Zones 2–4. Boil tap water for 1 minute before use.',
    kicker: 'FAIRHAVEN TODAY',
    headline: 'Boil Water Advisory issued for Zones 2–4',
    dek: 'Residents in affected zones should boil tap water for at least one minute before use.',
    offsetMinutes: -90,
  },
  burst: {
    id: 'burst',
    label: 'BURST',
    alertState: 'emergency',
    alertMessage: 'Do not drink tap water in Zones 2–4. Distribution open at Fairview HS.',
    kicker: 'FAIRHAVEN TODAY',
    headline: 'Do not drink tap water in Zones 2–4',
    dek: 'Contamination confirmed at the Millbrook treatment plant; distribution open at Fairview High School.',
    offsetMinutes: -20,
  },
  now: {
    id: 'now',
    label: 'NOW',
    alertState: 'info',
    alertMessage: 'Distribution continues at Fairview High School while testing is underway.',
    kicker: 'FAIRHAVEN TODAY',
    headline: 'Water distribution site open at Fairview High School',
    dek: 'Crews continue flushing and testing the Millbrook system; an update is expected this afternoon.',
    offsetMinutes: 0,
  },
}

/**
 * Looks up a moment's config. A `Record`, not a `.find()` over an array — the
 * lookup can never produce `undefined` for a valid `PreviewMoment`, so
 * callers need no non-null assertion / fallback guard (WAVE0-REVIEW
 * precedent 23).
 */
export function getPreviewMomentConfig(moment: PreviewMoment): PreviewMomentConfig {
  return PREVIEW_MOMENT_CONFIGS[moment]
}

const MINUTE_MS = 60_000

/**
 * The scenario instant `moment` represents: the LIVE scenario clock
 * (`scenarioNow()`) for `now`, or that same live reading minus the moment's
 * fixed offset otherwise. Never wall-clock (COR-053) — this is the value the
 * stage hands to `ShellContextProvider`'s `scenarioNow`.
 */
export function resolvePreviewMomentInstant(moment: PreviewMoment): Date {
  const { offsetMinutes } = getPreviewMomentConfig(moment)
  return new Date(scenarioNow().getTime() + offsetMinutes * MINUTE_MS)
}

// -----------------------------------------------------------------------------
// The toggle + selected-moment context
// -----------------------------------------------------------------------------

export interface PreviewContextValue {
  /** Whether "Preview as participant" is currently staged. */
  active: boolean
  /** Activates the preview if inactive, or exits it if active. */
  toggle: () => void
  /** The currently-selected scenario moment. Defaults to `'now'`. */
  moment: PreviewMoment
  /** Selects a moment — mutually exclusive; replaces whatever was selected. */
  setMoment: (moment: PreviewMoment) => void
}

const PreviewContext = createContext<PreviewContextValue | undefined>(undefined)

export interface PreviewProviderProps {
  children: ReactNode
}

/**
 * Holds the preview toggle + selected-moment state, entirely in React state
 * (see module header — why a context, not a module-global). Mount exactly
 * ONE of these per staff frame, under the exercise scope, so the toggle is
 * exercise-scoped by construction (XC-001).
 *
 * Built with `createElement` (not JSX) so this module can stay a `.ts` file
 * — mirrors `toolRegistry.ts`'s `ToolstripProvider` and
 * `participant-shell/mountContract.ts`'s `ShellContextProvider`.
 */
export function PreviewProvider({ children }: PreviewProviderProps) {
  const [active, setActive] = useState(false)
  const [moment, setMomentState] = useState<PreviewMoment>('now')

  const toggle = useCallback(() => setActive(prev => !prev), [])
  const setMoment = useCallback((next: PreviewMoment) => setMomentState(next), [])

  const value = useMemo<PreviewContextValue>(
    () => ({ active, toggle, moment, setMoment }),
    [active, toggle, moment, setMoment],
  )

  return createElement(PreviewContext.Provider, { value }, children)
}

/**
 * Reads the preview toggle + selected-moment state.
 *
 * Throws when called outside a `<PreviewProvider>` (fail-closed, mirroring
 * `useExerciseContext()` / `useToolstrip()`) — there is no default preview
 * state a caller could silently render against.
 */
export function usePreview(): PreviewContextValue {
  const ctx = useContext(PreviewContext)
  if (!ctx) {
    throw new Error(
      'usePreview() must be called within a <PreviewProvider>. There is no default preview ' +
      'state (XC-001) — mount PreviewProvider inside the staff frame, under the exercise scope.',
    )
  }
  return ctx
}
