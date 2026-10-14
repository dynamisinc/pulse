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
 * ## The scenario-moment model (kept; NOT offered in the UI since demo-polish C6)
 * Four mutually-exclusive moments -- STARTEX / ADVISORY / BURST / NOW -- each a label and a
 * scenario instant. `now` reads the LIVE scenario clock (`scenarioNow()` from `@/core/clock`,
 * never wall-clock -- COR-053); the other three are FIXED MINUTE OFFSETS before it. The stage
 * hands the selected moment's instant to the staged participant render through the shell mount
 * contract (`ShellContextProvider`'s `scenarioNow`).
 *
 * The moment PICKER is no longer rendered (Gate-1 amendment to C6 story 23): the stage now
 * hosts the real Social channel, whose per-post ages come from the live scenario clock
 * (`useScenarioTime`), not from the shell mount, so a picker changes nothing the audience
 * would see -- worse on stage than no picker. The model and `setMoment` stay for the day a
 * channel (or an "as of" feed view) can honour a chosen moment; until then `moment` is always
 * its default, `now`.
 *
 * World: staff (COBRA/Cadence hosts the toggle this module backs) -- but this
 * module itself renders no UI and imports neither COBRA nor MUI. The model carries no
 * participant-facing copy: the mock alert/headline strings the retired `PortalStub` rendered
 * were removed with it (C6); the real alert bar is the participant shell's (D7-002) and is not
 * mounted in the preview.
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

/** One moment's label + scenario offset. */
export interface PreviewMomentConfig {
  readonly id: PreviewMoment
  /** Chip caption, e.g. "STARTEX". */
  readonly label: string
  /**
   * Minutes BEFORE the live scenario "now" this moment represents (`0` for
   * `now` itself). Never positive — a preview never shows the future.
   */
  readonly offsetMinutes: number
}

const PREVIEW_MOMENT_CONFIGS: Record<PreviewMoment, PreviewMomentConfig> = {
  startex: { id: 'startex', label: 'STARTEX', offsetMinutes: -180 },
  advisory: { id: 'advisory', label: 'ADVISORY', offsetMinutes: -90 },
  burst: { id: 'burst', label: 'BURST', offsetMinutes: -20 },
  now: { id: 'now', label: 'NOW', offsetMinutes: 0 },
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
  /**
   * Activates the preview if inactive, or exits it if active. Activating also remembers which
   * element had focus -- the control that opened the preview -- for {@link returnFocus}.
   */
  toggle: () => void
  /**
   * Hands focus back to the element that was focused when the preview was entered (the staff
   * header's "Preview as participant" button, activated by its own click or Enter), if it is
   * still in the document; otherwise does nothing. Call it with `toggle()` when EXITING: the
   * stage's own Exit button unmounts with the stage, and focus must not fall to <body>
   * (NFR-001). The target is remembered by the provider, not looked up by selector, so this
   * is independent of the header's markup.
   */
  returnFocus: () => void
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
 * The provider's small mutable memory: whether the preview is staged (so a toggle can decide
 * ENTER vs EXIT synchronously -- two toggles in one tick must still alternate) and which element
 * had focus when it was entered (so Exit can hand focus back). It is a plain object the provider
 * holds in state, mutated only from event handlers, never read while rendering -- the reason it
 * is a class and not a `useRef` pair: the closures the context hands out would otherwise capture
 * refs, which the render-purity lint (rightly, in general) refuses to see passed into a Provider.
 */
class PreviewFocusMemory {
  private staged = false

  private opener: HTMLElement | null = null

  /** Flips staged/unstaged, returning the NEW value; on an enter, remembers the focused element. */
  flip(): boolean {
    this.staged = !this.staged
    if (this.staged) {
      const focused = document.activeElement
      this.opener = focused instanceof HTMLElement && focused !== document.body ? focused : null
    }
    return this.staged
  }

  /** Focuses the remembered opener, once, if it is still in the document. */
  restore(): void {
    const opener = this.opener
    this.opener = null
    if (opener !== null && opener.isConnected) opener.focus()
  }
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

  // See `PreviewFocusMemory`: ENTER vs EXIT, and the element to hand focus back to.
  const [memory] = useState(() => new PreviewFocusMemory())

  const toggle = useCallback(() => setActive(memory.flip()), [memory])
  const returnFocus = useCallback(() => memory.restore(), [memory])
  const setMoment = useCallback((next: PreviewMoment) => setMomentState(next), [])

  const value = useMemo<PreviewContextValue>(
    () => ({ active, toggle, returnFocus, moment, setMoment }),
    [active, toggle, returnFocus, moment, setMoment],
  )

  return createElement(PreviewContext.Provider, { value }, children)
}

/**
 * The NON-THROWING read of the preview state: `undefined` outside a `<PreviewProvider>` (the
 * planner workspace, which has no preview, mounts none). For shared staff CHROME that must adapt
 * to a staged preview when there is one but cannot require one -- `StaffShellFrame` uses it to
 * stop calling its work area a `main` landmark while the preview (whose channel has its own) is
 * staged. Anything that needs the state to function must use {@link usePreview}.
 */
export function useOptionalPreview(): PreviewContextValue | undefined {
  return useContext(PreviewContext)
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
