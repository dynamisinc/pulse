/**
 * features/controller/console/consoleLayout.test.ts
 * ---------------------------------------------------------------------------
 * Band selection and the layout table (mobile-tablet story 12; D5-021, D5-022). Pure: the band
 * is chosen by WIDTH only (height only separates a tall portrait window), the table holds the
 * signed initial values, the tab list follows the layout, and `useConsoleLayout` answers
 * "desktop" when the environment has no media queries.
 */
import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  CONSOLE_TABLET_LAYOUTS,
  SLOT_SPLIT_MIN_WIDTH_PX,
  layoutForBand,
  paneGridTemplate,
  selectConsoleBand,
  tabbedPanes,
  useConsoleLayout,
} from './consoleLayout'

afterEach(() => vi.unstubAllGlobals())

describe('selectConsoleBand', () => {
  it.each([
    [1920, 1080, 'desktop'],
    [1280, 800, 'desktop'],
    [1279, 800, 'landscapeWide'],
    [1180, 820, 'landscapeWide'],
    [1179, 820, 'landscape'],
    [1024, 768, 'landscape'],
    [1023, 768, 'portrait'],
    [820, 1180, 'portraitTall'],
    [820, 1100, 'portraitTall'],
    [820, 1099, 'portrait'],
    [819, 1180, 'portrait'],
    [768, 1024, 'portrait'],
    [600, 900, 'portrait'],
  ] as const)('%ix%i is %s', (width, height, band) => {
    expect(selectConsoleBand(width, height)).toBe(band)
  })

  it('reuses the console desktop split width', () => {
    expect(SLOT_SPLIT_MIN_WIDTH_PX).toBe(1280)
  })

  it('does not let height move a landscape or desktop width', () => {
    expect(selectConsoleBand(1100, 2000)).toBe('landscape')
    expect(selectConsoleBand(1300, 300)).toBe('desktop')
  })
})

describe('CONSOLE_TABLET_LAYOUTS (the signed initial values)', () => {
  it('1024 to 1179: one switcher plus a docked Review queue', () => {
    expect(CONSOLE_TABLET_LAYOUTS.landscape).toEqual({ main: 'switcher', review: 'dock-right' })
  })
  it('1180 and up: Live world | Run sheet side by side plus a docked Review queue', () => {
    expect(CONSOLE_TABLET_LAYOUTS.landscapeWide).toEqual({ main: 'split', review: 'dock-right' })
  })
  it('tall portrait: the switcher above a docked Review queue', () => {
    expect(CONSOLE_TABLET_LAYOUTS.portraitTall).toEqual({ main: 'switcher', review: 'dock-below' })
  })
  it('other portrait: a full tab switcher with Review as a tab', () => {
    expect(CONSOLE_TABLET_LAYOUTS.portrait).toEqual({ main: 'switcher', review: 'tab' })
  })
})

describe('tabbedPanes', () => {
  const both = { liveWorld: true, runSheet: true }

  it('lists Live world and Run sheet for a switcher, plus Review when it is a tab', () => {
    expect(tabbedPanes(CONSOLE_TABLET_LAYOUTS.landscape, both)).toEqual(['live-world', 'run-sheet'])
    expect(tabbedPanes(CONSOLE_TABLET_LAYOUTS.portrait, both)).toEqual([
      'live-world',
      'run-sheet',
      'review',
    ])
  })

  it('lists no tab for a side-by-side layout with a docked Review queue', () => {
    expect(tabbedPanes(CONSOLE_TABLET_LAYOUTS.landscapeWide, both)).toEqual([])
  })

  it('leaves out a pane whose slot was not supplied', () => {
    expect(
      tabbedPanes(CONSOLE_TABLET_LAYOUTS.portrait, { liveWorld: false, runSheet: true }),
    ).toEqual(['run-sheet', 'review'])
  })

  it('treats a Review tab beside a split as a switcher (the table cannot ask for it)', () => {
    const originalLayout = CONSOLE_TABLET_LAYOUTS.landscapeWide
    try {
      ;(CONSOLE_TABLET_LAYOUTS as { landscapeWide: unknown }).landscapeWide = {
        main: 'split',
        review: 'tab',
      }
      expect(layoutForBand('landscapeWide')).toEqual({ main: 'switcher', review: 'tab' })
    } finally {
      ;(CONSOLE_TABLET_LAYOUTS as { landscapeWide: unknown }).landscapeWide = originalLayout
    }
  })
})

describe('paneGridTemplate', () => {
  it('docks Review at 296px beside the main region', () => {
    expect(paneGridTemplate(CONSOLE_TABLET_LAYOUTS.landscape).columns).toBe('minmax(0, 1fr) 296px')
    expect(paneGridTemplate(CONSOLE_TABLET_LAYOUTS.landscapeWide).columns).toBe(
      'minmax(0, 1fr) minmax(0, 1fr) 296px',
    )
  })

  it('splits a tall portrait window about 60/40', () => {
    expect(paneGridTemplate(CONSOLE_TABLET_LAYOUTS.portraitTall).rows).toBe(
      'auto minmax(0, 3fr) minmax(0, 2fr)',
    )
  })
})

describe('useConsoleLayout', () => {
  it('is the desktop band, with no tablet layout, when the environment has no matchMedia', () => {
    const { result } = renderHook(() => useConsoleLayout())
    expect(result.current).toEqual({ band: 'desktop', layout: null })
  })

  it('follows the viewport and rotation', () => {
    const stub = (width: number, height: number) =>
      vi.stubGlobal('matchMedia', (query: string) => {
        const minWidth = /min-width:\s*(\d+)px/.exec(query)
        const minHeight = /min-height:\s*(\d+)px/.exec(query)
        return {
          matches: minWidth
            ? width >= Number(minWidth[1])
            : minHeight
              ? height >= Number(minHeight[1])
              : false,
          media: query,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
        }
      })
    stub(820, 1180)
    expect(renderHook(() => useConsoleLayout()).result.current.band).toBe('portraitTall')
    stub(1180, 820)
    expect(renderHook(() => useConsoleLayout()).result.current.band).toBe('landscapeWide')
    stub(1024, 768)
    expect(renderHook(() => useConsoleLayout()).result.current.band).toBe('landscape')
    stub(768, 1024)
    expect(renderHook(() => useConsoleLayout()).result.current.band).toBe('portrait')
    stub(1440, 900)
    expect(renderHook(() => useConsoleLayout()).result.current).toEqual({
      band: 'desktop',
      layout: null,
    })
  })
})
