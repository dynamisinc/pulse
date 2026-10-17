/**
 * features/controller/console/consoleLayout.ts
 * ---------------------------------------------------------------------------
 * The controller console's LAYOUT BANDS and the ONE layout table that decides how the
 * panes (Live world, Run sheet, Review queue) are arranged at each tablet size
 * (feature: mobile-tablet, story 12; D5-021 and D5-022 in docs/design/DECISIONS.md;
 * docs/design/D5-controller-console/TABLET-AMENDMENT.md sections 1 and 2). STAFF world:
 * pure logic, no UI.
 *
 * ## Bands: chosen by viewport WIDTH only (D5-021)
 *   desktop    1280 and up   the console exactly as it was (this file does not touch it)
 *   landscape  1024 to 1279  1024x768, 1180x820; sub-split at 1180 (see the table below)
 *   portrait   768 to 1023   768x1024, 820x1180; sub-split for a TALL window (820 wide, 1100 tall)
 *   (under 768 is not supported for staff; it renders the portrait layout unchanged.)
 *
 * The edges reuse breakpoints that already exist: 1280 is the console's own
 * `SLOT_SPLIT_MIN_WIDTH_PX` (exported from here now, so ControllerConsole and this file
 * agree), 1024 and 768 are the COBRA `lg` and `md` breakpoints (`cobraBreakpoints`).
 * Touch sizing is a SEPARATE test, `(pointer: coarse)` (story 14); an iPad with a trackpad still
 * gets the tablet layout and a narrow desktop window gets it without touch sizing.
 *
 * ## The layout table (D5-022): changing a layout is a ONE-LINE edit
 * {@link CONSOLE_TABLET_LAYOUTS} maps each tablet band to a {@link ConsoleTabletLayout}:
 *   - `main`:   'switcher' (Live world and Run sheet share one pane, with tabs) or 'split'
 *               (Live world | Run sheet side by side);
 *   - `review`: 'dock-right' (a docked 296px column), 'dock-below' (a docked lower region) or
 *               'tab' (a badged tab in the switcher).
 * Tom signed these initial values and expects to revisit the 1180 landscape one after
 * hands-on use, so it is a table entry, not a code fork: to try Live world / Run sheet as a
 * switcher at 1180, change `landscapeWide.main` to 'switcher' and nothing else.
 *
 * ## The pane switcher's tab list is DERIVED from the layout ({@link tabbedPanes})
 * Live world and Run sheet are tabs when `main` is 'switcher'; Review is a tab when `review` is
 * 'tab'. `review: 'tab'` needs the switcher, so with `main: 'split'` it is treated as a switcher
 * (the table cannot describe a layout the frame cannot draw).
 *
 * ## Environments without media queries
 * Real browsers always have `matchMedia`. jsdom does not, and most tests never stub it. With
 * no `matchMedia` the answer is the DESKTOP band, so every existing console test keeps the
 * layout it was written against. A test that wants a tablet width stubs `matchMedia`.
 */

import { useMediaQuery } from '@mui/material'
import { cobraBreakpoints } from '@/theme/cobraTheme'

/** Viewport width at which Live world | Run sheet sit side by side on the desktop console. */
export const SLOT_SPLIT_MIN_WIDTH_PX = 1280

/** Landscape tablet floor: the COBRA `lg` breakpoint. */
export const TABLET_LANDSCAPE_MIN_WIDTH_PX = cobraBreakpoints.values.lg

/** Portrait tablet floor: the COBRA `md` breakpoint (narrower windows get portrait too). */
export const TABLET_PORTRAIT_MIN_WIDTH_PX = cobraBreakpoints.values.md

/** From this width a landscape tablet (1180x820) can seat Live world | Run sheet side by side. */
export const TABLET_LANDSCAPE_WIDE_MIN_WIDTH_PX = 1180

/** A portrait window at least this wide AND this tall (820x1180) is "tall portrait". */
export const TABLET_TALL_PORTRAIT_MIN_WIDTH_PX = 820
export const TABLET_TALL_PORTRAIT_MIN_HEIGHT_PX = 1100

/** The docked Review queue's width at tablet sizes (D5-015 clamp). Desktop keeps 336. */
export const REVIEW_QUEUE_TABLET_WIDTH_PX = 296

/** The desktop band plus the four tablet bands. */
export type ConsoleBand = 'desktop' | ConsoleTabletBand

/** The tablet bands the layout table is keyed by. */
export type ConsoleTabletBand =
  | 'landscape'
  | 'landscapeWide'
  | 'portrait'
  | 'portraitTall'

/** The three panes of the console. */
export type ConsolePaneId = 'live-world' | 'run-sheet' | 'review'

/** How one tablet band arranges the panes. See the module header. */
export interface ConsoleTabletLayout {
  /** Live world and Run sheet: one tabbed pane, or two columns. */
  readonly main: 'switcher' | 'split'
  /** The Review queue: docked right, docked below the main region, or a tab. */
  readonly review: 'dock-right' | 'dock-below' | 'tab'
}

/**
 * THE layout table (D5-022). The signed initial values (Tom, 10/16 and 10/17):
 *  - landscape (1024 to 1179):   one Live world / Run sheet switcher + docked 296px Review queue;
 *  - landscapeWide (1180+):      Live world | Run sheet side by side + docked Review queue;
 *  - portraitTall (820x1100+):   the switcher above a docked Review queue (about 60/40);
 *  - portrait (other):           a full tab switcher with Review as a badged tab.
 */
export const CONSOLE_TABLET_LAYOUTS: Readonly<Record<ConsoleTabletBand, ConsoleTabletLayout>> = {
  landscape: { main: 'switcher', review: 'dock-right' },
  landscapeWide: { main: 'split', review: 'dock-right' },
  portrait: { main: 'switcher', review: 'tab' },
  portraitTall: { main: 'switcher', review: 'dock-below' },
}

/**
 * The band for a viewport. Width decides the band (D5-021); height only separates a TALL portrait
 * window from the other portrait ones. Pure: the hook below feeds it from media queries.
 */
export function selectConsoleBand(widthPx: number, heightPx: number): ConsoleBand {
  if (widthPx >= SLOT_SPLIT_MIN_WIDTH_PX) return 'desktop'
  if (widthPx >= TABLET_LANDSCAPE_WIDE_MIN_WIDTH_PX) return 'landscapeWide'
  if (widthPx >= TABLET_LANDSCAPE_MIN_WIDTH_PX) return 'landscape'
  if (
    widthPx >= TABLET_TALL_PORTRAIT_MIN_WIDTH_PX
    && heightPx >= TABLET_TALL_PORTRAIT_MIN_HEIGHT_PX
  ) {
    return 'portraitTall'
  }
  return 'portrait'
}

/** The layout for a tablet band, normalised so a Review tab always has a switcher to live in. */
export function layoutForBand(band: ConsoleTabletBand): ConsoleTabletLayout {
  const layout = CONSOLE_TABLET_LAYOUTS[band]
  return layout.review === 'tab' && layout.main === 'split'
    ? { main: 'switcher', review: 'tab' }
    : layout
}

/**
 * The panes that are TABS for a layout, in tab order, limited to the panes that exist
 * (`hasLiveWorld` / `hasRunSheet`: the console renders a slot only when its render prop is given).
 */
export function tabbedPanes(
  layout: ConsoleTabletLayout,
  present: { readonly liveWorld: boolean; readonly runSheet: boolean },
): ConsolePaneId[] {
  const panes: ConsolePaneId[] = []
  if (layout.main === 'switcher') {
    if (present.liveWorld) panes.push('live-world')
    if (present.runSheet) panes.push('run-sheet')
  }
  if (layout.review === 'tab') panes.push('review')
  return panes
}

/** The smallest pane-tab height (touch target, TABLET-AMENDMENT section 4). */
export const TAB_MIN_HEIGHT_PX = 44

/** The DOM id of a pane's tab. */
export const consolePaneTabId = (pane: ConsolePaneId) => `console-pane-tab-${pane}`

/** The DOM id of a pane's tab panel. */
export const consolePanePanelId = (pane: ConsolePaneId) => `console-pane-panel-${pane}`

/** The grid template for a layout: named areas, columns and rows. Pure; exported for tests. */
export function paneGridTemplate(layout: ConsoleTabletLayout): {
  readonly areas: string
  readonly columns: string
  readonly rows: string
} {
  const dock = `${REVIEW_QUEUE_TABLET_WIDTH_PX}px`
  if (layout.main === 'split') {
    return layout.review === 'dock-below'
      ? {
        areas: '"live run" "review review"',
        columns: 'minmax(0, 1fr) minmax(0, 1fr)',
        rows: 'minmax(0, 3fr) minmax(0, 2fr)',
      }
      : {
        areas: '"live run review"',
        columns: `minmax(0, 1fr) minmax(0, 1fr) ${dock}`,
        rows: 'minmax(0, 1fr)',
      }
  }
  switch (layout.review) {
    case 'dock-right':
      return {
        areas: '"tabs review" "main review"',
        columns: `minmax(0, 1fr) ${dock}`,
        rows: 'auto minmax(0, 1fr)',
      }
    case 'dock-below':
      return {
        areas: '"tabs" "main" "review"',
        columns: 'minmax(0, 1fr)',
        rows: 'auto minmax(0, 3fr) minmax(0, 2fr)',
      }
    case 'tab':
      return { areas: '"tabs" "main"', columns: 'minmax(0, 1fr)', rows: 'auto minmax(0, 1fr)' }
  }
}

/** What {@link useConsoleLayout} reports. */
export interface UseConsoleLayoutResult {
  readonly band: ConsoleBand
  /** The tablet layout, or `null` on the desktop band (the console draws its own layout then). */
  readonly layout: ConsoleTabletLayout | null
}

/**
 * The console's current band and layout, live with the viewport (a rotation re-renders).
 * `noSsr` reads the real viewport on the first render (this is a client-only SPA), so a tablet
 * never flashes the desktop layout.
 */
export function useConsoleLayout(): UseConsoleLayoutResult {
  const desktop = useMediaQuery(`(min-width:${SLOT_SPLIT_MIN_WIDTH_PX}px)`, { noSsr: true })
  const wide = useMediaQuery(`(min-width:${TABLET_LANDSCAPE_WIDE_MIN_WIDTH_PX}px)`, { noSsr: true })
  const landscape = useMediaQuery(`(min-width:${TABLET_LANDSCAPE_MIN_WIDTH_PX}px)`, { noSsr: true })
  const tallWidth = useMediaQuery(`(min-width:${TABLET_TALL_PORTRAIT_MIN_WIDTH_PX}px)`, {
    noSsr: true,
  })
  const tallHeight = useMediaQuery(`(min-height:${TABLET_TALL_PORTRAIT_MIN_HEIGHT_PX}px)`, {
    noSsr: true,
  })
  const hasMedia = typeof window !== 'undefined' && typeof window.matchMedia === 'function'

  if (!hasMedia || desktop) return { band: 'desktop', layout: null }
  // Map the queries onto representative sizes so `selectConsoleBand` stays the single rule.
  const band = selectConsoleBand(
    wide ? TABLET_LANDSCAPE_WIDE_MIN_WIDTH_PX : landscape ? TABLET_LANDSCAPE_MIN_WIDTH_PX
      : tallWidth ? TABLET_TALL_PORTRAIT_MIN_WIDTH_PX : 0,
    tallHeight ? TABLET_TALL_PORTRAIT_MIN_HEIGHT_PX : 0,
  )
  if (band === 'desktop') return { band, layout: null }
  return { band, layout: layoutForBand(band) }
}
