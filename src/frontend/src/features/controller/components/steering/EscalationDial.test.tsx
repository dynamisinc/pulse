/**
 * features/controller/components/steering/EscalationDial.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the storyline escalation dial (feature: world-steering, story 02 —
 * "Escalation dial — actual + target, engine follows"; CTL-022 / D5-014/2.2,
 * NFR-001; story 09 — "Escalation dial live" adds the explanatory-UX and
 * live-mode describe blocks near the bottom):
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
 *  - a drag gesture (pointerdown -> pointermoves -> pointerup) emits exactly
 *    ONE `steering_action` telemetry event (XC-004 hygiene, Gate-1 Minor) —
 *    NOT one per `pointermove`; a discrete click and each keyboard set
 *    likewise emit exactly one event.
 *  - story 09, AC5: the scale legend, the actual-vs-target MEANING legend,
 *    and a phase-meaning tooltip on hover/focus all render as static text
 *    (never color-only, NFR-001).
 *  - story 09, AC4: the "target won't move outside Escalating/Peak" caveat
 *    appears when a target is set on a non-chasing phase, and is absent when
 *    the phase IS Escalating/Peak.
 *
 * Rendered through the REAL `ExerciseContextProvider` (mirrors
 * `EngineControlBar.test.tsx`). jsdom does not implement the Pointer Capture
 * API or real layout, so `getBoundingClientRect`/`setPointerCapture` are
 * stubbed per test (documented at each stub) — this is a jsdom limitation,
 * not a production behavior difference.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { storylineMock } from '../../services/storylineMock'
import * as liveStorylineActions from '../../services/liveStorylineActions'
import { liveStorylineStore } from '../../services/liveStorylineStore'
import { EscalationDial } from './EscalationDial'

/**
 * Toggled per-describe-block. Default `true` (mock mode — matches every
 * pre-existing test above/below). The live-mode block near the bottom flips
 * this to `false` for its own tests only — mirrors
 * `useStorylineTarget.test.ts`'s live-mode block, but boxed via `vi.hoisted`:
 * this file renders through the REAL (unmocked) `ExerciseContextProvider`,
 * whose resolver reads `USE_MOCK_DATA` at MODULE-TOP-LEVEL — i.e. during this
 * file's OWN import evaluation, before a plain `let` below would have run —
 * so the boxed value must be created inside `vi.hoisted` (hoisted to the very
 * top alongside `vi.mock`, same as `useStorylineTarget.test.ts`'s simpler
 * `let` works there only because it mocks `@/core/exerciseContext` directly,
 * never loading the real, eager resolver).
 */
const mockDataState = vi.hoisted(() => ({ useMockData: true }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockDataState.useMockData
  },
}))

vi.mock('../../services/liveStorylineActions', async () => {
  const actual = await vi.importActual<typeof liveStorylineActions>('../../services/liveStorylineActions')
  return {
    PRIMARY_STORYLINE_SENTINEL: actual.PRIMARY_STORYLINE_SENTINEL,
    getStoryline: vi.fn(),
    setStorylineTarget: vi.fn(),
  }
})

const mockedGetStoryline = vi.mocked(liveStorylineActions.getStoryline)
const mockedSetStorylineTarget = vi.mocked(liveStorylineActions.setStorylineTarget)

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:00Z') })
  storylineMock.resetForTests()
  liveStorylineStore.resetForTests()
  resetTelemetryBuffer()
  mockDataState.useMockData = true
  mockedGetStoryline.mockReset()
  mockedSetStorylineTarget.mockReset()
})

afterEach(() => {
  resetExerciseClock()
  liveStorylineStore.resetForTests()
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

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(e => e.eventType === 'steering_action')
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

describe('EscalationDial — telemetry hygiene: one event per gesture (XC-004, Gate-1 Minor)', () => {
  it('a drag (pointerdown -> several pointermoves -> pointerup) emits exactly ONE steering_action event', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 20, pointerId: 1 }) // 10%
    fireEvent.pointerMove(track, { clientX: 60, pointerId: 1 }) // 30%
    fireEvent.pointerMove(track, { clientX: 100, pointerId: 1 }) // 50%
    fireEvent.pointerMove(track, { clientX: 160, pointerId: 1 }) // 80%
    fireEvent.pointerUp(track, { pointerId: 1 })

    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 80')
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toMatchObject({ from: null, to: 80 })
  })

  it('a discrete click (pointerdown -> pointerup, no move) emits exactly ONE steering_action event', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')
    stubTrackGeometry(track)
    stubPointerCapture(track)

    fireEvent.pointerDown(track, { clientX: 120, pointerId: 1 }) // 60%
    fireEvent.pointerUp(track, { pointerId: 1 })

    expect(steeringEvents()).toHaveLength(1)
  })

  it('each keyboard set (Arrow/Home/End) emits exactly ONE steering_action event', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'ArrowRight' })
    expect(steeringEvents()).toHaveLength(1)

    fireEvent.keyDown(track, { key: 'End' })
    expect(steeringEvents()).toHaveLength(2)

    fireEvent.keyDown(track, { key: 'Home' })
    expect(steeringEvents()).toHaveLength(3)
  })

  it('a set that resolves to the SAME value as the current target emits ZERO events (no-op guard)', async () => {
    await renderDial()
    const track = screen.getByTestId('escalation-dial-track')

    track.focus()
    fireEvent.keyDown(track, { key: 'End' }) // 62 -> 100
    expect(steeringEvents()).toHaveLength(1)

    fireEvent.keyDown(track, { key: 'End' }) // already 100 -> no-op
    expect(steeringEvents()).toHaveLength(1)
    expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 100')
  })
})

describe('EscalationDial — explanatory UX (story 09, AC5)', () => {
  it('renders a one-line plain-language scale legend (0-100 meaning)', async () => {
    await renderDial()

    expect(screen.getByTestId('escalation-dial-scale-legend')).toHaveTextContent(
      '0 = quiet · 100 = crisis-level attention',
    )
  })

  it('renders a LABELED actual-vs-target meaning legend — not just relative position on the track', async () => {
    await renderDial()

    const legend = screen.getByTestId('escalation-dial-actual-target-legend')
    expect(legend).toHaveTextContent(/ACTUAL = current real-world attention/i)
    expect(legend).toHaveTextContent(/TARGET = your controller-set goal/i)
  })

  it('exposes a one-line phase-meaning description via an accessible tooltip WITHOUT destroying the phase label\'s accessible name (Gate-1 W-003)', async () => {
    await renderDial()
    const phase = screen.getByTestId('escalation-dial-phase') // seeded phase is Escalating

    // `describeChild` (Gate-1 W-003 fix): the phase's accessible NAME stays
    // its own text ("ESCALATING") — MUI must NOT set `aria-label` to the
    // tooltip text, which would replace the phase name entirely and leave a
    // screen-reader user never hearing the phase itself.
    expect(phase).not.toHaveAttribute('aria-label')
    expect(phase).toHaveTextContent('ESCALATING')
    // No description is wired up before the tooltip actually opens.
    expect(phase).not.toHaveAttribute('aria-describedby')

    fireEvent.mouseOver(phase)
    await waitFor(
      () => {
        expect(screen.getByRole('tooltip')).toHaveTextContent('gaining attention, no qualifying response yet')
      },
      { timeout: 2000 },
    )

    // While open, the description is wired via aria-describedby (never
    // aria-label) — additive to the name, not a replacement of it.
    expect(phase).toHaveAttribute('aria-describedby')
    expect(phase).toHaveTextContent('ESCALATING')
  })

  it('the phase-meaning tooltip trigger is keyboard-reachable (tabIndex, not mouse-only)', async () => {
    await renderDial()
    const phase = screen.getByTestId('escalation-dial-phase')

    expect(phase).toHaveAttribute('tabindex', '0')
  })
})

describe('EscalationDial — the honesty caveat (story 09, AC4; live mode to control phase precisely)', () => {
  beforeEach(() => {
    mockDataState.useMockData = false
  })

  function liveState(overrides: Partial<liveStorylineActions.LiveStorylineSteeringState> = {}) {
    return {
      storylineId: 'storyline-real-guid',
      title: 'Water main contamination fears',
      exerciseId: 'ex-mock-0001',
      intensity: 40,
      targetIntensity: null,
      phase: 'Escalating' as const,
      ...overrides,
    }
  }

  it('states plainly that the target will not move intensity when the phase is OUTSIDE Escalating/Peak (e.g. Seeded)', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ phase: 'Seeded', targetIntensity: 60 }))

    await renderDial()

    const caveat = await screen.findByTestId('escalation-dial-target-caveat')
    expect(caveat).toHaveTextContent(/will not move intensity/i)
    expect(caveat).toHaveTextContent(/ESCALATING or PEAK/i)
    expect(caveat).toHaveTextContent(/SEEDED/i) // states the CURRENT phase, not just the rule
  })

  it('is ABSENT when no target is set, even on a non-chasing phase', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ phase: 'Addressed', targetIntensity: null }))

    await renderDial()
    await screen.findByTestId('escalation-dial-phase')

    expect(screen.queryByTestId('escalation-dial-target-caveat')).not.toBeInTheDocument()
  })

  it('is ABSENT when a target IS set on a CHASING phase (Escalating/Peak) — never a false caveat', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ phase: 'Peak', targetIntensity: 80 }))

    await renderDial()
    await waitFor(() => expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET 80'))

    expect(screen.queryByTestId('escalation-dial-target-caveat')).not.toBeInTheDocument()
  })

  it('never conveys the caveat by color alone — icon + text (NFR-001)', async () => {
    mockedGetStoryline.mockResolvedValue(liveState({ phase: 'Decaying', targetIntensity: 20 }))

    await renderDial()

    const caveat = await screen.findByTestId('escalation-dial-target-caveat')
    expect(caveat.querySelector('svg')).not.toBeNull() // the FontAwesome info icon
    // ...and real text alongside the icon, not color/shape alone.
    expect(caveat.textContent?.length ?? 0).toBeGreaterThan(0)
  })
})

describe('EscalationDial — never fabricate a calm world (Gate-1 CR-002, live mode)', () => {
  beforeEach(() => {
    mockDataState.useMockData = false
  })

  it('shows an explicit "loading" status — NO numeric ACTUAL/DORMANT readout — before the GET resolves', async () => {
    mockedGetStoryline.mockReturnValue(new Promise(() => {})) // never resolves in this test
    await renderDial()

    const status = screen.getByTestId('escalation-dial-unavailable')
    expect(status).toHaveAttribute('data-status', 'loading')
    expect(status).toHaveTextContent(/loading/i)
    expect(screen.queryByTestId('escalation-dial-track')).not.toBeInTheDocument()
    expect(screen.queryByTestId('escalation-dial-actual-label')).not.toBeInTheDocument()
    expect(screen.queryByTestId('escalation-dial-phase')).not.toBeInTheDocument()
  })

  it('shows an explicit "unavailable" status — NEVER ACTUAL 0 / DORMANT presented as fact — when the GET fails', async () => {
    mockedGetStoryline.mockRejectedValue(new Error('404 — registry lost after an App Service restart'))
    await renderDial()

    const status = await screen.findByTestId('escalation-dial-unavailable')
    expect(status).toHaveAttribute('data-status', 'unavailable')
    expect(status).toHaveTextContent(/no live storyline/i)
    expect(screen.queryByTestId('escalation-dial-track')).not.toBeInTheDocument()
    expect(screen.queryByTestId('escalation-dial-actual-label')).not.toBeInTheDocument()
  })

  it('the unavailable/loading status is icon + text, never color alone (NFR-001)', async () => {
    mockedGetStoryline.mockRejectedValue(new Error('down'))
    await renderDial()

    const status = await screen.findByTestId('escalation-dial-unavailable')
    expect(status.querySelector('svg')).not.toBeNull()
    expect(status.textContent?.length ?? 0).toBeGreaterThan(0)
  })

  it('moves from the "loading" status to the live numeric dial once the GET resolves', async () => {
    let resolveGet: (value: liveStorylineActions.LiveStorylineSteeringState) => void = () => {}
    mockedGetStoryline.mockReturnValue(
      new Promise(resolve => {
        resolveGet = resolve
      }),
    )
    await renderDial()
    expect(screen.getByTestId('escalation-dial-unavailable')).toHaveAttribute('data-status', 'loading')

    resolveGet({
      storylineId: 'storyline-real-guid',
      title: 'Water main contamination fears',
      exerciseId: 'ex-mock-0001',
      intensity: 55,
      targetIntensity: null,
      phase: 'Escalating',
    })

    await waitFor(() => expect(screen.getByTestId('escalation-dial-actual-label')).toHaveTextContent('ACTUAL 55'))
    expect(screen.queryByTestId('escalation-dial-unavailable')).not.toBeInTheDocument()
  })
})

describe('EscalationDial — write failures are surfaced, never silent (Gate-1 CR-001, live mode)', () => {
  beforeEach(() => {
    mockDataState.useMockData = false
  })

  function liveState(overrides: Partial<liveStorylineActions.LiveStorylineSteeringState> = {}) {
    return {
      storylineId: 'storyline-real-guid',
      title: 'Water main contamination fears',
      exerciseId: 'ex-mock-0001',
      intensity: 40,
      targetIntensity: null,
      phase: 'Escalating' as const,
      ...overrides,
    }
  }

  it('never claims an unconfirmed change and surfaces an explicit write-error line on a rejected POST', async () => {
    mockedGetStoryline.mockResolvedValueOnce(liveState())
    mockedSetStorylineTarget.mockRejectedValue(new Error('network down'))
    await renderDial()
    await waitFor(() => expect(screen.getByTestId('escalation-dial-actual-label')).toHaveTextContent('ACTUAL 40'))

    // The re-sync GET the rejection triggers returns the untouched truth.
    mockedGetStoryline.mockResolvedValueOnce(liveState())

    const track = screen.getByTestId('escalation-dial-track')
    track.focus()
    fireEvent.keyDown(track, { key: 'End' }) // none -> 100

    // In flight: the relationship line shows the PENDING detail, not a confirmed claim.
    expect(screen.getByTestId('escalation-dial-relationship')).toHaveTextContent('none → 100')

    const errorLine = await screen.findByTestId('escalation-dial-write-error')
    expect(errorLine).toHaveTextContent(/could not confirm the target change/i)
    expect(errorLine.querySelector('svg')).not.toBeNull() // icon + text (NFR-001), never color alone

    // The re-sync corrects the number back to the server's ground truth.
    await waitFor(() => expect(screen.getByTestId('escalation-dial-target-label')).toHaveTextContent('TARGET none'))
  })

  it('Gate-2 W-101: the PENDING relationship line is worded + icon-distinct from a CONFIRMED one, never the bare same string', async () => {
    mockedGetStoryline.mockResolvedValueOnce(liveState())
    let resolvePost: (value: liveStorylineActions.LiveStorylineSteeringState) => void = () => {}
    mockedSetStorylineTarget.mockReturnValue(
      new Promise(resolve => {
        resolvePost = resolve
      }),
    )
    await renderDial()
    await waitFor(() => expect(screen.getByTestId('escalation-dial-actual-label')).toHaveTextContent('ACTUAL 40'))

    const track = screen.getByTestId('escalation-dial-track')
    track.focus()
    fireEvent.keyDown(track, { key: 'End' }) // none -> 100

    const relationship = screen.getByTestId('escalation-dial-relationship')
    expect(relationship).toHaveTextContent(/setting target/i)
    expect(relationship).toHaveTextContent(/not yet confirmed/i)
    expect(relationship.querySelector('svg')).not.toBeNull() // the hourglass icon (NFR-001)

    resolvePost(liveState({ targetIntensity: 100 }))
    await waitFor(() => expect(relationship).not.toHaveTextContent(/not yet confirmed/i))
    // Confirmed: the bare detail, no hourglass, no "not yet confirmed" qualifier.
    expect(relationship).toHaveTextContent('none → 100')
    expect(relationship.querySelector('svg')).toBeNull()
  })
})

describe('EscalationDial — self-healing recovery from "unavailable" (Gate-2 W-105, live mode)', () => {
  beforeEach(() => {
    mockDataState.useMockData = false
  })

  it('replaces the unavailable panel with the real reading once a later poll succeeds', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'setTimeout'] })
    try {
      mockedGetStoryline.mockRejectedValueOnce(new Error('404 — registry lost after a restart'))
      render(
        <ThemeProvider theme={cobraTheme}>
          <ExerciseContextProvider>
            <EscalationDial />
          </ExerciseContextProvider>
        </ThemeProvider>,
      )

      await vi.waitFor(() => expect(screen.getByTestId('escalation-dial-unavailable')).toHaveAttribute(
        'data-status',
        'unavailable',
      ))

      // The controller re-seeds via ops; the NEXT poll tick succeeds.
      mockedGetStoryline.mockResolvedValueOnce({
        storylineId: 'storyline-real-guid',
        title: 'Water main contamination fears',
        exerciseId: 'ex-mock-0001',
        intensity: 33,
        targetIntensity: null,
        phase: 'Escalating',
      })
      await vi.advanceTimersByTimeAsync(5000)

      await vi.waitFor(() => expect(screen.queryByTestId('escalation-dial-unavailable')).not.toBeInTheDocument())
      expect(screen.getByTestId('escalation-dial-actual-label')).toHaveTextContent('ACTUAL 33')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('EscalationDial — names what it is steering (Gate-1 W-008)', () => {
  it('shows the storyline title under mock (always present, seeded)', async () => {
    await renderDial()

    expect(screen.getByTestId('escalation-dial-title')).toHaveTextContent('Water main contamination fears')
  })

  it('shows the LIVE storyline title once the GET resolves', async () => {
    mockDataState.useMockData = false
    mockedGetStoryline.mockResolvedValue({
      storylineId: 'storyline-real-guid',
      title: 'Boil-water advisory rumors',
      exerciseId: 'ex-mock-0001',
      intensity: 30,
      targetIntensity: null,
      phase: 'Escalating',
    })

    await renderDial()

    await waitFor(() =>
      expect(screen.getByTestId('escalation-dial-title')).toHaveTextContent('Boil-water advisory rumors'),
    )
  })
})
