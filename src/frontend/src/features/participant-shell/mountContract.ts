/**
 * features/participant-shell/mountContract.ts
 * ---------------------------------------------------------------------------
 * The channel-mount contract (feature: participant-shell, story 04; COR-060,
 * COR-053/062; see docs/features/participant-shell/04-channel-mount-contract.md
 * and docs/design/D7-application-shells/SHELL-CONTRACT.md §1/§3).
 *
 * This is the seam every participant channel (social now; portal/news/press/
 * weather later) imports, and it's the whole of what a channel needs from its
 * container. It defines:
 *
 *  - `ShellVariant` / `ShellMountProps` — what a mounted channel receives:
 *    the shell variant and the single scenario-time "now" (COR-053/062). A
 *    channel derives every dateline / "2h ago" string from `scenarioNow`; it
 *    never reads wall-clock and never labels the value "scenario time"
 *    in-fiction (XC-002).
 *  - `ShellContextProvider` / `useShellContext()` — the React context a
 *    channel calls to read its mount props. `useShellContext()` throws when
 *    called outside a provider (fail-closed — there is no default variant or
 *    scenario instant a channel could silently render against), mirroring
 *    `core/exerciseContext`'s precedent.
 *  - The **inset contract**: two CSS custom-property NAMES the compliance
 *    chrome (story 01) sets and the content region (`ShellLayout.tsx`)
 *    consumes to inset around it. Chrome-off is a legal state (D7-008), so
 *    both default to `0px` — a channel with no chrome mounted sees NO gap.
 *  - The **z-order contract** (`SHELL_Z`): the shell's single z-index scale,
 *    bottom to top, matching `SHELL-CONTRACT.md` §3 exactly. A channel is
 *    mounted at `SHELL_Z.content`, inside a CSS stacking context
 *    (`ShellLayout.tsx`), so any `z-index` it sets internally is scoped
 *    inside that context and structurally cannot escape above the channel
 *    nav / alert bar / overlay / chrome / break-fiction layers — the
 *    contract enforces this, not convention (AC3).
 *  - The **shell-state envelope types** (`ChromeBannerConfig`, `ChromeConfig`,
 *    `ShellState`) — the shape of the (future) server-driven shell state.
 *    This story OWNS the types and the mount-relevant slice (`variant`, via
 *    `shellState.ts`); it does NOT populate `chromeConfig` CONTENT — that
 *    mock is story 01's `useChromeConfig` seam. Note `ShellState.scenarioNow`
 *    is the WIRE shape (an ISO string) — it is never what a channel receives
 *    directly; the channel-facing `scenarioNow: Date` on `ShellMountProps`
 *    always comes from `@/core/clock` (see `ShellLayout.tsx`), not this
 *    envelope field.
 *
 * World: participant. No COBRA, no MUI, no enterprise look — this is a pure
 * contract module (types + a React context), not UI.
 */

import { createContext, createElement, useContext, type ReactNode } from 'react'

/**
 * The shell mount variants a channel can be rendered under (D7-008,
 * COR-064/015/COR-041, PRT-040):
 *  - `full` — ordinary participant conduct.
 *  - `readOnly` — interactive affordances are ABSENT, never disabled
 *    (COR-015); a channel honors this by not rendering them at all.
 *  - `kiosk` — chrome-free + nav-free (PRT-040, Phase 3 rendering; the flag
 *    exists now so the contract stays stable across phases).
 *  - `preview` — rendered inside the staff frame (COR-041); still the same
 *    participant contract, just hosted differently.
 */
export type ShellVariant = 'full' | 'readOnly' | 'kiosk' | 'preview'

/**
 * What a mounted channel receives from the shell — the WHOLE contract; a
 * channel needs nothing else from its container.
 */
export interface ShellMountProps {
  /** Which variant the channel is mounted under (see {@link ShellVariant}). */
  readonly variant: ShellVariant
  /**
   * The current scenario-time instant (COR-053/062). The shell is the SINGLE
   * source of "now" for every channel — datelines, "2h ago" relative times,
   * and any other in-fiction timestamp derive from this value, never from
   * wall-clock (`Date.now()` / `new Date()`), and this value is never
   * labeled "scenario time" inside the fiction (XC-002).
   */
  readonly scenarioNow: Date
}

const ShellMountContext = createContext<ShellMountProps | undefined>(undefined)

export interface ShellContextProviderProps {
  value: ShellMountProps
  children: ReactNode
}

/**
 * Binds `{variant, scenarioNow}` for the channel subtree mounted below it.
 * `ShellLayout` is the only intended caller — a channel never constructs its
 * own `ShellMountProps` value.
 *
 * A plain function component built with `createElement` (not JSX), so this
 * module can stay a `.ts` file — it has no other JSX needs.
 */
export function ShellContextProvider({ value, children }: ShellContextProviderProps) {
  return createElement(ShellMountContext.Provider, { value }, children)
}

/**
 * Returns the current channel's mount props.
 *
 * Fail-closed: throws when called outside a `ShellContextProvider` rather
 * than returning a default variant/time a channel could silently render
 * against (matches the `core/exerciseContext` precedent).
 */
// Provider + hook are intentionally colocated in one module (mirrors
// core/exerciseContext/exerciseContext.tsx); same rationale as the
// `**/contexts/**` eslint override there.
export function useShellContext(): ShellMountProps {
  const props = useContext(ShellMountContext)
  if (props === undefined) {
    throw new Error(
      'useShellContext() must be called within a <ShellContextProvider>. ' +
      'There is no default variant/scenarioNow a channel can render against.',
    )
  }
  return props
}

// -----------------------------------------------------------------------------
// Inset contract (SHELL-CONTRACT.md §1 "Content region"; D7-008 chrome-off)
// -----------------------------------------------------------------------------

/**
 * CSS custom-property NAME the compliance chrome (story 01) sets to its
 * rendered top-banner height; the content region (`ShellLayout.tsx`) insets
 * by reading it back. Consumers read the var with a `0px` fallback
 * (`var(--pulse-chrome-top, 0px)`) so an unmounted / chrome-off shell (a
 * legal state, D7-008) leaves NO gap — the fallback IS the contract, not an
 * incidental default.
 */
export const SHELL_CHROME_TOP_VAR = '--pulse-chrome-top'

/** Same contract as {@link SHELL_CHROME_TOP_VAR}, for the bottom banner. */
export const SHELL_CHROME_BOTTOM_VAR = '--pulse-chrome-bottom'

// -----------------------------------------------------------------------------
// Z-order contract (SHELL-CONTRACT.md §3 "Overlay layer contract")
// -----------------------------------------------------------------------------

/**
 * The shell's single z-index scale, bottom to top — matches
 * `SHELL-CONTRACT.md` §3 exactly: content · channel nav · alert bar ·
 * overlay (pause/EndEx pages) · compliance chrome · break-fiction broadcast
 * (covers everything).
 *
 * A channel is mounted inside the content region at `SHELL_Z.content`, and
 * that region is its own CSS stacking context (`ShellLayout.tsx`). Any
 * `z-index` a channel sets on its own internal elements is scoped INSIDE
 * that stacking context, so it structurally cannot paint above
 * `channelNav`/`alertBar`/`overlay`/`chrome`/`breakFiction` — the contract
 * enforces "a channel cannot draw above the overlay layer" (AC3), it is not
 * left to convention.
 */
export const SHELL_Z = {
  content: 0,
  channelNav: 10,
  alertBar: 20,
  overlay: 30,
  chrome: 40,
  breakFiction: 50,
} as const

// -----------------------------------------------------------------------------
// Shell-state contract types (server-driven envelope). This story owns the
// TYPES and the mount-relevant slice (`variant`, via shellState.ts); story 01
// owns `chromeConfig` CONTENT (the banner strings/colors mock).
// -----------------------------------------------------------------------------

/** One compliance-chrome banner's rendered content (story 01's `useChromeConfig`). */
export interface ChromeBannerConfig {
  readonly text: string
  readonly fg: string
  readonly bg: string
}

/** The compliance-chrome config slice of shell state (COR-030/066). */
export interface ChromeConfig {
  readonly enabled: boolean
  readonly top: ChromeBannerConfig
  readonly bottom: ChromeBannerConfig
}

/**
 * The full server-driven shell-state envelope — the shape the real backend
 * returns once it exists. `scenarioNow` here is the WIRE shape (an ISO
 * string); it is NOT what a channel receives (see module header) and this
 * story's mock (`shellState.ts`) deliberately does not fetch it — scenario
 * "now" is client-derived from `@/core/clock` instead, so a channel's
 * timestamps never lag a fetch/poll interval.
 */
export interface ShellState {
  readonly chromeConfig: ChromeConfig
  readonly variant: ShellVariant
  readonly scenarioNow: string
}
