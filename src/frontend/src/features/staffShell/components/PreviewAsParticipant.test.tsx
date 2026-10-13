/**
 * features/staffShell/components/PreviewAsParticipant.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) -- RTL coverage for the STAFF half of the
 * stage, as it stands after demo-polish C6 swapped the `PortalStub` mock for the real
 * channel and Gate-1 amended the story:
 *
 *  - The stage is unmistakably labelled as a preview (AC1/AC3) and stays
 *    inside the staff frame (no navigation -- this component renders nothing
 *    that changes `window.location` or mounts a router).
 *  - NO moment picker is rendered (Gate-1 amendment): the real channel dates its posts from
 *    the live scenario clock, so a picker would change nothing the audience could see. The
 *    participant render is handed the default moment's instant -- the live scenario clock --
 *    and never the wall clock (COR-053).
 *  - Exit calls `usePreview().toggle()` -- proven end-to-end through a small
 *    harness that mirrors the orchestrator's `active ? <PreviewAsParticipant
 *    /> : <WorkArea />` wiring (AC3); this component does not manage its own
 *    `active` state. Exit hands focus back to the control that OPENED the preview -- the header's
 *    toggle -- through `usePreview().returnFocus`, with no selector lookup (S-3 / S-C).
 *  - Exit is keyboard-operable (Tab + Enter) -- no pointer-only interaction (AC5).
 *  - W-3: a render error in the participant half is contained by the stage's own boundary --
 *    "Participant preview unavailable", the strip and Exit keep working, and the error never
 *    reaches an outer boundary (the app's fail-closed one redirects to /login).
 *
 * `PreviewChannelHost` (the participant half) is replaced by a probe that prints
 * the `scenarioNow` it is handed (and can be told to throw), so these cases need no providers
 * and stay about the strip. The REAL channel under the real providers -- the feed, read-only,
 * links that stay inside the preview, the two-worlds checks -- is
 * `PreviewAsParticipant.channel.test.tsx`; the composition it is mounted under is
 * `PreviewChannelHost.test.tsx`; a throwing REAL channel is
 * `PreviewAsParticipant.errorBoundary.test.tsx`.
 */
import { Component, type ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { PreviewProvider, usePreview } from '../previewContext'
import { PreviewAsParticipant } from './PreviewAsParticipant'

/** Set by a case to make the stand-in participant host throw while rendering. */
const host = vi.hoisted(() => ({ shouldThrow: false }))

/** Stands in for the participant half: prints the scenario instant the strip hands it. */
vi.mock('./PreviewChannelHost', () => ({
  PreviewChannelHost: ({ scenarioNow }: { scenarioNow: Date }) => {
    if (host.shouldThrow) throw new Error('boom: a post failed to render')
    return <div data-testid="channel-host" data-scenario-now={scenarioNow.toISOString()} />
  },
}))

/** A fixed scenario "now" (a fixed instant, never a wall-clock read). */
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

beforeEach(() => {
  host.shouldThrow = false
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
})

afterEach(() => {
  resetExerciseClock()
  vi.restoreAllMocks()
})

/**
 * Stands in for the app's `RootFailClosedBoundary`: anything that reaches it would, in
 * production, redirect to /login. A case asserts it was NOT reached.
 */
class OuterBoundary extends Component<{ children: ReactNode }, { hit: boolean }> {
  override state = { hit: false }

  static getDerivedStateFromError() {
    return { hit: true }
  }

  override render() {
    return this.state.hit ? <p data-testid="outer-boundary-hit">REDIRECT TO LOGIN</p> : this.props.children
  }
}

/**
 * Mirrors the orchestrator's Integration-B wiring exactly (see
 * `previewContext.ts`'s module header): a header-style toggle button (whatever opens the
 * preview is where Exit returns focus; it needs no particular test id or markup) plus
 * `active ? <PreviewAsParticipant /> : <WorkArea />`. This is NOT
 * `PreviewAsParticipant`'s own responsibility — it proves the exported seam
 * composes the way the real frame will use it.
 */
function Harness() {
  const { active, toggle } = usePreview()
  return (
    <div>
      <button type="button" data-testid="opener" aria-pressed={active} onClick={toggle}>
        header preview toggle
      </button>
      {active
        ? <PreviewAsParticipant />
        : <div data-testid="work-area">Controller Console work area</div>}
    </div>
  )
}

function renderHarness() {
  return render(
    <OuterBoundary>
      <PreviewProvider>
        <Harness />
      </PreviewProvider>
    </OuterBoundary>,
  )
}

async function openPreview() {
  const user = userEvent.setup()
  renderHarness()
  await user.click(screen.getByRole('button', { name: 'header preview toggle' }))
  return user
}

describe('PreviewAsParticipant — replaces the work area, labelled, within the staff frame (AC1/AC3)', () => {
  it('is not mounted until the header toggle activates preview; activating swaps the work area for the stage', async () => {
    const user = userEvent.setup()
    renderHarness()

    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))

    expect(screen.queryByTestId('work-area')).not.toBeInTheDocument()
    expect(screen.getByTestId('preview-as-participant')).toBeInTheDocument()
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent(/preview as participant/i)
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent(/read-only/i)
  })

  it('exiting (Exit control) calls toggle() and restores the prior work area — never a navigation', async () => {
    const originalLocation = window.location.href
    const user = await openPreview()
    expect(screen.getByTestId('preview-as-participant')).toBeInTheDocument()

    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    // "Exit" never navigates away (AC3) — the URL is untouched.
    expect(window.location.href).toBe(originalLocation)
  })

  it('S-3: Exit returns focus to the control that opened the preview instead of dropping it to <body>', async () => {
    const user = await openPreview()

    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.getByTestId('opener')).toHaveFocus()
  })

  it('S-C: the target is remembered, not looked up: it is the opener whatever its markup', async () => {
    // A different element opens the preview; Exit must go back to IT.
    const user = userEvent.setup()
    function Other() {
      const { active, toggle } = usePreview()
      return (
        <div>
          <button type="button" data-testid="other-opener" onClick={toggle}>open from elsewhere</button>
          <button type="button" data-testid="staff-header-preview-toggle">a decoy with the old test id</button>
          {active ? <PreviewAsParticipant /> : null}
        </div>
      )
    }
    render(<PreviewProvider><Other /></PreviewProvider>)

    await user.click(screen.getByTestId('other-opener'))
    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.getByTestId('other-opener')).toHaveFocus()
    expect(screen.getByTestId('staff-header-preview-toggle')).not.toHaveFocus()
  })

  it('S-3: the same holds from the keyboard (Tab to Exit, Enter)', async () => {
    const user = await openPreview()
    const exitButton = screen.getByTestId('preview-exit')
    let presses = 0
    while (document.activeElement !== exitButton && presses < 10) {
      await user.tab()
      presses += 1
    }
    expect(exitButton).toHaveFocus()

    await user.keyboard('{Enter}')

    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    expect(screen.getByTestId('opener')).toHaveFocus()
  })
})

describe('PreviewAsParticipant — no moment picker (Gate-1 amendment to AC1)', () => {
  it('renders no moment picker, radio group or STARTEX / ADVISORY / BURST / NOW chip', async () => {
    await openPreview()

    expect(screen.queryByRole('radiogroup')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByTestId('preview-moment-picker')).not.toBeInTheDocument()
    for (const chip of ['STARTEX', 'ADVISORY', 'BURST', 'NOW']) {
      expect(screen.queryByText(chip)).not.toBeInTheDocument()
    }
  })

  it('still labels the strip and offers only Exit', async () => {
    await openPreview()
    const strip = screen.getByTestId('preview-bar')

    expect(within(strip).getAllByRole('button').map(button => button.textContent?.trim()))
      .toEqual(['Exit preview'])
    expect(strip).toHaveTextContent('Nothing here reaches the exercise')
  })

  it('hands the participant render the live scenario clock\'s instant (the default moment, NOW)', async () => {
    await openPreview()

    expect(screen.getByTestId('channel-host'))
      .toHaveAttribute('data-scenario-now', SCENARIO_NOW.toISOString())
  })
})

describe('PreviewAsParticipant — the participant render sits below the strip, inside the mat', () => {
  it('mounts the participant host in the frame inside the stage, never inside the label strip', async () => {
    await openPreview()

    const frame = screen.getByTestId('preview-frame')
    expect(screen.getByTestId('preview-stage')).toContainElement(frame)
    expect(frame).toContainElement(screen.getByTestId('channel-host'))
    expect(screen.getByTestId('preview-bar')).not.toContainElement(screen.getByTestId('channel-host'))
  })
})

describe('PreviewAsParticipant — W-3: a render error in the channel is contained', () => {
  it('shows "Participant preview unavailable" and keeps the strip and Exit', async () => {
    host.shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await openPreview()

    const unavailable = screen.getByTestId('preview-unavailable')
    expect(unavailable).toHaveAttribute('role', 'alert')
    expect(unavailable).toHaveTextContent('Participant preview unavailable')
    expect(screen.queryByTestId('channel-host')).not.toBeInTheDocument()
    // The strip is a SIBLING of the boundary, so it survives.
    expect(screen.getByTestId('preview-bar-label')).toHaveTextContent('PREVIEW AS PARTICIPANT')
    expect(screen.getByTestId('preview-exit')).toBeInTheDocument()
  })

  it('never reaches the outer (fail-closed, /login) boundary', async () => {
    host.shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await openPreview()

    expect(screen.queryByTestId('outer-boundary-hit')).not.toBeInTheDocument()
    expect(screen.getByTestId('opener')).toBeInTheDocument()
  })

  it('Exit still works from the failed stage, and a later preview starts clean', async () => {
    host.shouldThrow = true
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const user = await openPreview()

    await user.click(screen.getByTestId('preview-exit'))
    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    expect(screen.getByTestId('opener')).toHaveFocus()

    host.shouldThrow = false
    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))

    expect(screen.queryByTestId('preview-unavailable')).not.toBeInTheDocument()
    expect(screen.getByTestId('channel-host')).toBeInTheDocument()
  })

  it('logs the error\'s message only, never the error object', async () => {
    host.shouldThrow = true
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    await openPreview()

    const ours = logged.mock.calls.find(call => String(call[0]).includes('[preview]'))
    expect(ours).toBeDefined()
    expect(ours?.[1]).toBe('boom: a post failed to render')
  })
})
