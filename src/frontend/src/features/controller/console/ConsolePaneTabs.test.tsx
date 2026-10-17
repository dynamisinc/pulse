/**
 * features/controller/console/ConsolePaneTabs.test.tsx
 * ---------------------------------------------------------------------------
 * The pane switcher (mobile-tablet story 12; NFR-001): ARIA tabs pattern (roving tabindex,
 * arrows, Home and End, `aria-selected`), 44px tabs, the active tab marked by bold text and an
 * underline (not colour alone), and a TEXT badge on every tab.
 */
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { ConsolePaneTabs, type ConsolePaneTab } from './ConsolePaneTabs'
import { TAB_MIN_HEIGHT_PX, type ConsolePaneId } from './consoleLayout'

const TABS: ConsolePaneTab[] = [
  { id: 'live-world', label: 'Live world', badge: '12 new' },
  { id: 'run-sheet', label: 'Run sheet', badge: '3 due' },
  { id: 'review', label: 'Review', badge: '5 · 1 under 60s', attention: true },
]

function Harness() {
  const [active, setActive] = useState<ConsolePaneId>('live-world')
  return <ConsolePaneTabs tabs={TABS} activeId={active} onChange={setActive} />
}

const tab = (name: RegExp) => screen.getByRole('tab', { name })

describe('ConsolePaneTabs', () => {
  it('is a tablist whose tabs carry a text badge each', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Console panes' })).toBeInTheDocument()
    expect(tab(/Live world/)).toHaveTextContent('12 new')
    expect(tab(/Run sheet/)).toHaveTextContent('3 due')
    expect(tab(/Review/)).toHaveTextContent('5 · 1 under 60s')
  })

  it('marks the active tab with aria-selected, bold text and an underline', () => {
    render(<Harness />)
    expect(tab(/Live world/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Run sheet/)).toHaveAttribute('aria-selected', 'false')
    expect(getComputedStyle(tab(/Live world/)).fontWeight).toBe('800')
    expect(getComputedStyle(tab(/Live world/)).textDecorationLine).toBe('underline')
    expect(getComputedStyle(tab(/Run sheet/)).fontWeight).toBe('500')
    expect(getComputedStyle(tab(/Run sheet/)).textDecorationLine).toBe('none')
  })

  it('gives every tab at least 44px of height', () => {
    render(<Harness />)
    for (const element of screen.getAllByRole('tab')) {
      expect(getComputedStyle(element).minHeight).toBe(`${TAB_MIN_HEIGHT_PX}px`)
    }
    expect(TAB_MIN_HEIGHT_PX).toBeGreaterThanOrEqual(44)
  })

  it('shows an icon beside a badge that needs attention, as well as its text', () => {
    render(<Harness />)
    expect(screen.getByTestId('console-pane-badge-review').querySelector('svg')).not.toBeNull()
    expect(screen.getByTestId('console-pane-badge-run-sheet').querySelector('svg')).toBeNull()
  })

  it('has one tab stop (roving tabindex)', () => {
    render(<Harness />)
    expect(tab(/Live world/)).toHaveAttribute('tabindex', '0')
    expect(tab(/Run sheet/)).toHaveAttribute('tabindex', '-1')
    expect(tab(/Review/)).toHaveAttribute('tabindex', '-1')
  })

  it('moves with the arrow keys (wrapping), Home and End, selection following focus', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tab(/Live world/).focus()

    await user.keyboard('{ArrowRight}')
    expect(tab(/Run sheet/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Run sheet/)).toHaveFocus()

    await user.keyboard('{End}')
    expect(tab(/Review/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Review/)).toHaveFocus()

    await user.keyboard('{ArrowRight}')
    expect(tab(/Live world/)).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(tab(/Review/)).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{Home}')
    expect(tab(/Live world/)).toHaveAttribute('aria-selected', 'true')
    expect(tab(/Live world/)).toHaveFocus()
  })

  it('selects a tab on click', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(tab(/Run sheet/))
    expect(tab(/Run sheet/)).toHaveAttribute('aria-selected', 'true')
  })
})
