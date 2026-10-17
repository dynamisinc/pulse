/**
 * features/controller/console/ConsolePaneTabs.tsx
 * ---------------------------------------------------------------------------
 * The console's ONE pane switcher (feature: mobile-tablet, story 12; TABLET-AMENDMENT
 * sections 2 and 6, NFR-001). STAFF world: staff-shell tokens (the tabs sit on the light work
 * area), FontAwesome, `sx`-only.
 * Wherever panes collapse at tablet widths (Live world / Run sheet, and Review on a portrait
 * tablet) they share this tab bar.
 *
 * ARIA TABS PATTERN. `role="tablist"`; each tab is a `role="tab"` button with `aria-selected`,
 * `aria-controls` (the pane's id) and a roving tabindex (only the selected tab is a tab stop).
 * Left / Right arrows move to the neighbouring tab (wrapping), Home / End jump to the first /
 * last; selection follows focus (switching a pane is instant and costs nothing, because every
 * pane stays mounted). Enter / Space / tap activate as for any button.
 *
 * TOUCH. Every tab is at least 44px tall (`TAB_MIN_HEIGHT_PX`).
 *
 * NEVER COLOUR-ONLY (NFR-001). The active tab is marked by `aria-selected`, BOLD text and an
 * UNDERLINE; colour only reinforces. Every tab carries a TEXT badge (a count plus its label:
 * "12 new", "3 due", "5 · 1 under 60s"); a badge that needs attention also carries an icon.
 *
 * This component only draws the bar and reports the choice. WHICH panes are tabs comes from the
 * layout table (`consoleLayout.ts`), and the panes themselves (kept mounted, hidden when
 * inactive, so scroll position and half-typed edits survive a switch or a rotation) are the
 * frame's (`ConsoleTabletFrame.tsx`). `consolePaneTabId` / `consolePanePanelId`
 * (in `consoleLayout.ts`) name the tab and panel pair.
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react'
import { Box } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTriangleExclamation, type IconDefinition } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import { consolePanePanelId, consolePaneTabId, TAB_MIN_HEIGHT_PX, type ConsolePaneId } from './consoleLayout'

const NAVY = staffShellTokens.header.background
const MUTED = staffShellTokens.accent.secondaryText
const LINE = staffShellTokens.toolstrip.borderColor

/** One tab: its pane, label and text badge. */
export interface ConsolePaneTab {
  readonly id: ConsolePaneId
  readonly label: string
  /** The badge text (count plus label). Always text, never colour alone. */
  readonly badge: string
  /** True when the badge needs attention; it then also shows a warning icon. */
  readonly attention?: boolean
  readonly icon?: IconDefinition
  /**
   * Draws the badge instead of the default one (use {@link PaneBadge}). A tab whose count ticks
   * (Review) uses it so only the badge re-renders, not the whole bar or frame.
   */
  readonly renderBadge?: () => ReactNode
}

/** A tab's text badge: a count plus its label, with a warning icon when it needs attention. */
export function PaneBadge(
  { id, text, attention }: { id: ConsolePaneId, text: string, attention: boolean },
) {
  return (
    <Box
      component="span"
      data-testid={`console-pane-badge-${id}`}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '5px',
        px: '8px',
        py: '2px',
        fontSize: 11,
        fontWeight: 700,
        textDecorationLine: 'none',
        color: attention ? staffShellTokens.accent.cadenceRed : MUTED,
        border: `1px solid ${attention ? staffShellTokens.accent.cadenceRed : LINE}`,
        borderRadius: '20px',
      }}
    >
      {attention && <FontAwesomeIcon icon={faTriangleExclamation} aria-hidden="true" />}
      {text}
    </Box>
  )
}

export interface ConsolePaneTabsProps {
  readonly tabs: readonly ConsolePaneTab[]
  readonly activeId: ConsolePaneId
  readonly onChange: (id: ConsolePaneId) => void
}

export function ConsolePaneTabs({ tabs, activeId, onChange }: ConsolePaneTabsProps) {
  const tabRefs = useRef(new Map<ConsolePaneId, HTMLButtonElement>())

  const move = (to: number) => {
    const target = tabs[(to + tabs.length) % tabs.length]
    if (target === undefined) return
    tabRefs.current.get(target.id)?.focus()
    onChange(target.id)
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const current = Math.max(0, tabs.findIndex(tab => tab.id === activeId))
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault()
        move(current + 1)
        break
      case 'ArrowLeft':
        event.preventDefault()
        move(current - 1)
        break
      case 'Home':
        event.preventDefault()
        move(0)
        break
      case 'End':
        event.preventDefault()
        move(tabs.length - 1)
        break
      default:
    }
  }

  return (
    <Box
      role="tablist"
      aria-label="Console panes"
      aria-orientation="horizontal"
      data-testid="console-pane-tabs"
      onKeyDown={handleKeyDown}
      sx={{
        display: 'flex',
        gap: '8px',
        flexWrap: 'wrap',
        borderBottom: `1px solid ${LINE}`,
      }}
    >
      {tabs.map(tab => {
        const selected = tab.id === activeId
        return (
          <Box
            key={tab.id}
            component="button"
            type="button"
            role="tab"
            id={consolePaneTabId(tab.id)}
            data-testid={`console-pane-tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={consolePanePanelId(tab.id)}
            tabIndex={selected ? 0 : -1}
            ref={(node: HTMLButtonElement | null) => {
              if (node === null) tabRefs.current.delete(tab.id)
              else tabRefs.current.set(tab.id, node)
            }}
            onClick={() => onChange(tab.id)}
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              minHeight: TAB_MIN_HEIGHT_PX,
              px: '14px',
              cursor: 'pointer',
              fontFamily: 'inherit',
              fontSize: 13,
              // Bold + underline mark the active tab; colour only reinforces (NFR-001).
              fontWeight: selected ? 800 : 500,
              color: selected ? NAVY : MUTED,
              bgcolor: selected ? staffShellTokens.toolstrip.background : 'transparent',
              border: 'none',
              borderBottom: selected ? `3px solid ${NAVY}` : '3px solid transparent',
              textDecorationLine: selected ? 'underline' : 'none',
              textUnderlineOffset: '5px',
              '&:focus-visible': { outline: `2px solid ${NAVY}`, outlineOffset: '-2px' },
            }}
          >
            {tab.icon !== undefined && <FontAwesomeIcon icon={tab.icon} aria-hidden="true" />}
            <span>{tab.label}</span>
            {tab.renderBadge !== undefined
              ? tab.renderBadge()
              : <PaneBadge id={tab.id} text={tab.badge} attention={tab.attention === true} />}
          </Box>
        )
      })}
    </Box>
  )
}
