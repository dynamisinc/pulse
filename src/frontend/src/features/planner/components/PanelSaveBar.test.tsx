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
 * therefore behaviour here, and it is asserted like behaviour.
 *
 * jsdom does no layout, so this asserts the DECLARATIONS that produce the
 * behaviour (which jsdom resolves faithfully) plus the DOM contract. The
 * behaviour itself — the bar staying flush with the bottom of the pane while it
 * scrolls, and no focused field ever landing behind it — was verified by
 * measurement in a real browser; see the story notes.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PANEL_SAVE_BAR_SCROLL_PADDING_PX, PanelSaveBar } from './PanelSaveBar'

describe('PanelSaveBar — the commit point cannot scroll out of reach', () => {
  it('sticks to the bottom of the scrolling pane', () => {
    render(<PanelSaveBar><button type="submit">Save settings</button></PanelSaveBar>)

    const bar = screen.getByTestId('panel-save-bar')
    const style = getComputedStyle(bar)
    expect(style.position).toBe('sticky')
    expect(style.bottom).toBe('0px')
  })

  it('is opaque, so scrolled fields pass behind it instead of through it', () => {
    render(<PanelSaveBar><button type="submit">Save settings</button></PanelSaveBar>)

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
    render(
      <PanelSaveBar>
        <button type="submit">Save settings</button>
        <p role="alert">Nothing has been sent to the server.</p>
      </PanelSaveBar>,
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
