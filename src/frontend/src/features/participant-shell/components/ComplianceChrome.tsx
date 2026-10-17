/**
 * features/participant-shell/components/ComplianceChrome.tsx
 * ---------------------------------------------------------------------------
 * The compliance-chrome banners (feature: participant-shell, story 01;
 * COR-031, COR-030/066, NFR-001, NFR-008; see
 * docs/features/participant-shell/01-compliance-chrome.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Compliance chrome").
 *
 * Renders the two fixed 22px classification banners at the absolute top and
 * bottom of the viewport (on phones they may wrap; see "Narrow screens"
 * below) — visually OUTSIDE any channel's content region
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
 * Narrow screens (#612, D7-005 phone amendment): below `CHROME_WRAP_QUERY`
 * (~700px) a 22px single line cannot hold a typical marking (the default bottom
 * text lost "— NOT REAL NEWS" at 360px). There the banners WRAP: up to
 * `WRAP_MAX_LINES` lines at an 11px line height, centred in a band that is
 * never shorter than 22px, with an ellipsis only past the last line. Because
 * the band height now depends on the text, the published inset vars carry
 * the MEASURED banner heights (a ResizeObserver keeps them current through
 * rotation, font load and text changes) instead of the fixed `calc()`. At
 * ~700px and wider nothing changes: one line, 22px, the constant inset.
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

import { useLayoutEffect, useRef, type CSSProperties } from 'react'
import { useMediaQuery } from '@/core/hooks/useMediaQuery'
import {
  SHELL_CHROME_BOTTOM_VAR,
  SHELL_CHROME_TOP_VAR,
  SHELL_Z,
} from '../mountContract'
import { useChromeConfig } from '../chromeConfig'

/** The shell's fixed compliance-chrome banner height (D7-005, SHELL-CONTRACT §1). */
const BANNER_HEIGHT = '22px'
/**
 * SAFE AREAS (mobile-tablet WR-001). The app sets `viewport-fit=cover`, so on a notched /
 * home-indicator phone the page extends under the system UI. Each banner therefore pads
 * itself by the relevant `env(safe-area-inset-*)` (text stays in the 22px band) and its
 * height, AND the published `--pulse-chrome-top/bottom` inset, grow by the same amount, so
 * everything pinned below/above the banners (alert bar, tab bar, modals) clears them.
 * `env()` is 0 where unsupported, so desktop is unchanged (22px).
 */
export const TOP_BANNER_HEIGHT = `calc(${BANNER_HEIGHT} + env(safe-area-inset-top, 0px))`
export const BOTTOM_BANNER_HEIGHT = `calc(${BANNER_HEIGHT} + env(safe-area-inset-bottom, 0px))`
const TOP_BANNER_PADDING =
  'env(safe-area-inset-top, 0px) env(safe-area-inset-right, 0px) 0 env(safe-area-inset-left, 0px)'
const BOTTOM_BANNER_PADDING =
  '0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px)'
/**
 * NARROW SCREENS (#612, D7-005 phone amendment). Below this width the banner text wraps
 * instead of being clipped. 700px sits between the widest phone (~430) and the smallest
 * tablet (768), so tablets and desktop keep the single 22px line.
 */
export const CHROME_WRAP_QUERY = '(max-width: 699.98px)'
/** Line height of wrapped banner text; 2 lines + padding = a 28px band. */
const WRAP_LINE_HEIGHT = '11px'
/** Lines shown before the text is clamped with an ellipsis (the full text stays in the DOM). */
export const WRAP_MAX_LINES = 3
/** Vertical padding inside a wrapped band (added to the safe-area inset on the outer edge). */
const WRAP_PADDING_BLOCK = '3px'
const TOP_WRAP_PADDING =
  `calc(env(safe-area-inset-top, 0px) + ${WRAP_PADDING_BLOCK}) env(safe-area-inset-right, 0px) ${WRAP_PADDING_BLOCK} env(safe-area-inset-left, 0px)`
const BOTTOM_WRAP_PADDING =
  `${WRAP_PADDING_BLOCK} env(safe-area-inset-right, 0px) calc(env(safe-area-inset-bottom, 0px) + ${WRAP_PADDING_BLOCK}) env(safe-area-inset-left, 0px)`

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
  boxSizing: 'border-box',
  margin: 0,
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
 * Wrapped (narrow-screen) band: flex-centres the text so a single line still sits in the
 * middle of the 22px minimum, and lets the band grow with the text.
 */
const wrapBandStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  whiteSpace: 'normal',
  lineHeight: WRAP_LINE_HEIGHT,
}

/** The text inside a wrapped band: at most WRAP_MAX_LINES lines, then an ellipsis. */
const wrapTextStyle: CSSProperties = {
  display: '-webkit-box',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: WRAP_MAX_LINES,
  overflow: 'hidden',
  overflowWrap: 'anywhere',
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
function acquireChromeInset(top: string, bottom: string): void {
  activeChromeInstances += 1
  publishChromeInset(top, bottom)
}

/**
 * Write the shared inset pair without touching the instance count. Used on acquire and,
 * on narrow screens, whenever a wrapped banner's measured height changes.
 */
function publishChromeInset(top: string, bottom: string): void {
  const root = document.documentElement
  root.style.setProperty(SHELL_CHROME_TOP_VAR, top)
  root.style.setProperty(SHELL_CHROME_BOTTOM_VAR, bottom)
}

/** A banner's rendered height as a whole-px CSS length (rounded up, so nothing tucks under it). */
function measuredHeight(el: HTMLElement): string {
  return `${Math.ceil(el.getBoundingClientRect().height)}px`
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
  const wraps = useMediaQuery(CHROME_WRAP_QUERY)
  const topRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

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
    if (config.enabled) acquireChromeInset(TOP_BANNER_HEIGHT, BOTTOM_BANNER_HEIGHT)
    else acquireChromeInset(NO_CHROME_HEIGHT, NO_CHROME_HEIGHT)
    return releaseChromeInset
  }, [config.enabled, wraps])

  // Narrow screens (#612): the wrapped bands' heights depend on the text, so publish what
  // was actually rendered, and keep it current (rotation, font load, config text change).
  // Declared AFTER the acquire effect so, within the same commit, the measured value
  // overwrites the constant it just published. Wide screens never run this.
  useLayoutEffect(() => {
    const top = topRef.current
    const bottom = bottomRef.current
    if (!config.enabled || !wraps || top === null || bottom === null) return undefined
    const publish = () => publishChromeInset(measuredHeight(top), measuredHeight(bottom))
    publish()
    if (typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(publish)
    observer.observe(top)
    observer.observe(bottom)
    return () => observer.disconnect()
  }, [config.enabled, wraps, config.top.text, config.bottom.text])

  // Chrome-off is a legal state (AC3): render nothing. The effect above has
  // already driven both inset vars to 0px, so ShellLayout's content region
  // has no reserved-gap artifact.
  if (!config.enabled) return null

  return (
    <>
      <div
        ref={topRef}
        role="note"
        aria-label="Exercise classification banner, top"
        data-testid="pulse-compliance-chrome-top"
        data-wrapped={wraps ? 'true' : undefined}
        style={{
          ...bannerBaseStyle,
          ...(wraps ? wrapBandStyle : null),
          top: 0,
          height: wraps ? undefined : TOP_BANNER_HEIGHT,
          minHeight: wraps ? TOP_BANNER_HEIGHT : undefined,
          padding: wraps ? TOP_WRAP_PADDING : TOP_BANNER_PADDING,
          color: config.top.fg,
          backgroundColor: config.top.bg,
        }}
      >
        <span style={wraps ? wrapTextStyle : undefined}>{config.top.text}</span>
      </div>
      <div
        ref={bottomRef}
        role="note"
        aria-label="Exercise classification banner, bottom"
        data-testid="pulse-compliance-chrome-bottom"
        data-wrapped={wraps ? 'true' : undefined}
        style={{
          ...bannerBaseStyle,
          ...(wraps ? wrapBandStyle : null),
          bottom: 0,
          height: wraps ? undefined : BOTTOM_BANNER_HEIGHT,
          minHeight: wraps ? BOTTOM_BANNER_HEIGHT : undefined,
          padding: wraps ? BOTTOM_WRAP_PADDING : BOTTOM_BANNER_PADDING,
          color: config.bottom.fg,
          backgroundColor: config.bottom.bg,
        }}
      >
        <span style={wraps ? wrapTextStyle : undefined}>{config.bottom.text}</span>
      </div>
    </>
  )
}
