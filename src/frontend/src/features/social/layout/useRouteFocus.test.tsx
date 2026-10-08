/**
 * features/social/layout/useRouteFocus.test.tsx
 * ---------------------------------------------------------------------------
 * The route-change focus rule in isolation (demo-polish F1, NFR-001): focus goes
 * to the first VISIBLE `<h1>` in the main region when the pathname changes; falls
 * back to the region itself when the page has no heading yet and hands over to the
 * heading when it appears -- but only while focus is still parked on the region;
 * and ignores the first render, a no-op re-render, and a hop out of a redirect.
 */
import { useRef, useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { useRouteFocus } from './useRouteFocus'

interface BedProps {
  initialPath: string
  /** Heading shown for each path; `undefined` means "no heading yet". */
  headings?: Record<string, string | undefined>
}

function Bed({ initialPath, headings = {} }: BedProps) {
  const [path, setPath] = useState(initialPath)
  const [late, setLate] = useState(false)
  const mainRef = useRef<HTMLElement>(null)
  useRouteFocus(mainRef, path)
  const heading = headings[path] ?? (late ? 'Late heading' : undefined)
  return (
    <div>
      <button type="button" onClick={() => setPath('/explore')}>to explore</button>
      <button type="button" onClick={() => setPath('/loading')}>to loading</button>
      <button type="button" onClick={() => setPath('/home')}>to home</button>
      <button type="button" onClick={() => setLate(true)}>heading arrives</button>
      <button type="button" onClick={() => setPath(p => p)}>rerender</button>
      <main ref={mainRef} data-testid="main">
        <div hidden>
          <h1>Hidden Home heading</h1>
        </div>
        {heading !== undefined && <h1>{heading}</h1>}
        <button type="button">inside main</button>
      </main>
    </div>
  )
}

describe('useRouteFocus', () => {
  it('does nothing on first render', () => {
    render(<Bed initialPath="/home" headings={{ '/home': 'Home' }} />)
    expect(document.body).toHaveFocus()
  })

  it('focuses the first VISIBLE h1 on a pathname change, skipping [hidden] subtrees', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/home" headings={{ '/explore': 'Explore' }} />)
    await user.click(screen.getByRole('button', { name: 'to explore' }))
    const heading = screen.getByRole('heading', { name: 'Explore' })
    expect(heading).toHaveFocus()
    // Focusable programmatically, but not added to the tab order.
    expect(heading).toHaveAttribute('tabindex', '-1')
  })

  it('does not refocus when the pathname did not change', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/home" headings={{ '/explore': 'Explore' }} />)
    await user.click(screen.getByRole('button', { name: 'to explore' }))
    await user.click(screen.getByRole('button', { name: 'inside main' }))
    await user.click(screen.getByRole('button', { name: 'rerender' }))
    expect(screen.getByRole('button', { name: 'rerender' })).toHaveFocus()
  })

  it('ignores a hop out of a redirecting path (unknown -> /home)', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/staff/console" headings={{ '/home': 'Home' }} />)
    await user.click(screen.getByRole('button', { name: 'to home' }))
    expect(screen.getByRole('button', { name: 'to home' })).toHaveFocus()
  })

  it('parks on the main region when the page has no heading yet…', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/home" headings={{ '/home': 'Home' }} />)
    await user.click(screen.getByRole('button', { name: 'to loading' }))
    expect(screen.getByTestId('main')).toHaveFocus()
  })

  it('…then hands focus to the heading the moment it appears', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/home" headings={{ '/home': 'Home' }} />)
    await user.click(screen.getByRole('button', { name: 'to loading' }))
    expect(screen.getByTestId('main')).toHaveFocus()

    // The "arrives" button lives outside main; focusing it models the user (or AT)
    // having moved on, so use a direct state change that does not move focus.
    act(() => {
      screen.getByRole('button', { name: 'heading arrives' }).click()
    })
    expect(await screen.findByRole('heading', { name: 'Late heading' })).toHaveFocus()
  })

  it('does NOT override focus the user has since moved elsewhere', async () => {
    const user = userEvent.setup()
    render(<Bed initialPath="/home" headings={{ '/home': 'Home' }} />)
    await user.click(screen.getByRole('button', { name: 'to loading' }))
    expect(screen.getByTestId('main')).toHaveFocus()

    // Focus moves to a control inside the page before the heading renders.
    screen.getByRole('button', { name: 'inside main' }).focus()
    act(() => {
      screen.getByRole('button', { name: 'heading arrives' }).click()
    })
    await screen.findByRole('heading', { name: 'Late heading' })
    expect(screen.getByRole('button', { name: 'inside main' })).toHaveFocus()
  })
})
