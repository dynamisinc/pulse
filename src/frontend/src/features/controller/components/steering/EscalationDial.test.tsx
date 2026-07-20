/**
 * features/controller/components/steering/EscalationDial.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the storyline escalation dial (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2,
 * NFR-001):
 *
 *  - one track renders the actual intensity as a fill AND a distinct target
 *    tick (absent when unset);
 *  - clicking/dragging the track sets the target and updates the "X -> Y"
 *    relationship text (an ARIA live region);
 *  - the SAME track is keyboard-operable — arrow keys nudge by 1, Home/End
 *    jump to 0/100 — with no loss of the click/drag path;
 *  - the phase label renders as uppercase TEXT alongside the track;
 *  - actual vs. target is distinguishable WITHOUT color alone — separate
 *    icon+text labels ("ACTUAL n" / "TARGET n"), not merely two hues.
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `EngineControlBar.test.tsx`). jsdom does not implement the Pointer Capture
 * API or real layout, so `getBoundingClientRect`/`setPointerCapture` are
 * stubbed per test (documented at each stub) — this is a jsdom limitation,
 * not a production behavior difference.
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { storylineMock } from '../../services/storylineMock'
import { EscalationDial } from './EscalationDial'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  storylineMock.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
})

async function renderDial() {
  render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <EscalationDial />
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
  return screen.findByTestId('escalation-dial')
}

/** jsdom has no real layout — stub a 200px-wide track starting at x=0. */
function stubTrackGeometry(track: HTMLElement): void {
  vi.spyOn(track, 'getBoundingClientRect').mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 200,
    bottom: 28,
    width: 200,
    height: 28,
    toJSON() {
      return this
    },
  } as DOMRect)
}

/** jsdom does not implement the Pointer Capture API at all — stub it out. */
function stubPointerCapture(track: HTMLElement): void {
  track.setPointerCapture = vi.fn()
  track.releasePointerCapture = vi.fn()
  track.hasPointerCapture = vi.fn().mockReturnValue(true)
}

describe('EscalationDial — one track, actual fill + target tick (D5-014/2.2)', () => {
  it('renders the actual fill and NO target tick while unset', async () => {
    await renderDial()

    expect(screen.getByTestId('escalation-dial-actual-fill')).toBeInTheDocument()
    expect(screen.queryByTestId('escalation-dial-target-tick')).not.toBeInTheDocument()
    expect(screen.getByTestId('escalation-dial-actual-label')).toHaveTextContent('ACTUAL 62')
    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET none')
  })

  it('shows the phase label, uppercase, as TEXT (not a color-only indicator)', async () => {
    await renderDial()

    expect(screen.getByTestId('escalation-dial-phase')).toHaveTextContent('ESCALATING')
  })

  it('the relationship text prompts for input before any target has been set', async () => {
    await renderDial()

    const relationship = screen.getByTestId('escalation-dial-relationship')
    expect(relationship).toHaveAttribute('role', 'status')
    expect(relationship).toHaveAttribute('aria-live', 'polite')
    expect(relationship.textContent).toMatch(/arrow keys|click|drag/i)
  })
})

describe('EscalationDial — click/drag sets the target', () => {
  it('a click at a position on the track sets the target to that value and shows "none → X"', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    // clientX 120 of a 200px-wide track starting at 0 => 60%.
    fireEvent.pointerDown(track, { clientX: 120, pointerId: 1 })
    fireEvent.pointerUp(track, { pointerId: 1 })

    expect(screen.getByTestId('escalation-dial-target-tick')).toBeInTheDocument()
    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 60')
    expect(screen.getByTestId('escalation-dial-relationship')).toHaveTextContent('none → 60')
  })

  it('a drag (pointerdown then pointermove) tracks the pointer and updates the target live', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 20, pointerId: 1 }) // 10%
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 }) // 80%
    fireEvent.pointerUp(track, { pointerId: 1 })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 80')
    expect(screen.getByTestId('escalation-dial-relationship')).toHaveTextContent(/→ 80/)
  })

  it('pointer move BEFORE any pointerdown does not set a target (no stray drag)', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 })

    expect(screen.queryByTestId('escalation-dial-target-tick')).not.toBeInTheDocument()
  })

  it('a second click reads the previous target as "from" (e.g. "78 → 60")', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 156, pointerId: 1 }) // 78%
    fireEvent.pointerUp(track, { pointerId: 1 })
    fireEvent.pointerDown(track, { clientX: 120, pointerId: 1 }) // 60%
    fireEvent.pointerUp(track, { pointerId: 1 })

    expect(screen.getByTestId('escalation-dial-relationship')).toHaveTextContent('78 → 60')
  })
})

describe('EscalationDial — keyboard operation (NFR-001)', () => {
  it('ArrowRight nudges the target up by 1 from the current actual when unset', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'ArrowRight' })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 63') // 62 + 1
  })

  it('ArrowLeft nudges the target down by 1', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'ArrowLeft' })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 61') // 62 - 1
  })

  it('End jumps the target to 100', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'End' })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 100')
  })

  it('Home jumps the target to 0', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'Home' })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 0')
  })

  it('keyboard nudges continue to build on a prior click/drag target (no loss of either path)', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 }) // 50%
    fireEvent.pointerUp(track, { pointerId: 1 })
    track.focus()
    fireEvent.keyDown(track, { key: 'ArrowRight' })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 51')
  })

  it('exposes a role="slider" with the aria-value* triad kept current', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    expect(track).toHaveAttribute('role', 'slider')
    expect(track).toHaveAttribute('aria-valuemin', '0')
    expect(track).toHaveAttribute('aria-valuemax', '100')
    expect(track).toHaveAttribute('aria-valuenow', '62') // falls back to actual while unset

    track.focus()
    fireEvent.keyDown(track, { key: 'End' })
    expect(track).toHaveAttribute('aria-valuenow', '100')
  })
})

describe('EscalationDial — actual vs. target distinguishable without color alone (NFR-001)', () => {
  it('the fill and the tick are two DIFFERENT elements (shape-distinct), each independently text-labeled', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 100, pointerId: 1 })
    fireEvent.pointerUp(track, { pointerId: 1 })

    const fill = screen.getByTestId('escalation-dial-actual-fill')
    const tick = screen.getByTestId('escalation-dial-target-tick')
    expect(fill).not.toBe(tick)

    // Text labels exist independent of any color/hue — an a11y tree read (or
    // grayscale render) still distinguishes "ACTUAL n" from "TARGET n".
    expect(screen.getByTestId('escalation-dial-actual-label').textContent).toMatch(/^ACTUAL \d+$/)
    expect(screen.getByTestId('escalation-dial-target-label').textContent).toMatch(/^TARGET \d+$/)
  })
})
