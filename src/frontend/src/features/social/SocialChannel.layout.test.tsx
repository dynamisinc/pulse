/**
 * features/social/SocialChannel.layout.test.tsx
 * ---------------------------------------------------------------------------
 * The frame's MEASUREMENTS (demo-polish F1, "Three-column frame" AC). jsdom does no
 * layout and ignores media queries, so the 240 | 600 | 344 grid, the breakpoints
 * and the sticky offsets cannot be asserted from computed styles. They live in CSS
 * Modules, so this suite reads the REAL stylesheet text (`?raw`, the same technique
 * `twoWorldsSeparation.test.ts` uses for source) and asserts:
 *
 *  - the grid tracks at each of the three breakpoint states, and that they agree
 *    with the constants in `layout/frameMetrics.ts`;
 *  - the right rail hides first (`display: none`, so it also leaves the a11y tree),
 *    then the nav rail collapses to an icon rail;
 *  - the frame is LEFT-anchored and cannot overflow horizontally (a `0` min track,
 *    `overflow-x: clip`, no auto-margin centering);
 *  - every sticky / fixed thing that could meet the EXERCISE banners subtracts
 *    `--pulse-chrome-top` / `--pulse-chrome-bottom`;
 *  - the new modules are light-only and read the token palette (F5 owns the sweep).
 *
 * A guard proves the block extractor actually finds the media blocks it is asked
 * about, so a renamed query fails loudly instead of letting every assertion pass
 * against an empty string.
 *
 * WHY THE FILESYSTEM. Vitest stubs CSS: with `css.include` empty (our config) both
 * `foo.module.css?raw` and `?inline` resolve to a stub object / empty string, never
 * the text. So, unlike the `.ts`/`.tsx` source scans, the stylesheets are read with
 * Node's `fs`. The app tsconfig deliberately omits Node's ambient types, so the
 * module is loaded through a variable specifier and given the one-method shape this
 * file needs -- no `any`, and no Node type leaks into app code (this file is test-only).
 */
import { beforeAll, describe, expect, it } from 'vitest'
import {
  FRAME_MIN_WIDTH,
  MAIN_COLUMN_WIDTH,
  NAV_EXPANDED_MIN_WIDTH,
  NAV_RAIL_COLLAPSED_WIDTH,
  NAV_RAIL_WIDTH,
  RIGHT_RAIL_WIDTH,
} from './layout/frameMetrics'

interface FsLike {
  readFileSync(path: URL, encoding: 'utf8'): string
}

/** Stylesheet name -> path relative to this file. */
const STYLESHEETS = {
  channel: './SocialChannel.module.css',
  navRail: './layout/NavRail.module.css',
  rightRail: './layout/RightRail.module.css',
  compose: './layout/ComposeModal.module.css',
  detail: './layout/DetailHeader.module.css',
  account: './layout/AccountCard.module.css',
  home: './layout/routes/HomeView.module.css',
  routes: './layout/routes/routes.module.css',
} as const

type StylesheetName = keyof typeof STYLESHEETS

/** Filled by `beforeAll` (Node's `fs` is loaded asynchronously, see the header). */
const css = {} as Record<StylesheetName, string>

beforeAll(async () => {
  const specifier = 'node:fs'
  const fs = (await import(/* @vite-ignore */ specifier)) as FsLike
  for (const name of Object.keys(STYLESHEETS) as StylesheetName[]) {
    css[name] = fs.readFileSync(new URL(STYLESHEETS[name], import.meta.url), 'utf8')
  }
})

/** The body of the first `@media (<query>) { ... }` block, brace-matched. */
function mediaBlock(css: string, query: string): string {
  const start = css.indexOf(`@media (${query})`)
  if (start < 0) return ''
  const open = css.indexOf('{', start)
  let depth = 0
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1
    if (css[i] === '}') {
      depth -= 1
      if (depth === 0) return css.slice(open + 1, i)
    }
  }
  return ''
}

/** Everything outside every `@media` block. */
function baseRules(css: string): string {
  let out = css
  for (;;) {
    const at = out.indexOf('@media')
    if (at < 0) return out
    const open = out.indexOf('{', at)
    let depth = 0
    let end = open
    for (let i = open; i < out.length; i += 1) {
      if (out[i] === '{') depth += 1
      if (out[i] === '}') {
        depth -= 1
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    out = out.slice(0, at) + out.slice(end + 1)
  }
}

const squash = (css: string) => css.replace(/\s+/g, ' ')

describe('frame metrics', () => {
  it('are the D1-013 numbers: 240 | 600 | 344, full frame at 1184', () => {
    expect(NAV_RAIL_WIDTH).toBe(240)
    expect(MAIN_COLUMN_WIDTH).toBe(600)
    expect(RIGHT_RAIL_WIDTH).toBe(344)
    expect(FRAME_MIN_WIDTH).toBe(1184)
    expect(NAV_EXPANDED_MIN_WIDTH).toBe(840)
  })

  it('the 1184 / 840 thresholds are the sums of the column widths', () => {
    expect(NAV_RAIL_WIDTH + MAIN_COLUMN_WIDTH + RIGHT_RAIL_WIDTH).toBe(FRAME_MIN_WIDTH)
    expect(NAV_RAIL_WIDTH + MAIN_COLUMN_WIDTH).toBe(NAV_EXPANDED_MIN_WIDTH)
  })

  it('the block extractor finds the media blocks it is asked about (non-vacuity)', () => {
    expect(css.channel.length).toBeGreaterThan(500)
    expect(mediaBlock(css.channel, `min-width: ${NAV_EXPANDED_MIN_WIDTH}px`)).not.toBe('')
    expect(mediaBlock(css.channel, `min-width: ${FRAME_MIN_WIDTH}px`)).not.toBe('')
    expect(mediaBlock(css.channel, 'min-width: 1px')).toBe('')
  })
})

describe('three-column grid (SocialChannel.module.css)', () => {
  const main = `minmax(0, ${MAIN_COLUMN_WIDTH}px)`

  it('base: icon rail + main', () => {
    const base = squash(baseRules(css.channel))
    expect(base).toContain(`grid-template-columns: ${NAV_RAIL_COLLAPSED_WIDTH}px ${main}`)
  })

  it('>= 840px: full nav rail + main', () => {
    const block = squash(mediaBlock(css.channel, `min-width: ${NAV_EXPANDED_MIN_WIDTH}px`))
    expect(block).toContain(`grid-template-columns: ${NAV_RAIL_WIDTH}px ${main}`)
  })

  it('>= 1184px: nav rail + main + sidebar', () => {
    const block = squash(mediaBlock(css.channel, `min-width: ${FRAME_MIN_WIDTH}px`))
    expect(block).toContain(
      `grid-template-columns: ${NAV_RAIL_WIDTH}px ${main} ${RIGHT_RAIL_WIDTH}px`,
    )
  })

  it('is left-anchored (D1-013): start-justified, never auto-margin centered', () => {
    const text = squash(css.channel)
    expect(text).toContain('justify-content: start')
    expect(text).not.toMatch(/margin:[^;]*auto/)
  })

  it('cannot scroll horizontally: a zero min track and overflow-x: clip', () => {
    const text = squash(css.channel)
    expect(text).toContain('minmax(0, 600px)')
    expect(text).toContain('overflow-x: clip')
    // `hidden` would turn the column into a scroll container and break the sticky headers.
    expect(text).not.toContain('overflow-x: hidden')
  })
})

describe('breakpoint order: the right rail hides first, then the nav rail collapses', () => {
  it('right rail is display:none by default and appears at 1184px', () => {
    expect(squash(baseRules(css.rightRail))).toContain('display: none')
    const wide = squash(mediaBlock(css.rightRail, `min-width: ${FRAME_MIN_WIDTH}px`))
    expect(wide).toContain('display: flex')
    expect(wide).toContain(`width: ${RIGHT_RAIL_WIDTH}px`)
  })

  it('nav rail is the 68px icon rail by default and 240px from 840px', () => {
    expect(squash(baseRules(css.navRail))).toContain(`width: ${NAV_RAIL_COLLAPSED_WIDTH}px`)
    const wide = squash(mediaBlock(css.navRail, `min-width: ${NAV_EXPANDED_MIN_WIDTH}px`))
    expect(wide).toContain(`width: ${NAV_RAIL_WIDTH}px`)
  })

  it('labels stay in the DOM (visually hidden, not display:none) in the icon rail', () => {
    const base = squash(baseRules(css.navRail))
    expect(base).toMatch(/\.label \{[^}]*clip-path: inset\(50%\)/)
    expect(base).not.toMatch(/\.label \{[^}]*display: none/)
  })
})

describe('sticky / fixed offsets honour the shell chrome insets', () => {
  const top = 'var(--pulse-chrome-top, 0px)'
  const bottom = 'var(--pulse-chrome-bottom, 0px)'

  it('nav rail: sticky below the top banner, height clear of both', () => {
    const text = squash(baseRules(css.navRail))
    expect(text).toContain('position: sticky')
    expect(text).toContain(`top: ${top}`)
    expect(text).toContain(`calc(100dvh - ${top} - ${bottom})`)
  })

  it('right rail: sticky below the top banner, height clear of both', () => {
    const text = squash(mediaBlock(css.rightRail, `min-width: ${FRAME_MIN_WIDTH}px`))
    expect(text).toContain('position: sticky')
    expect(text).toContain(`top: ${top}`)
    expect(text).toContain(`calc(100dvh - ${top} - ${bottom})`)
  })

  it('detail header sticks below the top banner', () => {
    expect(squash(css.detail)).toContain(`top: ${top}`)
  })

  it('compose backdrop is fixed BETWEEN the two banners', () => {
    const text = squash(css.compose)
    expect(text).toContain('position: fixed')
    expect(text).toContain(`top: ${top}`)
    expect(text).toContain(`bottom: ${bottom}`)
  })

  it('the skip link surfaces below the top banner, not behind it', () => {
    expect(squash(css.channel)).toMatch(
      /\.skipLink \{[^}]*top: calc\(var\(--pulse-chrome-top, 0px\) \+ 8px\)/,
    )
  })
})

describe('participant tokens, light only', () => {
  it.each(Object.keys(STYLESHEETS) as StylesheetName[])(
    '%s adds no dark-mode trigger of its own',
    name => {
      expect(css[name]).not.toMatch(/prefers-color-scheme/)
      expect(css[name]).not.toMatch(/data-theme/)
    },
  )

  it('the channel root composes the shared token class', () => {
    expect(css.channel).toMatch(/composes:\s*tokens from '\.\/theme\/social\.module\.css'/)
  })

  it('rails, modal and headers read the token palette and never hard-code the accent', () => {
    for (const name of ['navRail', 'rightRail', 'compose', 'detail', 'home'] as const) {
      expect(css[name]).toContain('var(--pc-')
      expect(css[name]).not.toMatch(/#1e3a5f/i)
    }
    expect(css.navRail).toContain('var(--pc-accent)')
  })
})
