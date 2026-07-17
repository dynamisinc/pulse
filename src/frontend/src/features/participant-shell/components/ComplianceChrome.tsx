/**
 * features/participant-shell/components/ComplianceChrome.tsx
 * ---------------------------------------------------------------------------
 * The compliance-chrome banners (feature: participant-shell, story 01;
 * COR-031, COR-030/066, NFR-001, NFR-008; see
 * docs/features/participant-shell/01-compliance-chrome.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Compliance chrome").
 *
 * Renders the two fixed 22px classification banners at the absolute top and
 * bottom of the viewport — visually OUTSIDE any channel's content region
 * (D7-005's two-banner containment model; the Looking Glass green-bars
 * precedent, D0 §2). `<ShellLayout>` (story 04) insets the content region
 * between them by reading the SAME CSS custom properties this component
 * publishes (`SHELL_CHROME_TOP_VAR` / `SHELL_CHROME_BOTTOM_VAR`); neither
 * module imports the other's DOM, only the shared var NAMES from
 * `mountContract.ts` — the inset contract is data (a CSS var on
 * `:root`), not a parent/child prop.
 *
 * Config-driven (AC2): banner TEXT and COLORS come entirely from
 * `useChromeConfig()` (`../chromeConfig.ts`) — this component hardcodes only
 * the shell's fixed layout facts (position, height, Figtree type, tracking,
 * z-index), never a brand/classification string or a color. Zero exercise
 * strings live here.
 *
 * Chrome-off is a legal state (AC3, D7-008): when `config.enabled` is
 * `false`, this component renders NO banners and drives both inset vars to
 * `0px` so `ShellLayout`'s `var(--pulse-chrome-top, 0px)` / `var(--pulse-
 * chrome-bottom, 0px)` padding collapses to zero — no reserved-gap artifact.
 * `chromeConfig.ts`'s `isWatermarkRequired()` becomes `true` in this state;
 * rendering the watermark itself is a participant-channel concern (out of
 * scope here).
 *
 * Double-mount safety (Wave-1 Gate-1 finding WR-001): the inset vars live on
 * the single shared `document.documentElement`, which is correct for the
 * documented "mount once near the root" case. But the mount contract allows a
 * `preview` shell (COR-041, story 06) rendered INSIDE the staff frame while an
 * outer participant shell is also live — two `ComplianceChrome` instances, one
 * shared `:root` pair. So the `:root` writes are REF-COUNTED
 * (`acquireChromeInset` / `releaseChromeInset` below): an unmount clears the
 * vars only when the LAST instance leaves, so the first to unmount can no
 * longer `removeProperty` the reserved inset out from under a still-visible
 * sibling shell. This guards the unmount RACE; it does NOT give two
 * concurrently-mounted shells INDEPENDENT insets (one `:root` pair holds one
 * value; last writer wins). Fully per-pane-independent insets are the scoping
 * follow-up — set/read the vars on a shared shell-root node instead of `:root`,
 * moving `ShellLayout`'s `var(--pulse-chrome-*, 0px)` consumer with them —
 * deferred to story 06 / the staff-shell preview composition, when that
 * container actually exists.
 *
 * A11y (AC5): each banner is exercise/classification CONTEXT, not
 * interactive content — plain `<div>`s, no button/link/onClick/tabIndex, not
 * focusable. `role="note"` + a descriptive `aria-label` announce them to
 * assistive tech as supplementary context rather than page content or a
 * landmark. Copy is static, scenario-agnostic config text only — no
 * wall-clock, no exercise language beyond the configured markings (the
 * participant wall-clock lint ban covers this directory mechanically too).
 *
 * World: participant. No COBRA, no MUI, no ThemeProvider, no default MUI
 * look (D0 §2) — plain React + inline style. Green/Figtree participant
 * styling only, never Cadence/COBRA.
 */

import { useLayoutEffect, type CSSProperties } from 'react'
import {
  SHELL_CHROME_BOTTOM_VAR,
  SHELL_CHROME_TOP_VAR,
  SHELL_Z,
} from '../mountContract'
import { useChromeConfig } from '../chromeConfig'

/** The shell's fixed compliance-chrome banner height (D7-005, SHELL-CONTRACT §1). */
const BANNER_HEIGHT = '22px'
/** The var value when chrome is off (D7-008) — collapses `ShellLayout`'s inset to zero. */
const NO_CHROME_HEIGHT = '0px'

/**
 * Layout facts fixed by the shell contract, never config: position, size,
 * type, tracking, z-index. Banner TEXT/COLOR are applied per-instance from
 * config (see the JSX below) — never declared here.
 */
const bannerBaseStyle: CSSProperties = {
  position: 'fixed',
  left: 0,
  right: 0,
  height: BANNER_HEIGHT,
  margin: 0,
  padding: 0,
  fontFamily: "'Figtree', system-ui, sans-serif",
  fontWeight: 700,
  fontSize: '10px',
  lineHeight: BANNER_HEIGHT,
  textAlign: 'center',
  letterSpacing: '0.14em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  zIndex: SHELL_Z.chrome,
}

/**
 * Number of live `ComplianceChrome` instances currently publishing the shared
 * `:root` inset vars. Module-scoped on purpose: it coordinates the ONE global
 * `:root` pair across every instance on the page (see the module header's
 * "Double-mount safety" note — WR-001). Effects run synchronously on the main
 * thread, so a plain counter needs no locking.
 */
let activeChromeInstances = 0

/**
 * Publish the inset vars for a mounting instance and count it in. Always
 * writes (last writer wins on the shared pair); the increment is what lets
 * {@link releaseChromeInset} defer the clear until the last instance leaves.
 */
function acquireChromeInset(height: string): void {
  const root = document.documentElement
  activeChromeInstances += 1
  root.style.setProperty(SHELL_CHROME_TOP_VAR, height)
  root.style.setProperty(SHELL_CHROME_BOTTOM_VAR, height)
}

/**
 * Count a leaving instance out; only the LAST one out clears the shared vars,
 * so an unmounting instance never collapses a still-visible sibling shell's
 * reserved inset (WR-001). `Math.max(0, …)` keeps a stray extra release from
 * driving the count negative and stranding the vars set forever.
 */
function releaseChromeInset(): void {
  activeChromeInstances = Math.max(0, activeChromeInstances - 1)
  if (activeChromeInstances === 0) {
    const root = document.documentElement
    root.style.removeProperty(SHELL_CHROME_TOP_VAR)
    root.style.removeProperty(SHELL_CHROME_BOTTOM_VAR)
  }
}

/**
 * Renders the compliance-chrome banners and publishes the `ShellLayout` inset
 * contract. Mount once, near the root of the participant shell (alongside
 * `ShellLayout`, outside its content region) — see the module header. Safe to
 * mount more than once concurrently (e.g. an outer shell + a `preview` shell,
 * COR-041): the `:root` writes are ref-counted so a partial unmount keeps the
 * inset reserved for the survivor (WR-001).
 */
export function ComplianceChrome() {
  const config = useChromeConfig()

  // Publish the inset contract on :root so ShellLayout's content region
  // (a sibling subtree, not a descendant of this component) insets
  // correctly. Runs in a layout effect so the reserved space is applied
  // before the browser paints the content region beneath it. Acquire/release
  // are ref-counted (see the helpers above): the cleanup removes the vars
  // only when the LAST instance unmounts, so a partial unmount can't collapse
  // a still-visible sibling shell's inset (WR-001) — while a lone instance
  // still clears them on unmount, matching the "0px fallback IS the contract"
  // note on SHELL_CHROME_TOP_VAR/BOTTOM_VAR.
  useLayoutEffect(() => {
    const height = config.enabled ? BANNER_HEIGHT : NO_CHROME_HEIGHT
    acquireChromeInset(height)
    return releaseChromeInset
  }, [config.enabled])

  // Chrome-off is a legal state (AC3): render nothing. The effect above has
  // already driven both inset vars to 0px, so ShellLayout's content region
  // has no reserved-gap artifact.
  if (!config.enabled) return null

  return (
    <>
      <div
        role="note"
        aria-label="Exercise classification banner, top"
        data-testid="pulse-compliance-chrome-top"
        style={{
          ...bannerBaseStyle,
          top: 0,
          color: config.top.fg,
          backgroundColor: config.top.bg,
        }}
      >
        {config.top.text}
      </div>
      <div
        role="note"
        aria-label="Exercise classification banner, bottom"
        data-testid="pulse-compliance-chrome-bottom"
        style={{
          ...bannerBaseStyle,
          bottom: 0,
          color: config.bottom.fg,
          backgroundColor: config.bottom.bg,
        }}
      >
        {config.bottom.text}
      </div>
    </>
  )
}
