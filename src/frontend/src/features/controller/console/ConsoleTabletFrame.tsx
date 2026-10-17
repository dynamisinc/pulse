/**
 * features/controller/console/ConsoleTabletFrame.tsx
 * ---------------------------------------------------------------------------
 * The controller console's TABLET frame (feature: mobile-tablet, story 12; D5-021 to D5-023 and
 * D5-026; TABLET-AMENDMENT sections 2 and 3). STAFF world: staff-shell tokens, COBRA buttons,
 * `CobraStyles` spacing, FontAwesome, MUI 9 `sx`-only. `ControllerConsole` renders this INSTEAD
 * of its desktop work area on any band under 1280px wide (`useConsoleLayout()`); the desktop
 * layout is untouched.
 *
 * ## What it draws, top to bottom
 *  1. The COMMAND BAND (D5-023): a sticky, non-scrolling strip holding, IN THIS ORDER,
 *     `EngineControlBar` (the kill switch is its first item), `PausePill`, and End exercise
 *     (`lifecycleSlot`) at the far right end, so the kill switch and EndEx are never neighbours.
 *     It is never inside a tab, never in an overflow menu, and flyouts never cover it (they sit
 *     in the pane area below it). On a portrait tablet it wraps to two rows. These components
 *     are only PLACED here; their internals belong to other stories.
 *  2. The title row: heading, "View only" chip, the "More" menu (Export posts, Exercise report)
 *     and the call sign.
 *  3. The ⌘K shortcut strip (handed in, unchanged; shortcut behaviour is story 14's).
 *  4. The Steering disclosure row (D5-026), collapsed by default.
 *  5. The PANE GRID: Live world, Run sheet and Review queue, arranged by the layout table in
 *     `consoleLayout.ts`, with the shared tab bar (`ConsolePaneTabs`) over the tabbed panes.
 *  6. The flyouts (persona dock, ENGINE, USAGE), handed in and positioned over the pane area
 *     ONLY, because the pane area is their positioning context.
 *
 * ## ALL PANES STAY MOUNTED
 * The three panes are fixed children of ONE grid, in a fixed order, at every band; only the
 * grid template and each pane's grid area change. A pane that is not showing is
 * `visibility: hidden` (not unmounted and not `display: none`), so it keeps its box, its scroll
 * position, a half-typed edit and any open dock child through a tab switch AND a rotation
 * between bands. The active tab is state of THIS component, and is derived against the current
 * tab list, so a tab that stops existing (Review leaves the tab bar in landscape) is not
 * forgotten: it is back when the band returns.
 *
 * ## Badges (TABLET-AMENDMENT section 6)
 * Live world "N new" and Run sheet "N due" are published by the panes through `paneBadges`;
 * Review is "N · M under 60s" from `useReviewQueue`, the same single count source as the engine
 * control bar. Every badge is text; a Review badge with a timer under 60s also gets an icon.
 *
 * Roles: nothing here adds or removes a guard. The controls it places check `useCanControl()`
 * themselves, so an evaluator or planner sees on a tablet what they see on desktop.
 */

import { useState, type ReactNode } from 'react'
import { Box, Typography } from '@mui/material'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTowerBroadcast } from '@fortawesome/free-solid-svg-icons'
import { staffShellTokens } from '@/features/staffShell/staffShellTokens'
import CobraStyles from '@/theme/CobraStyles'
import { ViewOnlyChip } from '../access'
import { EngineControlBar, useReviewQueue } from '../engine'
import { PausePill } from '../components/steering/PausePill'
import {
  consolePanePanelId,
  consolePaneTabId,
  paneGridTemplate,
  tabbedPanes,
  type ConsolePaneId,
  type ConsoleTabletBand,
  type ConsoleTabletLayout,
} from './consoleLayout'
import { ConsolePaneTabs, type ConsolePaneTab } from './ConsolePaneTabs'
import { ConsoleMoreMenu } from './ConsoleMoreMenu'
import { ConsoleSteeringDisclosure } from './ConsoleSteeringDisclosure'
import type { PaneBadgeCounts } from './paneBadges'

/** Smallest height the pane grid is given before the body scrolls instead of squeezing it. */
const PANE_GRID_MIN_HEIGHT_PX = 280

const NAVY = staffShellTokens.header.background
const MUTED = staffShellTokens.accent.secondaryText

const TAB_LABELS: Readonly<Record<ConsolePaneId, string>> = {
  'live-world': 'Live world',
  'run-sheet': 'Run sheet',
  review: 'Review',
}

export interface ConsoleTabletFrameProps {
  readonly band: ConsoleTabletBand
  readonly layout: ConsoleTabletLayout
  /** Whether each main-area slot was supplied (an absent slot is no pane and no tab). */
  readonly hasLiveWorld: boolean
  readonly hasRunSheet: boolean
  readonly liveWorld: ReactNode
  readonly runSheet: ReactNode
  /** The docked `<ReviewQueue>` element (the console builds it, with its edit slot). */
  readonly reviewQueue: ReactNode
  readonly badges: PaneBadgeCounts
  readonly callSign: string
  /** End exercise: lands at the far right of the command band. */
  readonly lifecycleSlot: ReactNode
  /** The ⌘K shortcut strip, unchanged (null for a non-controller). */
  readonly shortcutStrip: ReactNode
  /** The persona dock, ENGINE and USAGE flyouts: positioned over the pane area only. */
  readonly flyouts: ReactNode
}

export function ConsoleTabletFrame({
  band,
  layout,
  hasLiveWorld,
  hasRunSheet,
  liveWorld,
  runSheet,
  reviewQueue,
  badges,
  callSign,
  lifecycleSlot,
  shortcutStrip,
  flyouts,
}: ConsoleTabletFrameProps) {
  const { pendingCount, timersUnder60sCount } = useReviewQueue()
  const [selectedPane, setSelectedPane] = useState<ConsolePaneId>('live-world')

  const tabIds = tabbedPanes(layout, { liveWorld: hasLiveWorld, runSheet: hasRunSheet })
  const isTab = (pane: ConsolePaneId) => tabIds.includes(pane)
  // The tab in force: the selection when it is a tab in THIS layout, else the first tab. The
  // selection itself is kept, so a rotation back restores it.
  const activePane: ConsolePaneId | undefined = tabIds.includes(selectedPane)
    ? selectedPane
    : tabIds[0]

  const tabs: ConsolePaneTab[] = tabIds.map(id => {
    switch (id) {
      case 'live-world':
        return { id, label: TAB_LABELS[id], badge: `${badges.liveWorld ?? 0} new` }
      case 'run-sheet':
        return { id, label: TAB_LABELS[id], badge: `${badges.runSheet ?? 0} due` }
      case 'review':
        return {
          id,
          label: TAB_LABELS[id],
          badge: `${pendingCount} · ${timersUnder60sCount} under 60s`,
          attention: timersUnder60sCount > 0,
        }
    }
  })

  const grid = paneGridTemplate(layout)
  const split = layout.main === 'split'
  const noSlots = !hasLiveWorld && !hasRunSheet

  /** Common sx for a pane: its grid area, and hidden-but-mounted when it is not showing. */
  const paneSx = (area: string, showing: boolean) => ({
    gridArea: area,
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
    visibility: showing ? 'visible' : 'hidden',
  }) as const

  /** Tab-panel semantics for a pane that is a tab in this layout; a landmark otherwise. */
  const paneAria = (pane: ConsolePaneId, label: string) =>
    isTab(pane)
      ? { role: 'tabpanel', 'aria-labelledby': consolePaneTabId(pane) }
      : { 'aria-label': label }

  return (
    <Box
      data-testid="console-tablet-frame"
      data-band={band}
      sx={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* The command band (D5-023): kill switch first, Pause, End exercise at the far right. */}
      <Box
        data-testid="console-command-band"
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          flex: 'none',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: CobraStyles.Spacing.FormFields,
          rowGap: CobraStyles.Spacing.IconAndText,
          bgcolor: staffShellTokens.workArea.background,
          borderBottom: `1px solid ${staffShellTokens.toolstrip.borderColor}`,
        }}
      >
        <Box sx={{ flex: '1 1 auto', minWidth: 0 }}>
          <EngineControlBar />
        </Box>
        <Box sx={{ flex: 'none', py: CobraStyles.Spacing.IconAndText, pl: CobraStyles.Spacing.FormFields }}>
          <PausePill />
        </Box>
        {lifecycleSlot !== null && lifecycleSlot !== undefined && (
          <Box
            data-testid="console-command-band-end"
            sx={{ flex: 'none', ml: 'auto', py: CobraStyles.Spacing.IconAndText, pr: CobraStyles.Spacing.FormFields }}
          >
            {lifecycleSlot}
          </Box>
        )}
      </Box>

      {/* The pane area: also the flyouts' positioning context, so they never cover the band. */}
      <Box sx={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: CobraStyles.Spacing.FormFields,
            p: CobraStyles.Padding.MainWindow,
            boxSizing: 'border-box',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: CobraStyles.Spacing.FormFields }}>
            <FontAwesomeIcon icon={faTowerBroadcast} color={NAVY} />
            <Typography
              component="h1"
              sx={{ fontSize: 14, fontWeight: 800, letterSpacing: '0.1em', color: NAVY }}
            >
              CONTROLLER CONSOLE
            </Typography>
            <Box sx={{ flex: 1 }} />
            <ViewOnlyChip />
            <ConsoleMoreMenu />
            <Typography
              data-testid="controller-callsign"
              sx={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', color: MUTED }}
            >
              {callSign}
            </Typography>
          </Box>

          {shortcutStrip}

          <ConsoleSteeringDisclosure />

          <Box
            data-testid="console-slots"
            data-layout={band}
            sx={{
              display: 'grid',
              gridTemplateAreas: grid.areas,
              gridTemplateColumns: grid.columns,
              gridTemplateRows: grid.rows,
              gap: CobraStyles.Spacing.FormFields,
              flex: 1,
              minHeight: PANE_GRID_MIN_HEIGHT_PX,
            }}
          >
            {tabs.length > 1 && activePane !== undefined && (
              <Box sx={{ gridArea: 'tabs' }}>
                <ConsolePaneTabs tabs={tabs} activeId={activePane} onChange={setSelectedPane} />
              </Box>
            )}

            {noSlots && !isTab('review') && (
              <Typography
                data-testid="console-slots-status"
                sx={{ gridArea: split ? 'live' : 'main', fontSize: 12, color: MUTED }}
              >
                Live world and run sheet are not connected to this console.
              </Typography>
            )}

            {hasLiveWorld && (
              <Box
                component="section"
                id={consolePanePanelId('live-world')}
                data-testid="console-slot-live-world"
                {...paneAria('live-world', 'Live world')}
                sx={paneSx(split ? 'live' : 'main', split || activePane === 'live-world')}
              >
                {liveWorld}
              </Box>
            )}
            {hasRunSheet && (
              <Box
                component="section"
                id={consolePanePanelId('run-sheet')}
                data-testid="console-slot-run-sheet"
                {...paneAria('run-sheet', 'Run sheet')}
                sx={paneSx(split ? 'run' : 'main', split || activePane === 'run-sheet')}
              >
                {runSheet}
              </Box>
            )}

            <Box
              id={consolePanePanelId('review')}
              data-testid="review-queue-column"
              {...(isTab('review')
                ? { role: 'tabpanel', 'aria-labelledby': consolePaneTabId('review') }
                : {})}
              sx={{
                ...paneSx(
                  layout.review === 'tab' ? 'main' : 'review',
                  !isTab('review') || activePane === 'review',
                ),
                overflow: 'hidden',
              }}
            >
              {reviewQueue}
            </Box>
          </Box>
        </Box>

        {flyouts}
      </Box>
    </Box>
  )
}
