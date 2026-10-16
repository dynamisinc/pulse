/**
 * AlertBar.a11y.test.tsx: reduced-motion and live-region behavior
 * (mobile-tablet story 05; NFR-001). The live region must announce the
 * none -> first-alert transition and later changes (assertive for emergency,
 * polite otherwise), and prefers-reduced-motion must stop ticker rotation.
 */
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { alertPauseBridge } from '../../alertPauseBridge'
import { AlertBar } from './AlertBar'
import { useAlerts } from './useAlerts'
import type { Alert } from './alertTypes'

vi.mock('./useAlerts', () => ({ useAlerts: vi.fn() }))
vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-alert-bar-a11y-0001',
    exerciseName: 'Alert Bar A11y Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

const mockUseAlerts = vi.mocked(useAlerts)

function makeAlert(overrides: Partial<Alert> = {}): Alert {
  return {
    id: 'a1',
    severity: 'advisory',
    message: 'Alert message.',
    scenarioTime: '2033-09-04T14:00:00.000Z',
    ...overrides,
  }
}

type Listener = () => void
function stubMatchMedia(reduce: boolean) {
  const listeners = new Set<Listener>()
  const mql = {
    matches: reduce,
    addEventListener: (_: string, l: Listener) => listeners.add(l),
    removeEventListener: (_: string, l: Listener) => listeners.delete(l),
  }
  vi.stubGlobal('matchMedia', vi.fn(() => mql))
  return {
    set(next: boolean) {
      mql.matches = next
      listeners.forEach(l => l())
    },
  }
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
  cleanup()
  mockUseAlerts.mockReset()
  alertPauseBridge.reset()
})

describe('AlertBar: prefers-reduced-motion stops ticker rotation', () => {
  const two = [
    makeAlert({ id: 'a1', severity: 'info', message: 'First alert message.' }),
    makeAlert({ id: 'a2', severity: 'advisory', message: 'Second alert message.' }),
  ]
  beforeEach(() => vi.useFakeTimers())

  it('holds the first alert indefinitely when reduced motion is requested', () => {
    stubMatchMedia(true)
    mockUseAlerts.mockReturnValue(two)
    render(<AlertBar />)
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('First alert message.')
    // Still reachable: the Details link goes to the full list.
    expect(screen.getByTestId('pulse-alert-bar-details')).toBeInTheDocument()
  })

  it('rotates when reduced motion is not requested', () => {
    stubMatchMedia(false)
    mockUseAlerts.mockReturnValue(two)
    render(<AlertBar />)
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Second alert message.')
  })

  it('stops when the preference flips on while running, and resumes when it flips off', () => {
    const media = stubMatchMedia(false)
    mockUseAlerts.mockReturnValue(two)
    render(<AlertBar />)
    act(() => { vi.advanceTimersByTime(3500) })
    act(() => { media.set(true) })
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Second alert message.')
    act(() => { media.set(false) })
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('First alert message.')
  })
})

describe('AlertBar: live region announces changes (NFR-001)', () => {
  it('is one persistent role=status node across none -> advisory -> emergency -> none', () => {
    mockUseAlerts.mockReturnValue([])
    const { rerender } = render(<AlertBar />)
    const host = screen.getByRole('status')
    expect(host).toHaveTextContent('')
    expect(host).toHaveAttribute('aria-live', 'polite')

    mockUseAlerts.mockReturnValue([makeAlert({ message: 'Road closed.' })])
    rerender(<AlertBar />)
    expect(screen.getByRole('status')).toBe(host)
    expect(host).toHaveTextContent('Road closed.')
    expect(host).toHaveAttribute('aria-live', 'polite')
    expect(host).toHaveAttribute('aria-atomic', 'true')

    mockUseAlerts.mockReturnValue([makeAlert({ id: 'e', severity: 'emergency', message: 'Evacuate now.' })])
    rerender(<AlertBar />)
    expect(screen.getByRole('status')).toBe(host)
    expect(host).toHaveTextContent('Evacuate now.')
    expect(host).toHaveAttribute('aria-live', 'assertive')

    mockUseAlerts.mockReturnValue([])
    rerender(<AlertBar />)
    expect(screen.getByRole('status')).toBe(host)
    expect(host).toHaveTextContent('')
  })

  it('announces an emergency as the very first alert (none -> emergency) assertively', () => {
    mockUseAlerts.mockReturnValue([])
    const { rerender } = render(<AlertBar />)
    const host = screen.getByRole('status')
    mockUseAlerts.mockReturnValue([makeAlert({ id: 'e', severity: 'emergency', message: 'Shelter in place.' })])
    rerender(<AlertBar />)
    expect(screen.getByRole('status')).toBe(host)
    expect(host).toHaveAttribute('aria-live', 'assertive')
    expect(host).toHaveTextContent('Shelter in place.')
    expect(host).toHaveTextContent('EMERGENCY')
  })
})

describe('AlertBar: held (inert, not rotating) while a pause overlay is up', () => {
  it('is inert only while paused, and stays visible with its text', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ id: 'e', severity: 'emergency', message: 'Evacuate now.' })])
    render(<AlertBar />)
    const bar = screen.getByTestId('pulse-alert-bar')
    expect(bar).not.toHaveAttribute('inert')
    act(() => alertPauseBridge.setPauseActive(true))
    expect(bar).toHaveAttribute('inert')
    expect(bar).toHaveTextContent('Evacuate now.')
    act(() => alertPauseBridge.setPauseActive(false))
    expect(bar).not.toHaveAttribute('inert')
  })

  it('is also inert while a covering overlay (EndEx / break-fiction) is up', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ id: 'e', severity: 'emergency', message: 'Evacuate now.' })])
    render(<AlertBar />)
    act(() => alertPauseBridge.setOverlay('cover'))
    expect(screen.getByTestId('pulse-alert-bar')).toHaveAttribute('inert')
  })

  it('publishes severity label + message for the pause dialog, clearing on unmount', () => {
    mockUseAlerts.mockReturnValue([makeAlert({ id: 'e', severity: 'emergency', message: 'Evacuate now.' })])
    const { unmount } = render(<AlertBar />)
    expect(alertPauseBridge.getSnapshot().alertSummary).toBe('EMERGENCY: Evacuate now.')
    unmount()
    expect(alertPauseBridge.getSnapshot().alertSummary).toBe('')
  })

  it('holds ticker rotation while paused and resumes afterwards', () => {
    vi.useFakeTimers()
    stubMatchMedia(false)
    mockUseAlerts.mockReturnValue([
      makeAlert({ id: 'a1', severity: 'info', message: 'First alert message.' }),
      makeAlert({ id: 'a2', severity: 'advisory', message: 'Second alert message.' }),
    ])
    render(<AlertBar />)
    act(() => alertPauseBridge.setPauseActive(true))
    act(() => { vi.advanceTimersByTime(20000) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('First alert message.')
    act(() => alertPauseBridge.setPauseActive(false))
    act(() => { vi.advanceTimersByTime(3500) })
    expect(screen.getByTestId('pulse-alert-bar-message')).toHaveTextContent('Second alert message.')
  })
})
