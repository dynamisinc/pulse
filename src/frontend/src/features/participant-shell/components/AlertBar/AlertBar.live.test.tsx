/**
 * features/participant-shell/components/AlertBar/AlertBar.live.test.tsx
 * ---------------------------------------------------------------------------
 * Channels-foundation story 11 (#707): the REAL `<AlertBar>` over the REAL
 * `useAlerts()` on its live path (`USE_MOCK_DATA` off, `api` mocked at the
 * boundary, the shared `realtimeConnection` replaced by a fake the test
 * drives). Covers the multi-alert AC (D4-010 #7, weather FU-5) with two and
 * five alerts, the push → emergency band, the announcements AC, and the
 * "Details →" rule.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '@/core/services/api'
import { alertPauseBridge } from '../../alertPauseBridge'
import { AlertBar } from './AlertBar'
import { alertsQueryKey } from './alertsSource'
import {
  makeQueryClient,
  makeWrapper,
  ok,
  wireAlert,
  type FakeConnection,
} from './liveAlertsTestUtils'

const fake = vi.hoisted(() => ({ connection: null as FakeConnection | null }))

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))
vi.mock('@/core/services/api', () => ({ api: { get: vi.fn() } }))
vi.mock('@/core/auth/tokenStore', () => ({ getAccessToken: () => 'token' }))
vi.mock('@/core/realtime/connection', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/realtime/connection')>()
  const { createFakeConnection: create } = await import('./liveAlertsTestUtils')
  fake.connection = create()
  return { ...actual, realtimeConnection: fake.connection }
})
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-live-alert-bar-0001',
    exerciseName: 'Live Alert Bar Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockGet = vi.mocked(api.get)
const KEY = alertsQueryKey('ex-live-alert-bar-0001')
let client = makeQueryClient()

function connection(): FakeConnection {
  if (fake.connection === null) throw new Error('fake connection not created')
  return fake.connection
}

function stubReducedMotion(reduce: boolean): void {
  vi.stubGlobal('matchMedia', vi.fn(() => ({
    matches: reduce,
    addEventListener: () => {},
    removeEventListener: () => {},
  })))
}

/** Renders the bar over the live hook with `initial` as the GET's active set. */
async function renderLiveBar(initial: readonly ReturnType<typeof wireAlert>[]) {
  mockGet.mockResolvedValue(ok({ alerts: initial }))
  client = makeQueryClient()
  const view = render(<AlertBar />, { wrapper: makeWrapper(client) })
  if (initial.length > 0) {
    await waitFor(() => expect(screen.getByTestId('pulse-alert-bar')).not.toHaveAttribute('data-alert-treatment', 'none'))
  } else {
    await waitFor(() => expect(mockGet).toHaveBeenCalled())
  }
  return view
}

async function push(alerts: readonly ReturnType<typeof wireAlert>[]): Promise<void> {
  act(() => connection().emit('AlertsChanged', { alerts }))
  // The frame is applied after the in-flight read is cancelled: wait for the cache to hold it.
  await waitFor(() => expect(client.getQueryData(KEY)).toEqual(alerts))
}

/** Fakes only the rotation interval: React Query's own timers stay real. */
function fakeIntervals(): void {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] })
}

function shownMessage(): string {
  return screen.getByTestId('pulse-alert-bar-message').textContent ?? ''
}

function live(): HTMLElement {
  return screen.getByRole('status')
}

beforeEach(() => {
  mockGet.mockReset()
  connection().reset()
  stubReducedMotion(false)
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  alertPauseBridge.reset()
})

// A warning (emergency) and a watch (advisory), as the weather channel raises them.
const WARNING = wireAlert({
  id: 'warning',
  severity: 'emergency',
  message: 'Tornado Warning for the northern county until 3:15 PM',
  scenarioTime: '2026-12-02T14:20:00Z',
  href: '/weather/nws-metro/tornado-warning-0412',
  sourceChannel: 'weather',
})
const WATCH = wireAlert({
  id: 'watch',
  severity: 'advisory',
  message: 'Tornado Watch for the metro area until 6 PM',
  scenarioTime: '2026-12-02T13:00:00Z',
  href: '/weather/nws-metro/tornado-watch-0411',
  sourceChannel: 'weather',
})

describe('AlertBar (live) — two active alerts: a warning forces the band, the watch stays listed', () => {
  it('shows the warning in the emergency band and lists the watch under "+1 more"', async () => {
    await renderLiveBar([WATCH, WARNING])

    const host = screen.getByTestId('pulse-alert-bar')
    expect(host).toHaveAttribute('data-alert-treatment', 'band')
    expect(host).toHaveAttribute('data-alert-severity', 'emergency')
    // Verbatim (WX-011).
    expect(shownMessage()).toBe(WARNING.message)
    // Severity = icon + text (+ color), never color alone.
    const chip = within(host).getAllByTestId('pulse-alert-bar-chip')[0]
    expect(chip).toHaveTextContent('EMERGENCY')
    expect(chip?.querySelector('svg')).not.toBeNull()

    fireEvent.click(screen.getByTestId('pulse-alert-bar-more-chip'))
    const stack = screen.getAllByTestId('pulse-alert-bar-stack-item')
    expect(stack).toHaveLength(1)
    expect(stack[0]).toHaveTextContent('ADVISORY')
    expect(stack[0]).toHaveTextContent(WATCH.message)
  })

  it('never collapses the emergency band on scroll', async () => {
    await renderLiveBar([WATCH, WARNING])
    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true })
    fireEvent.scroll(window)
    expect(screen.queryByTestId('pulse-alert-bar-expand')).toBeNull()
    expect(screen.getByTestId('pulse-alert-bar-timestamp')).toBeInTheDocument()
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('escalates to the full band the moment a pushed warning arrives', async () => {
    await renderLiveBar([WATCH])
    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('data-alert-treatment', 'ticker')

    await push([WATCH, WARNING])

    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('data-alert-treatment', 'band')
    expect(shownMessage()).toBe(WARNING.message)
  })
})

describe('AlertBar (live) — five active alerts rotate in severity-then-recency order', () => {
  const FIVE = [
    wireAlert({ id: 'i-old', severity: 'info', message: 'Info old.', scenarioTime: '2026-12-02T10:00:00Z' }),
    wireAlert({ id: 'a-old', severity: 'advisory', message: 'Advisory old.', scenarioTime: '2026-12-02T11:00:00Z' }),
    wireAlert({ id: 'i-new', severity: 'info', message: 'Info new.', scenarioTime: '2026-12-02T14:00:00Z' }),
    wireAlert({ id: 'a-new', severity: 'advisory', message: 'Advisory new.', scenarioTime: '2026-12-02T13:00:00Z' }),
    wireAlert({ id: 'i-mid', severity: 'info', message: 'Info mid.', scenarioTime: '2026-12-02T12:00:00Z' }),
  ]
  const ORDER = ['Advisory new.', 'Advisory old.', 'Info new.', 'Info mid.', 'Info old.']

  it('visits every alert once per cycle, most severe then newest first', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)

    const seen = [shownMessage()]
    for (let step = 1; step < ORDER.length + 1; step += 1) {
      act(() => { vi.advanceTimersByTime(3500) })
      seen.push(shownMessage())
    }
    expect(seen).toEqual([...ORDER, ORDER[0]])
  })

  it('pauses rotation while hovered or while focus is inside, and resumes after', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)
    const host = screen.getByTestId('pulse-alert-bar')

    fireEvent.pointerEnter(host, { pointerType: 'mouse' })
    expect(host).toHaveAttribute('data-rotation-paused', 'true')
    act(() => { vi.advanceTimersByTime(20000) })
    expect(shownMessage()).toBe(ORDER[0])
    fireEvent.pointerLeave(host, { pointerType: 'mouse' })
    act(() => { vi.advanceTimersByTime(3500) })
    expect(shownMessage()).toBe(ORDER[1])

    act(() => { screen.getByTestId('pulse-alert-bar-details').focus() })
    expect(host).toHaveAttribute('data-rotation-paused', 'true')
    act(() => { vi.advanceTimersByTime(20000) })
    expect(shownMessage()).toBe(ORDER[1])
    act(() => { screen.getByTestId('pulse-alert-bar-details').blur() })
    act(() => { vi.advanceTimersByTime(3500) })
    expect(shownMessage()).toBe(ORDER[2])
  })

  it('does not pause on a touch "hover" (a tap has no reliable leave)', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)
    fireEvent.pointerEnter(screen.getByTestId('pulse-alert-bar'), { pointerType: 'touch' })
    act(() => { vi.advanceTimersByTime(3500) })
    expect(shownMessage()).toBe(ORDER[1])
  })

  it('resumes when the focused control unmounts without a blur (the alerts cleared)', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)
    const host = screen.getByTestId('pulse-alert-bar')
    act(() => { screen.getByTestId('pulse-alert-bar-details').focus() })
    expect(host).toHaveAttribute('data-rotation-paused', 'true')

    // Every alert clears: the focused link unmounts (no blur reaches the bar), and
    // when alerts return the ticker must rotate again rather than stay paused.
    await push([])
    await push(FIVE)
    expect(document.activeElement).toBe(document.body)
    expect(host).not.toHaveAttribute('data-rotation-paused')
    act(() => { vi.advanceTimersByTime(3500) })
    expect(shownMessage()).toBe(ORDER[1])
  })

  it('resumes when a scroll collapse unmounts the focused Details link (no blur)', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)
    const host = screen.getByTestId('pulse-alert-bar')
    act(() => { screen.getByTestId('pulse-alert-bar-details').focus() })
    expect(host).toHaveAttribute('data-rotation-paused', 'true')

    Object.defineProperty(window, 'scrollY', { value: 400, configurable: true })
    fireEvent.scroll(window)

    expect(screen.queryByTestId('pulse-alert-bar-details')).toBeNull()
    expect(host).not.toHaveAttribute('data-rotation-paused')
    Object.defineProperty(window, 'scrollY', { value: 0, configurable: true })
  })

  it('holds on the first alert under prefers-reduced-motion', async () => {
    stubReducedMotion(true)
    fakeIntervals()
    await renderLiveBar(FIVE)

    act(() => { vi.advanceTimersByTime(20000) })
    expect(shownMessage()).toBe(ORDER[0])
  })

  it('every rotated alert carries its severity as icon + text', async () => {
    fakeIntervals()
    await renderLiveBar(FIVE)
    for (const expected of ['ADVISORY', 'ADVISORY', 'INFO', 'INFO', 'INFO']) {
      const chip = screen.getByTestId('pulse-alert-bar-chip')
      expect(chip).toHaveTextContent(expected)
      expect(chip.querySelector('svg')).not.toBeNull()
      act(() => { vi.advanceTimersByTime(3500) })
    }
  })
})

describe('AlertBar (live) — announcements', () => {
  it('announces a newly arrived alert once, assertively for an emergency', async () => {
    await renderLiveBar([])
    expect(live()).toHaveTextContent('')

    await push([WARNING])

    expect(live()).toHaveAttribute('aria-live', 'assertive')
    expect(live()).toHaveTextContent(`EMERGENCY alert: ${WARNING.message}`)
  })

  it('announces only the arrival, politely, when an advisory joins an active set', async () => {
    const info = wireAlert({ id: 'info', severity: 'info', message: 'Cooling centers open.' })
    await renderLiveBar([info])
    expect(live()).toHaveTextContent('INFO alert: Cooling centers open.')

    await push([info, WATCH])

    expect(live()).toHaveAttribute('aria-live', 'polite')
    expect(live().textContent).toContain(WATCH.message)
    expect(live().textContent).not.toContain('Cooling centers open.')
  })

  it('falls silent once the alert it announced clears, never leaving a stale emergency readable', async () => {
    const info = wireAlert({ id: 'info', severity: 'info', message: 'Cooling centers open.' })
    await renderLiveBar([info])
    await push([info, WARNING])
    expect(live()).toHaveTextContent(WARNING.message)

    await push([info])

    expect(live()).toHaveTextContent('')
    expect(live().textContent).not.toContain(WARNING.message)
    expect(live()).toHaveAttribute('aria-live', 'polite')
  })

  it('falls silent when one of several alerts announced together clears', async () => {
    const info = wireAlert({ id: 'info', severity: 'info', message: 'Cooling centers open.' })
    await renderLiveBar([info])
    await push([info, WARNING, WATCH])
    expect(live()).toHaveTextContent(WARNING.message)
    expect(live()).toHaveTextContent(WATCH.message)

    await push([info, WATCH])

    expect(live()).toHaveTextContent('')
  })

  it('announces nothing for a push that changes nothing', async () => {
    await renderLiveBar([WATCH])
    const before = live().textContent

    await push([{ ...WATCH }])

    expect(live().textContent).toBe(before)
  })

  it('announces nothing as the ticker rotates', async () => {
    const info = wireAlert({ id: 'info', severity: 'info', message: 'Cooling centers open.' })
    fakeIntervals()
    await renderLiveBar([info, WATCH])
    const before = live().textContent
    const shownBefore = shownMessage()

    act(() => { vi.advanceTimersByTime(3500) })

    expect(shownMessage()).not.toBe(shownBefore)
    expect(live().textContent).toBe(before)
  })

  it('keeps the bar inert while a pause/EndEx overlay is up', async () => {
    await renderLiveBar([WATCH])
    act(() => alertPauseBridge.setOverlay('pause'))
    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('inert')
  })
})

describe('AlertBar (live) — "Details →"', () => {
  it('goes straight to the alert href when it has one', async () => {
    await renderLiveBar([WATCH])
    expect(screen.getByTestId('pulse-alert-bar-details')).toHaveAttribute('href', WATCH.href)
  })

  it('goes to the alerts history when the alert has no href', async () => {
    await renderLiveBar([wireAlert({ severity: 'advisory', href: null })])
    expect(screen.getByTestId('pulse-alert-bar-details')).toHaveAttribute('href', '/alerts')
  })
})
