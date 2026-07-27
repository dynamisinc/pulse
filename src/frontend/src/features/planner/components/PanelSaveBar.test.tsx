/**
 * features/planner/components/PanelSaveBar.test.tsx
 * ---------------------------------------------------------------------------
 * Coverage for the pinned save/revert footer of an exercise-configuration panel
 * (#41).
 *
 * WHY THIS IS A SAFETY TEST, NOT A STYLE TEST. Sections 1–3 of the settings page
 * are three views over ONE full-replace form with ONE save. The page's scroll
 * now lives in the content pane, so if this bar were to stop sticking, a planner
 * who has edited theming would have to go hunting for the button that commits
 * identity, channels and theming together — the change that was supposed to make
 * the page safer would have made it more dangerous. `position: sticky` is
 * therefore behavior here, and it is asserted like behavior.
 *
 * jsdom does no layout, so this asserts the DECLARATIONS that produce the
 * behavior (which jsdom resolves faithfully) plus the DOM contract. The
 * behavior itself — the bar staying flush with the bottom of the pane while it
 * scrolls, and no focused field ever landing behind it — was verified by
 * measurement in a real browser; see the story notes.
 */

import { ThemeProvider } from '@mui/material/styles'
import { render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import cobraTheme from '@/theme/cobraTheme'
import { PANEL_SAVE_BAR_SCROLL_PADDING_PX, PanelSaveBar } from './PanelSaveBar'

/**
 * The bar only ever mounts inside COBRA, and COBRA moves `lg` off the MUI
 * default (1024, not 1200). Rendering bare would resolve this component's
 * responsive values against the DEFAULT breakpoints, so a breakpoint assertion
 * would pass against a number the running app never uses.
 */
function renderBar(children: ReactNode) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <PanelSaveBar>{children}</PanelSaveBar>
    </ThemeProvider>,
  )
}

/**
 * Every declaration Emotion emitted for this element, one rule per line, each
 * prefixed with the media condition it applies under (`''` for none). jsdom
 * does no layout and applies no media query, so a responsive value has to be
 * read out of the stylesheet rather than off `getComputedStyle`.
 */
function cssFor(element: HTMLElement): string {
  const emotionClass = [...element.classList].find(name => name.startsWith('css-'))
  if (emotionClass === undefined) return ''
  const rules: string[] = []
  const collect = (list: CSSRuleList, condition: string) => {
    for (const rule of list) {
      if (rule instanceof CSSMediaRule) collect(rule.cssRules, `@media ${rule.conditionText}`)
      else if (rule.cssText.includes(`.${emotionClass}`)) rules.push(`${condition} ${rule.cssText}`)
    }
  }
  for (const sheet of document.styleSheets) collect(sheet.cssRules, '')
  return rules.join('\n').replace(/:\s+/g, ':').replace(/\s+/g, ' ')
}

/** Read from the COBRA theme: COBRA moves `lg` off the MUI default (1024, not 1200). */
const DESKTOP = `@media \\(min-width:${cobraTheme.breakpoints.values.lg}px\\)`

describe('PanelSaveBar — the commit point cannot scroll out of reach', () => {
  it('sticks to the bottom of the pane ONLY where the pane is the scrollport', () => {
    renderBar(<button type="submit">Save settings</button>)

    const bar = screen.getByTestId('panel-save-bar')
    const css = cssFor(bar)

    // At `lg`+ the content pane scrolls, its `scroll-padding-bottom` reserves
    // room for this bar, and sticking is what keeps the commit point reachable.
    expect(css).toMatch(new RegExp(`${DESKTOP}[^\\n]*position:sticky`))
    expect(getComputedStyle(bar).bottom).toBe('0px')

    // Below `lg` the page is in flow and the real scrolling ancestor is the
    // STAFF SHELL work area, not the pane. Sticking there would pin the bar
    // against a scrollport that reserves no room for it, scrolling a focused
    // field underneath the buttons — the precise hazard this bar exists to
    // prevent (Copilot review, PR #383). jsdom applies no media query, so the
    // base declaration is what `getComputedStyle` reports.
    expect(getComputedStyle(bar).position).toBe('static')
  })

  it('is opaque, so scrolled fields pass behind it instead of through it', () => {
    renderBar(<button type="submit">Save settings</button>)

    const style = getComputedStyle(screen.getByTestId('panel-save-bar'))
    // A transparent sticky bar is worse than no sticky bar: the buttons and the
    // form text underneath them render on top of each other.
    expect(style.backgroundColor).not.toBe('')
    expect(style.backgroundColor).not.toBe('transparent')
    expect(style.backgroundColor).not.toBe('rgba(0, 0, 0, 0)')
    // ...and it must paint above the fields it overlays.
    expect(Number(style.zIndex)).toBeGreaterThan(0)
  })

  it('renders the buttons and their messages as its own children, in order', () => {
    renderBar(
      <>
        <button type="submit">Save settings</button>
        <p role="alert">Nothing has been sent to the server.</p>
      </>,
    )

    const bar = screen.getByTestId('panel-save-bar')
    // The outcome message rides WITH the buttons: an alert saying nothing was
    // sent is useless scrolled off below the button that refused to send.
    expect(bar).toContainElement(screen.getByRole('button', { name: 'Save settings' }))
    expect(bar).toContainElement(screen.getByRole('alert'))
  })

  it('publishes the room it needs, so the scrolling pane can keep it clear of focus', () => {
    // The pane sets `scroll-padding-bottom` from this constant. Exporting it is
    // what stops the height that HIDES a focused field and the height that is
    // KEPT CLEAR from drifting apart (NFR-001).
    expect(PANEL_SAVE_BAR_SCROLL_PADDING_PX).toBeGreaterThan(0)
  })
})
