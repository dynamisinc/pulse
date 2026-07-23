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
 *     - carries NO chrome inset of its own: the shell ROOT insets the whole
 *       in-flow stack (alert bar + nav + content) below/above the two fixed
 *       compliance banners by the chrome CSS vars (`SHELL_CHROME_TOP_VAR` /
 *       `SHELL_CHROME_BOTTOM_VAR`, default `0px` so a chrome-off shell, a legal
 *       state D7-008, leaves NO gap), so the nav and alert bar clear the
 *       banners too — not just the content region.
 *     - sits at `SHELL_Z.content` and is its own CSS stacking context, so a
 *       channel's internal `z-index` values are scoped inside it and cannot
 *       escape above the nav / alert-bar / overlay / chrome layers (AC3).
 *  5. Provides `{variant, scenarioNow}` to the mounted channel via
 *     `ShellContextProvider` (`mountContract.ts`).
 *
 * ## Shell composition (Wave-2 integration)
 * `ShellLayout` is the assembly point for every shell-owned layer. It renders,
 * as siblings AROUND the content region (never inside its reset boundary):
 *   - `<ComplianceChrome>` (story 01) — the two fixed banners; publishes the
 *     `--pulse-chrome-*` inset vars the content region consumes.
 *   - `<AlertBar>` (story 02) — the EAS-analog host, fixed below the top chrome.
 *   - `<ChannelNav>` (story 03) — the desktop strip / mobile tab bar.
 *   - `<ParticipantSignOutControl>` (feature: login, story 04) — the
 *     participant world's minimal sign-out affordance. Kept as its OWN sibling
 *     rather than folded into `ChannelNav` (see that component's own header for
 *     why: it would either grow `ChannelNav.tsx`'s tightly-pinned button-count
 *     assertions or tie sign-out's availability to the channel config).
 *   - `<OverlayLayer>` (story 05) — pause/EndEx (below chrome) + break-fiction
 *     (above everything).
 * Each layer is SELF-CONTAINED (reads its own exercise-scoped mock seam), so
 * composition is drop-in with zero prop-threading. The z-order contract
 * (SHELL-CONTRACT §3) is carried by each layer's `SHELL_Z` z-index, not by DOM
 * order. NOTE (Phase-1): the shell root insets the whole in-flow stack
 * below/above the fixed chrome (see `shellRootStyle`), so the nav and alert bar
 * clear the banners. Pinning the mobile tab bar to the viewport bottom edge
 * (vs. its current in-flow position after the content) is still refined when
 * the first real channel (E2 social) mounts content to lay out against — the
 * Wave-2 deliverable is the assembly + z-order + the COBRA-free subtree, and
 * every layer's own ACs are met at the component level.
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
 * owns (`display`, `position`, `isolation`, `zIndex`, `boxSizing`) immediately
 * after the reset. Those are shell layout/contract concerns (stacking,
 * z-order), not "styling" in the COR-060 sense (typography/color/decoration) —
 * which is left at the reset, spec-initial state for the channel to define
 * entirely on its own. (The compliance-chrome inset lives on the shell root,
 * not here — see `shellRootStyle`.)
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
import { ComplianceChrome } from './components/ComplianceChrome'
import { AlertBar } from './components/AlertBar/AlertBar'
import { ChannelNav } from './components/ChannelNav'
import { ParticipantSignOutControl } from './components/ParticipantSignOutControl'
import { OverlayLayer } from './components/OverlayLayer'

export interface ShellLayoutProps {
  /** The channel mounted into the shell (social now; portal/news/press/weather later). */
  children: ReactNode
}

/**
 * The content-region reset + stacking-context boundary. See the module header
 * ("The reset boundary") for why `all: initial` (not `revert`) is the reset
 * mechanism, and why the properties below are re-asserted immediately after it.
 * The compliance-chrome inset lives on the shell ROOT (see `shellRootStyle`),
 * not here — so the nav / alert bar clear the fixed banners too, and this
 * boundary carries no chrome padding of its own.
 */
const contentRegionStyle: CSSProperties = {
  all: 'initial',
  display: 'block',
  position: 'relative',
  isolation: 'isolate',
  zIndex: SHELL_Z.content,
  boxSizing: 'border-box',
}

/**
 * The shell root. `position: relative` + `minHeight: 100vh` gives the shell a
 * full-viewport container for its content flow. It deliberately sets NO
 * `transform`/`filter`/`will-change`: any of those would make it a containing
 * block for `position: fixed`, which would break the chrome / alert-bar /
 * overlay layers' viewport anchoring.
 *
 * It owns the compliance-chrome inset for the whole in-flow stack: top/bottom
 * padding = the `--pulse-chrome-*` vars `ComplianceChrome` publishes (default
 * `0px` when chrome is off, so no reserved-gap artifact), so the alert bar,
 * nav, and content region all clear the two fixed banners — not just the
 * content region. `border-box` keeps that padding inside the `100vh`
 * min-height, so it reserves banner clearance without adding scroll overflow.
 */
const shellRootStyle: CSSProperties = {
  position: 'relative',
  minHeight: '100vh',
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
    <div data-testid="pulse-shell-root" style={shellRootStyle}>
      {/* Fixed compliance banners (z=chrome). Publishes the --pulse-chrome-*
          inset vars the content region below consumes. */}
      <ComplianceChrome />

      {/* EAS-analog alert host — fixed just below the top chrome (z=alertBar).
          Persists across every channel; renders a zero-height empty live
          region when there are no active alerts. */}
      <AlertBar />

      {/* Shell-owned channel nav: desktop strip + mobile tab bar. A SIBLING of
          the content region (never inside its reset boundary) — it is shell
          chrome, not channel content (COR-060). */}
      <ChannelNav />

      {/* Participant sign-out (feature: login, story 04). Its own sibling —
          see the module header for why this is not folded into ChannelNav. */}
      <ParticipantSignOutControl />

      {/* The ONE place a channel mounts: zero-styling reset boundary, chrome
          inset, own stacking context at SHELL_Z.content (AC1/AC3). */}
      <div data-testid="pulse-shell-content-region" style={contentRegionStyle}>
        <ShellContextProvider value={mountProps}>
          {children}
        </ShellContextProvider>
      </div>

      {/* Overlay layer: pause/EndEx (z=overlay, below chrome) + break-fiction
          (z=breakFiction, above everything incl. chrome). Renders null when
          overlayState is 'none'. Kept last so its paint order matches its
          z-order for equal-context layers. */}
      <OverlayLayer />
    </div>
  )
}
