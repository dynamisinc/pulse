/**
 * features/participant-shell/components/ChannelNav.tsx
 * ---------------------------------------------------------------------------
 * The channel nav — global strip (desktop) + bottom tab bar (mobile) (feature:
 * participant-shell, story 03; COR-061/062, D7-001; see
 * docs/features/participant-shell/03-channel-nav.md and
 * docs/design/D7-application-shells/SHELL-CONTRACT.md §1 "Channel nav").
 *
 * The ONE shell-owned way to move between channels, so no channel
 * re-implements its own cross-channel switcher (the D7-001 anti-pattern).
 * Desktop renders a 38px global strip under the alert bar; mobile renders a
 * 56px bottom tab bar (up to 5 slots, icon + label). Both read from the SAME
 * enabled-channel list — there is structurally no way for a channel to be
 * offered on one form and not the other.
 *
 * **Self-contained** (mirrors `ComplianceChrome.tsx`): this component reads
 * its own mock config hook (`useChannelNav()`, `../channelNavConfig.ts`)
 * internally. It takes NO props, so `ShellLayout` (story 04) can mount it
 * with zero prop-threading.
 *
 * **Config-driven visibility (AC2, D2-005 "no dangling doors"):** a disabled
 * channel is never present in `useChannelNav()`'s resolved `channels` array
 * (the mock filters it out before this component ever runs — see
 * `channelNavConfig.ts`), so there's no branch here that could accidentally
 * render one. When `hideWhenSingleChannel` is set and there's at most one
 * enabled channel, this component renders NOTHING — neither the strip nor the
 * tab bar (a one-item switcher has nothing to switch between). Phase 1 ships
 * with that flag off by default, so the container is visible now (degenerate,
 * one link) and earns its keep as E4/E5/E6 land (Phase 3, out of scope here).
 *
 * **Switching routes** (channels-foundation 12, #708): the entries are the
 * channels that are enabled AND registered with the channel router
 * (`useNavigableChannels`, `../channelRouter`), the same rule `<ChannelRouter>`
 * mounts by, so the nav and the routes agree. Clicking one navigates to its
 * `navPath` (Social: `/home`), and the URL, not local state, decides which
 * entry is current. Before any channel registers (this component tested on its
 * own) it keeps the Phase-1 behaviour: every enabled channel, and a click only
 * moves the local current marker (AC3).
 *
 * **A11y (NFR-001):** both forms are native links once routed (`<a href>`, so
 * open-in-new-tab works; a plain click is handed to the router) and native
 * `<button>`s before (keyboard-operable by default), with an explicit
 * `:focus-visible` ring since default chrome is stripped for the quiet
 * participant styling, inside a labelled `<nav>`
 * landmark. The current channel is marked BOTH visually (font-weight +
 * underline — never color alone) AND programmatically (`aria-current="page"`).
 *
 * **Responsive without JS/matchMedia:** both the strip and the tab bar are
 * always in the DOM; a single scoped `<style>` block (real CSS, not MUI)
 * toggles which is `display`-ed via a `min-width` media query, mobile-first
 * (tab bar is the default; the strip appears at the desktop breakpoint). This
 * avoids a `window.matchMedia` dependency (no polyfill in the test
 * environment) while still giving each form correct real-browser semantics
 * (the hidden one is `display: none` — removed from layout AND the
 * accessibility tree, so there's never a duplicate landmark/tab-stop for
 * assistive tech or keyboard users).
 *
 * Participant world: no COBRA, no `@/theme/styledComponents`, no MUI, no
 * default MUI look (D0 §2) — plain React + inline style/CSS, quiet grays,
 * never Cadence/COBRA. Never carries instructional text (XC-002) — channel
 * labels only.
 */

import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { IconDefinition } from '@fortawesome/fontawesome-svg-core'
import {
  faBullhorn,
  faCloudSun,
  faComments,
  faHouse,
  faNewspaper,
} from '@fortawesome/free-solid-svg-icons'
import { useExerciseContext } from '@/core/exerciseContext'
import { isWallMirroringExerciseClock, useScenarioTime } from '@/core/clock'
import { useChannelNav, type ChannelIconId } from '../channelNavConfig'
import { TOUCH_TARGET_MIN_PX, touchTargetCss } from './touchTarget'
import { useNavigableChannels, type NavigableChannel } from '../channelRouter/useNavigableChannels'

/** Maps the closed wire icon identifier to a concrete FontAwesome icon (FA-only, D icons). */
const CHANNEL_ICON_MAP: Record<ChannelIconId, IconDefinition> = {
  social: faComments,
  portal: faHouse,
  news: faNewspaper,
  press: faBullhorn,
  weather: faCloudSun,
}

/** SHELL-CONTRACT.md §1: "one 38px global strip". */
const STRIP_HEIGHT = '38px'
/** Story AC: "bottom tab bar (56px, up to 5 slots)". */
const TAB_BAR_HEIGHT = '56px'
/** Story AC: "up to 5 slots" on the mobile tab bar. */
const MAX_MOBILE_TABS = 5
/**
 * Mobile-first breakpoint at which the desktop strip replaces the mobile tab
 * bar. Not specified numerically by the story/contract; a conventional
 * tablet/desktop cut consistent with the participant surfaces' mobile-first
 * rule (D0 §4.6).
 */
const DESKTOP_BREAKPOINT_PX = 768

/**
 * Scoped CSS for both nav forms. Plain `<style>` (no MUI/emotion) so it stays
 * on the "prefer plain React + inline style/CSS vars" side of the two-worlds
 * rule; a real `@media` query is the only way to get true (layout- and
 * a11y-tree-affecting) responsive display without a `matchMedia` JS
 * dependency. Class names are prefixed `pulse-channel-nav-` to stay
 * collision-free with whatever a mounted channel renders in the content
 * region below (COR-060 — the shell must not leak styling INTO the channel;
 * this is the reverse direction, the shell's own chrome, and still kept
 * scoped defensively).
 */
const NAV_STYLES = `
.pulse-channel-nav-strip {
  display: none;
  align-items: center;
  box-sizing: border-box;
  height: ${STRIP_HEIGHT};
  padding: 0 16px;
  background: #fafafa;
  border-bottom: 1px solid #e3e3e3;
  font-family: system-ui, -apple-system, sans-serif;
}
.pulse-channel-nav-strip-list {
  display: flex;
  align-items: center;
  gap: 20px;
  margin: 0;
  padding: 0;
  list-style: none;
}
.pulse-channel-nav-link {
  text-decoration: none;
  background: none;
  border: none;
  margin: 0;
  padding: 4px 2px;
  font: inherit;
  font-size: 13px;
  color: #5a6470;
  cursor: pointer;
}
.pulse-channel-nav-link--current {
  color: #262b31;
  font-weight: 700;
  text-decoration: underline;
  text-underline-offset: 3px;
}
.pulse-channel-nav-dateline {
  margin-left: auto;
  padding-left: 16px;
  font-size: 12px;
  letter-spacing: 0.02em;
  /* Matches the link gray — >=4.5:1 on #fafafa (WCAG 2.1 AA 1.4.3). The
     dateline is participant-visible content (COR-061/062, AC5→NFR-001), so it
     must clear normal-text contrast, not just "never color-only". */
  color: #5a6470;
  white-space: nowrap;
}
.pulse-channel-nav-tabs {
  display: flex;
  align-items: stretch;
  justify-content: space-around;
  box-sizing: border-box;
  height: ${TAB_BAR_HEIGHT};
  background: #fafafa;
  border-top: 1px solid #e3e3e3;
  font-family: system-ui, -apple-system, sans-serif;
}
.pulse-channel-nav-tab {
  text-decoration: none;
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  background: none;
  border: none;
  padding: 4px 2px;
  font: inherit;
  font-size: 11px;
  color: #5a6470;
  cursor: pointer;
}
.pulse-channel-nav-tab--current {
  color: #262b31;
  font-weight: 700;
}
.pulse-channel-nav-tab--current .pulse-channel-nav-tab-label {
  text-decoration: underline;
  text-underline-offset: 2px;
}
.pulse-channel-nav-link:focus-visible,
.pulse-channel-nav-tab:focus-visible {
  outline: 2px solid #2b6cb0;
  outline-offset: 2px;
}
@media (min-width: ${DESKTOP_BREAKPOINT_PX}px) {
  .pulse-channel-nav-strip {
    display: flex;
  }
  .pulse-channel-nav-tabs {
    display: none;
  }
}
/* Touch (tablet) strip: links measured 43x28 at 768 px. On a coarse pointer
   the strip grows to the 44 px touch floor and each link fills it
   (mobile-tablet 17, NFR-001; see touchTarget.ts for why not a hit-slop).
   Mouse layouts keep the 38 px strip. */
@media (pointer: coarse) {
  .pulse-channel-nav-strip {
    height: ${TOUCH_TARGET_MIN_PX}px;
  }
}
${touchTargetCss('.pulse-channel-nav-link')}`

export function ChannelNav() {
  const config = useChannelNav()
  const { timeZone } = useExerciseContext()
  const { now, format } = useScenarioTime(timeZone)

  // Local, per-instance "current channel" state (AC3), seeded from the resolved
  // config's initial channel. It decides the marker only while no channel is
  // registered; once the router is in play the URL does (see the module header).
  const [localCurrentId, setLocalCurrentId] = useState(config.initialChannelId)
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const navigable = useNavigableChannels(config.channels, pathname)
  const channels = navigable.channels
  const currentChannelId = navigable.routed ? navigable.currentChannelId : localCurrentId

  // A routed entry is a real link (href, open-in-new-tab); a click is handled by the
  // router so the page does not reload. Unrouted, the entry is a button that moves
  // the local marker only (Phase-1 behaviour).
  const followLink = (event: MouseEvent<HTMLAnchorElement>, navPath: string) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    if (navPath !== pathname) navigate(navPath)
  }

  // If the enabled-channel set changes under us (e.g. the mock resolves from
  // the loading-state default to live data, or a channel gets disabled) and
  // the currently-marked channel is no longer in it, fall back to the
  // resolved initial channel rather than leaving "current" pointing at a
  // channel that no longer exists (a dangling pointer would be its own
  // "dangling door").
  useEffect(() => {
    if (!config.channels.some(channel => channel.id === localCurrentId)) {
      setLocalCurrentId(config.initialChannelId)
    }
  }, [config.channels, config.initialChannelId, localCurrentId])

  // AC2 degenerate case: nothing to switch between, and config says hide it.
  // Also covers the (unspecified) all-disabled edge case — no channels means
  // no nav, never an empty shell.
  if (channels.length === 0) return null
  if (config.hideWhenSingleChannel && channels.length <= 1) return null

  // COR-053 guard (mobile-tablet story 17): under the default wall-mirroring
  // clock "now" is the real date, not scenario time, so render no dateline at
  // all until a real exercise clock is installed (exercise-clock story 01).
  const dateline = isWallMirroringExerciseClock() ? null : format(now, { format: 'dateline' })
  const mobileChannels = channels.slice(0, MAX_MOBILE_TABS)

  return (
    <>
      <style>{NAV_STYLES}</style>

      {/* Desktop: 38px global strip, plain links, current marked, dateline right-aligned. */}
      <nav
        className="pulse-channel-nav-strip"
        aria-label="Channel navigation"
        data-testid="pulse-channel-nav-strip"
      >
        <ul className="pulse-channel-nav-strip-list">
          {channels.map(channel => {
            const isCurrent = channel.id === currentChannelId
            return (
              <li key={channel.id}>
                <NavEntry
                  channel={channel}
                  className={
                    isCurrent
                      ? 'pulse-channel-nav-link pulse-channel-nav-link--current'
                      : 'pulse-channel-nav-link'
                  }
                  isCurrent={isCurrent}
                  onFollow={followLink}
                  onSelect={setLocalCurrentId}
                >
                  {channel.label}
                </NavEntry>
              </li>
            )
          })}
        </ul>
        {dateline && <span className="pulse-channel-nav-dateline">{dateline}</span>}
      </nav>

      {/* Mobile: 56px bottom tab bar, up to 5 slots, icon + label. */}
      <nav
        className="pulse-channel-nav-tabs"
        aria-label="Channel navigation"
        data-testid="pulse-channel-nav-tabs"
      >
        {mobileChannels.map(channel => {
          const isCurrent = channel.id === currentChannelId
          return (
            <NavEntry
              key={channel.id}
              channel={channel}
              className={
                isCurrent
                  ? 'pulse-channel-nav-tab pulse-channel-nav-tab--current'
                  : 'pulse-channel-nav-tab'
              }
              isCurrent={isCurrent}
              onFollow={followLink}
              onSelect={setLocalCurrentId}
            >
              <FontAwesomeIcon icon={CHANNEL_ICON_MAP[channel.icon]} aria-hidden="true" />
              <span className="pulse-channel-nav-tab-label">{channel.label}</span>
            </NavEntry>
          )
        })}
      </nav>
    </>
  )
}

interface NavEntryProps {
  readonly channel: NavigableChannel
  readonly className: string
  readonly isCurrent: boolean
  readonly onFollow: (event: MouseEvent<HTMLAnchorElement>, navPath: string) => void
  readonly onSelect: (channelId: string) => void
  readonly children: ReactNode
}

/** A routed channel is a real link; an unrouted one (no router composed) a marker button. */
function NavEntry({ channel, className, isCurrent, onFollow, onSelect, children }: NavEntryProps) {
  const ariaCurrent = isCurrent ? ('page' as const) : undefined
  const { navPath } = channel
  if (navPath !== undefined) {
    return (
      <a
        href={navPath}
        className={className}
        aria-current={ariaCurrent}
        onClick={event => onFollow(event, navPath)}
      >
        {children}
      </a>
    )
  }
  return (
    <button
      type="button"
      className={className}
      aria-current={ariaCurrent}
      onClick={() => onSelect(channel.id)}
    >
      {children}
    </button>
  )
}
