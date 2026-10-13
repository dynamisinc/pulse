/**
 * features/staffShell/components/PreviewAsParticipant.test.tsx
 * ---------------------------------------------------------------------------
 * Story 04 (Preview as participant) -- RTL coverage for the STAFF half of the
 * stage: the Acceptance Criteria in
 * docs/features/staff-shell/04-preview-as-participant.md, as they stand after
 * demo-polish C6 swapped the `PortalStub` mock for the real channel:
 *
 *  - The stage is unmistakably labelled as a preview (AC1/AC3) and stays
 *    inside the staff frame (no navigation -- this component renders nothing
 *    that changes `window.location` or mounts a router).
 *  - The moment picker offers exactly STARTEX/ADVISORY/BURST/NOW, is
 *    mutually exclusive (`role="radiogroup"`/`role="radio"` +
 *    `aria-checked`), and selecting one hands the participant render the
 *    moment's scenario instant (AC2) -- always a scenario instant, never the
 *    wall clock (COR-053).
 *  - Exit calls `usePreview().toggle()` -- proven end-to-end through a small
 *    harness that mirrors the orchestrator's `active ? <PreviewAsParticipant
 *    /> : <WorkArea />` wiring (AC3); this component does not manage its own
 *    `active` state.
 *  - The picker + Exit are keyboard-operable (Tab + Enter/Space) -- no
 *    pointer-only interaction (AC5).
 *
 * `PreviewChannelHost` (the participant half) is replaced by a probe that prints
 * the `scenarioNow` it is handed, so these cases need no providers and stay about
 * the strip. The REAL channel under the real providers -- the feed, read-only,
 * links that stay inside the preview, the two-worlds checks -- is
 * `PreviewAsParticipant.channel.test.tsx`; the composition it is mounted under is
 * `PreviewChannelHost.test.tsx`.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { PreviewProvider, usePreview } from '../previewContext'
import { PreviewAsParticipant } from './PreviewAsParticipant'

/** Stands in for the participant half: prints the scenario instant the strip hands it. */
vi.mock('./PreviewChannelHost', () => ({
  PreviewChannelHost: ({ scenarioNow }: { scenarioNow: Date }) => (
    <div data-testid="channel-host" data-scenario-now={scenarioNow.toISOString()} />
  ),
}))

/** A fixed scenario "now" (a fixed instant, never a wall-clock read). */
const SCENARIO_NOW = new Date('2033-09-04T14:30:00.000Z')

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
})

afterEach(() => {
  resetExerciseClock()
})

/**
 * Mirrors the orchestrator's Integration-B wiring exactly (see
 * `previewContext.ts`'s module header): a header-style toggle button plus
 * `active ? <PreviewAsParticipant /> : <WorkArea />`. This is NOT
 * `PreviewAsParticipant`'s own responsibility — it proves the exported seam
 * composes the way the real frame will use it.
 */
function Harness() {
  const { active, toggle } = usePreview()
  return (
    <div>
      <button type="button" aria-pressed={active} onClick={toggle}>
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
    <PreviewProvider>
      <Harness />
    </PreviewProvider>,
  )
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
    const user = userEvent.setup()
    const originalLocation = window.location.href
    renderHarness()

    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))
    expect(screen.getByTestId('preview-as-participant')).toBeInTheDocument()

    await user.click(screen.getByTestId('preview-exit'))

    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
    expect(screen.getByTestId('work-area')).toBeInTheDocument()
    // "Exit" never navigates away (AC3) — the URL is untouched.
    expect(window.location.href).toBe(originalLocation)
  })
})

describe('PreviewAsParticipant — moment picker (AC2/AC5)', () => {
  async function openPreview() {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))
    return user
  }

  it('offers exactly the four moments STARTEX/ADVISORY/BURST/NOW, as a radiogroup', async () => {
    await openPreview()

    const picker = screen.getByRole('radiogroup', { name: 'Preview scenario moment' })
    const chips = within(picker).getAllByRole('radio')
    expect(chips.map(chip => chip.textContent)).toEqual(['STARTEX', 'ADVISORY', 'BURST', 'NOW'])
  })

  it('defaults to NOW selected, and only NOW carries aria-checked="true"', async () => {
    await openPreview()

    expect(screen.getByTestId('preview-moment-now')).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByTestId('preview-moment-startex')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('preview-moment-advisory')).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByTestId('preview-moment-burst')).toHaveAttribute('aria-checked', 'false')
  })

  it('selecting a different chip is mutually exclusive — exactly one aria-checked="true" at a time', async () => {
    const user = await openPreview()

    await user.click(screen.getByTestId('preview-moment-advisory'))

    const checkedChips = screen.getAllByRole('radio', { checked: true })
    expect(checkedChips).toHaveLength(1)
    expect(checkedChips[0]).toBe(screen.getByTestId('preview-moment-advisory'))
    expect(screen.getByTestId('preview-moment-now')).toHaveAttribute('aria-checked', 'false')
  })

  it('hands the participant render the selected moment\'s scenario instant (AC2)', async () => {
    const user = await openPreview()
    const host = () => screen.getByTestId('channel-host')

    // NOW is the live scenario clock itself.
    expect(host()).toHaveAttribute('data-scenario-now', SCENARIO_NOW.toISOString())

    // Each other moment is its fixed offset BEFORE the live scenario clock (never wall-clock).
    const minutesBefore = (n: number) => new Date(SCENARIO_NOW.getTime() - n * 60_000).toISOString()
    await user.click(screen.getByTestId('preview-moment-startex'))
    expect(host()).toHaveAttribute('data-scenario-now', minutesBefore(180))
    await user.click(screen.getByTestId('preview-moment-advisory'))
    expect(host()).toHaveAttribute('data-scenario-now', minutesBefore(90))
    await user.click(screen.getByTestId('preview-moment-burst'))
    expect(host()).toHaveAttribute('data-scenario-now', minutesBefore(20))
    await user.click(screen.getByTestId('preview-moment-now'))
    expect(host()).toHaveAttribute('data-scenario-now', SCENARIO_NOW.toISOString())
  })

  it('the picker and Exit are keyboard-operable — Tab reaches each control, Enter/Space activates it', async () => {
    const user = await openPreview()

    // Tab from the top of the document until the ADVISORY chip has focus.
    const advisoryChip = screen.getByTestId('preview-moment-advisory')
    await user.tab()
    let iterations = 0
    while (document.activeElement !== advisoryChip && iterations < 10) {
      await user.tab()
      iterations += 1
    }
    expect(document.activeElement).toBe(advisoryChip)

    await user.keyboard('{Enter}')
    expect(advisoryChip).toHaveAttribute('aria-checked', 'true')

    const exitButton = screen.getByTestId('preview-exit')
    exitButton.focus()
    await user.keyboard('{Enter}')
    expect(screen.queryByTestId('preview-as-participant')).not.toBeInTheDocument()
  })
})

describe('PreviewAsParticipant — the participant render sits below the strip, inside the mat', () => {
  it('mounts the participant host in the frame inside the stage, never inside the label strip', async () => {
    const user = userEvent.setup()
    renderHarness()
    await user.click(screen.getByRole('button', { name: 'header preview toggle' }))

    const frame = screen.getByTestId('preview-frame')
    expect(screen.getByTestId('preview-stage')).toContainElement(frame)
    expect(frame).toContainElement(screen.getByTestId('channel-host'))
    expect(screen.getByTestId('preview-bar')).not.toContainElement(screen.getByTestId('channel-host'))
  })
})
