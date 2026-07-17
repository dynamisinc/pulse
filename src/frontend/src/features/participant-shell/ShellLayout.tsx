/**
 * features/participant-shell/ShellLayout.tsx
 * ---------------------------------------------------------------------------
 * The content-region container (feature: participant-shell, story 04;
 * COR-060, COR-053/062, XC-001/002; see
 * docs/features/participant-shell/04-channel-mount-contract.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1/§3).
 *
 * `ShellLayout` is the ONE place a participant channel mounts. It:
 *
 *  1. Is the SINGLE scenario-time source (AC2, COR-053/062): reads
 *     `scenarioNow` from `@/core/clock`'s `useScenarioTime()` — NEVER
 *     `new Date()` / `Date.now()` (the participant wall-clock lint ban
 *     covers this directory, WAVE0-REVIEW precedent 11/21).
 *  2. Reads the exercise scope via `useExerciseContext()` (AC4, XC-001) —
 *     fail-closed: this component can only ever render inside a resolved
 *     exercise scope (a missing `<ExerciseContextProvider>` ancestor throws,
 *     matching the Wave-0 precedent). The resolved scope is intentionally
 *     NOT used for anything else here: `exerciseId` is read only (inside
 *     `useShellState`) to key that query, never rendered, and no
 *     exercise/admin concept (picker, status badge, "exercise" language)
 *     ever appears in the content region (XC-002).
 *  3. Resolves `variant` via `useShellState()` (the Wave-1 shell-state mock).
 *  4. Renders `children` (the channel) inside a content-region boundary that:
 *     - imposes ZERO inherited styling (AC1, COR-060) — see "The reset
 *       boundary" below.
 *     - insets by the chrome CSS vars (`SHELL_CHROME_TOP_VAR` /
 *       `SHELL_CHROME_BOTTOM_VAR`), defaulting to `0px` so an unmounted /
 *       chrome-off shell (a legal state, D7-008) leaves NO gap.
 *     - sits at `SHELL_Z.content` and is its own CSS stacking context, so a
 *       channel's internal `z-index` values are scoped inside it and cannot
 *       escape above the nav / alert-bar / overlay / chrome layers (AC3).
 *  5. Provides `{variant, scenarioNow}` to the mounted channel via
 *     `ShellContextProvider` (`mountContract.ts`).
 *
 * Deliberately does NOT render cross-channel nav (story 03) or any overlay
 * (story 05) — this component only defines the contract they participate in.
 *
 * ## The reset boundary
 * The boundary uses `all: initial` — deliberately NOT `all: revert`.
 * `revert` rolls a property back to the user-agent-stylesheet value, but for
 * inherited properties like `color` / `font-family` there is no
 * element-specific UA rule, so "the UA value" IS "inherit from parent" —
 * meaning `revert` would NOT stop a leaked `color`/`font-family` from an
 * ancestor (e.g. a `CssBaseline` mounted above this subtree). `initial`
 * forces the CSS-spec initial value regardless of inheritance or origin,
 * which is what actually guarantees no inherited enterprise styling reaches
 * the channel.
 *
 * Because `initial` also resets `display` to its spec value (`inline`, not
 * the `<div>` UA default of `block`) and `position` to `static`, this
 * component re-asserts the handful of STRUCTURAL properties it intentionally
 * owns (`display`, `position`, `isolation`, `zIndex`, `boxSizing`, the
 * chrome-inset padding) immediately after the reset. Those are shell
 * layout/contract concerns (insets, stacking, z-order), not "styling" in the
 * COR-060 sense (typography/color/decoration) — which is left at the reset,
 * spec-initial state for the channel to define entirely on its own.
 *
 * World: participant. No COBRA, no MUI theme, no default MUI look (D0 §2).
 */

import type { CSSProperties, ReactNode } from 'react'
import { useExerciseContext } from '@/core/exerciseContext'
import { useScenarioTime } from '@/core/clock'
import {
  SHELL_CHROME_BOTTOM_VAR,
  SHELL_CHROME_TOP_VAR,
  SHELL_Z,
  ShellContextProvider,
  type ShellMountProps,
} from './mountContract'
import { useShellState } from './shellState'

export interface ShellLayoutProps {
  /** The channel mounted into the shell (social now; portal/news/press/weather later). */
  children: ReactNode
}

/**
 * The content-region reset + inset + stacking-context boundary. See the
 * module header ("The reset boundary") for why `all: initial` (not
 * `revert`) is the reset mechanism, and why the properties below are
 * re-asserted immediately after it.
 */
const contentRegionStyle: CSSProperties = {
  all: 'initial',
  display: 'block',
  position: 'relative',
  isolation: 'isolate',
  zIndex: SHELL_Z.content,
  boxSizing: 'border-box',
  paddingTop: `var(${SHELL_CHROME_TOP_VAR}, 0px)`,
  paddingBottom: `var(${SHELL_CHROME_BOTTOM_VAR}, 0px)`,
}

export function ShellLayout({ children }: ShellLayoutProps) {
  // Fail-closed exercise scoping (COR-001/XC-001) — see module header point 2.
  // The resolved scope is deliberately unused beyond this call: exerciseId is
  // read (inside useShellState) only to key that query, never rendered here.
  useExerciseContext()

  const { variant } = useShellState()
  const { now: scenarioNow } = useScenarioTime()

  const mountProps: ShellMountProps = { variant, scenarioNow }

  return (
    <div
      data-testid="pulse-shell-content-region"
      style={contentRegionStyle}
    >
      <ShellContextProvider value={mountProps}>
        {children}
      </ShellContextProvider>
    </div>
  )
}
