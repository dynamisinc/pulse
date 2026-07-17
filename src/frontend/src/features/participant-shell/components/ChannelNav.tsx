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
 * **Switching is local, per-instance state** (AC3): clicking a channel
 * updates which channel is marked current and persists for the lifetime of
 * this component instance. Phase 1 has no cross-channel routing yet (only one
 * channel is ever actually mounted in the content region) — that plumbing is
 * Phase 3/backlog (STORY-UPDATES.md §D); this story delivers the switcher
 * mechanism and its visual/ARIA state, not multi-channel routing.
 *
 * **A11y (NFR-001):** both forms are native `<button>`s (keyboard-operable by
 * default, with an explicit `:focus-visible` ring since default button chrome
 * is stripped for the quiet participant styling) inside a labelled `<nav>`
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

import { useEffect, useState } from 'react'
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
import { useScenarioTime } from '@/core/clock'
import { useChannelNav, type ChannelIconId } from '../channelNavConfig'

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
`

export function ChannelNav() {
  const config = useChannelNav()
  const { timeZone } = useExerciseContext()
  const { now, format } = useScenarioTime(timeZone)

  // Local, per-instance "current channel" state (AC3). Seeded from the
  // resolved config's initial channel; a real cross-channel mount switch is
  // Phase 3 (see module header) — for now this only drives the marked/current
  // visual + aria-current state.
  const [currentChannelId, setCurrentChannelId] = useState(config.initialChannelId)

  // If the enabled-channel set changes under us (e.g. the mock resolves from
  // the loading-state default to live data, or a channel gets disabled) and
  // the currently-marked channel is no longer in it, fall back to the
  // resolved initial channel rather than leaving "current" pointing at a
  // channel that no longer exists (a dangling pointer would be its own
  // "dangling door").
  useEffect(() => {
    if (!config.channels.some(channel => channel.id === currentChannelId)) {
      setCurrentChannelId(config.initialChannelId)
    }
  }, [config.channels, config.initialChannelId, currentChannelId])

  // AC2 degenerate case: nothing to switch between, and config says hide it.
  // Also covers the (unspecified) all-disabled edge case — no channels means
  // no nav, never an empty shell.
  if (config.channels.length === 0) return null
  if (config.hideWhenSingleChannel && config.channels.length <= 1) return null

  const dateline = format(now, { format: 'dateline' })
  const mobileChannels = config.channels.slice(0, MAX_MOBILE_TABS)

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
          {config.channels.map(channel => {
            const isCurrent = channel.id === currentChannelId
            return (
              <li key={channel.id}>
                <button
                  type="button"
                  className={
                    isCurrent
                      ? 'pulse-channel-nav-link pulse-channel-nav-link--current'
                      : 'pulse-channel-nav-link'
                  }
                  aria-current={isCurrent ? 'page' : undefined}
                  onClick={() => setCurrentChannelId(channel.id)}
                >
                  {channel.label}
                </button>
              </li>
            )
          })}
        </ul>
        <span className="pulse-channel-nav-dateline">{dateline}</span>
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
            <button
              key={channel.id}
              type="button"
              className={
                isCurrent
                  ? 'pulse-channel-nav-tab pulse-channel-nav-tab--current'
                  : 'pulse-channel-nav-tab'
              }
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => setCurrentChannelId(channel.id)}
            >
              <FontAwesomeIcon icon={CHANNEL_ICON_MAP[channel.icon]} aria-hidden="true" />
              <span className="pulse-channel-nav-tab-label">{channel.label}</span>
            </button>
          )
        })}
      </nav>
    </>
  )
}
