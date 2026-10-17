/**
 * features/pwa/install/InstallPrompt.test.tsx - Android/iOS/standalone/dismissed state machine
 * (mobile-tablet story 11). Also asserts no telemetry and no Pulse/Dynamis text.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ctx = vi.hoisted(() => ({ exerciseId: 'ex-a' as string | undefined }))
vi.mock('@/core/exerciseContext', () => ({
  useOptionalExerciseContext: () => (ctx.exerciseId ? { exerciseId: ctx.exerciseId } : undefined),
}))
const emit = vi.hoisted(() => vi.fn())
vi.mock('@/core/telemetry/mockSink', () => ({ emitTelemetryEvent: emit }))

// Pin the iOS sheet ON here (it ships on again since #606) so this suite does not depend on
// the flag's current value. The off path is covered in iosFlag.test.tsx.
vi.mock('./installConfig', () => ({ IOS_INSTALL_PROMPT_ENABLED: true }))

import { InstallPrompt } from './InstallPrompt'
import { dismissKey, visitsKey } from './installEnv'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const realUa = navigator.userAgent

function setUa(ua: string) {
  Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true })
}
function setStandalone(v: boolean) {
  window.matchMedia = ((q: string) => ({
    matches: v && q.includes('standalone'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
}
function fireBip(outcome: 'accepted' | 'dismissed' = 'accepted') {
  const evt = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: ReturnType<typeof vi.fn>
    userChoice: Promise<{ outcome: string }>
  }
  evt.prompt = vi.fn(async () => undefined)
  evt.userChoice = Promise.resolve({ outcome })
  act(() => { window.dispatchEvent(evt) })
  return evt
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  ctx.exerciseId = 'ex-a'
  setStandalone(false)
  setUa(realUa)
  emit.mockClear()
})
afterEach(() => setUa(realUa))

describe('Android / Chrome', () => {
  it('holds the event, then a branded banner whose tap calls prompt()', async () => {
    render(<InstallPrompt brandName="Bay Shield Network" />)
    expect(screen.queryByRole('button')).toBeNull()
    const evt = fireBip()
    expect(evt.defaultPrevented).toBe(true)
    const btn = screen.getByRole('button', { name: /Add Bay Shield Network to your home screen/ })
    await act(async () => { fireEvent.click(btn) })
    expect(evt.prompt).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /Add Bay Shield/ })).toBeNull()
  })

  it('never says Pulse or Dynamis', () => {
    render(<InstallPrompt brandName="Bay Shield Network" />)
    fireBip()
    expect(document.body.textContent).not.toMatch(/pulse|dynamis/i)
  })

  it('dismiss (close button) hides and persists for this exercise only', () => {
    const { unmount } = render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
    expect(localStorage.getItem(dismissKey('ex-a'))).toBe('1')
    unmount()
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull() // still dismissed
  })

  it('does not carry a dismissal to another exercise', () => {
    localStorage.setItem(dismissKey('ex-a'), '1')
    ctx.exerciseId = 'ex-b'
    render(<InstallPrompt brandName="Harbor News" />)
    fireBip()
    expect(screen.getByRole('button', { name: /Add Harbor News/ })).toBeInTheDocument()
  })

  it('Escape with focus inside the banner dismisses it', () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    screen.getByRole('button', { name: 'Not now' }).focus()
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
    expect(localStorage.getItem(dismissKey('ex-a'))).toBe('1')
  })

  it('Escape elsewhere (focus outside, or already handled) does not dismiss', () => {
    render(
      <>
        <button type="button">other dialog</button>
        <InstallPrompt brandName="Bay Shield" />
      </>,
    )
    fireBip()
    screen.getByRole('button', { name: 'other dialog' }).focus()
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    screen.getByRole('button', { name: 'Not now' }).focus()
    const handled = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true, bubbles: true })
    handled.preventDefault()
    document.activeElement?.dispatchEvent(handled)
    expect(screen.getByRole('button', { name: 'Not now' })).toBeInTheDocument()
    expect(localStorage.getItem(dismissKey('ex-a'))).toBeNull()
  })

  it('does not steal focus when it appears', () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    const before = document.activeElement
    fireBip()
    expect(document.activeElement).toBe(before)
  })

  it('persists dismissal when the user declines the native prompt', async () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip('dismissed')
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add Bay Shield/ })) })
    expect(localStorage.getItem(dismissKey('ex-a'))).toBe('1')
  })

  it('hides after the app is installed', () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    act(() => { window.dispatchEvent(new Event('appinstalled')) })
    expect(screen.queryByRole('button', { name: 'Not now' })).toBeNull()
  })

  it('is suppressed in standalone display mode', () => {
    setStandalone(true)
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('renders nothing without a resolved exercise (fail closed)', () => {
    ctx.exerciseId = undefined
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    expect(screen.queryByRole('button')).toBeNull()
  })
})

describe('iOS Safari', () => {
  beforeEach(() => setUa(IPHONE))

  it('does not show on the first visit', () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    expect(screen.queryByRole('region')).toBeNull()
    expect(localStorage.getItem(visitsKey('ex-a'))).toBe('1')
  })

  it('shows the Share -> Add to Home Screen sheet from the second visit, dismissible', () => {
    localStorage.setItem(visitsKey('ex-a'), '1')
    const { unmount } = render(<InstallPrompt brandName="Bay Shield" />)
    const dlg = screen.getByRole('region', { name: /Add Bay Shield to your home screen/ })
    expect(dlg.textContent).toMatch(/Share/)
    expect(dlg.textContent).toMatch(/Add to Home Screen/)
    expect(dlg.querySelectorAll('svg').length).toBeGreaterThanOrEqual(3)
    // #606: the installed app opens signed out; the last step says how to get in.
    expect(dlg.textContent).toMatch(/Open Bay Shield from your home screen and paste your sign-in/)
    expect(dlg.textContent).not.toMatch(/Pulse/)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region')).toBeNull()
    unmount()
    // next visit: never auto-reopens within the same exercise
    sessionStorage.clear()
    render(<InstallPrompt brandName="Bay Shield" />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('Escape closes the sheet when focus is inside it', () => {
    localStorage.setItem(visitsKey('ex-a'), '1')
    render(<InstallPrompt brandName="Bay Shield" />)
    screen.getByRole('button', { name: 'Close' }).focus()
    fireEvent.keyDown(document.activeElement ?? document, { key: 'Escape' })
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('is suppressed when launched from the home screen (navigator.standalone)', () => {
    localStorage.setItem(visitsKey('ex-a'), '5')
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true })
    render(<InstallPrompt brandName="Bay Shield" />)
    expect(screen.queryByRole('region')).toBeNull()
    Reflect.deleteProperty(navigator, 'standalone')
  })
})

describe('telemetry (MT-D5)', () => {
  it('emits no telemetry on show, install or dismiss', async () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    fireBip()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /Add Bay Shield/ })) })
    expect(emit).not.toHaveBeenCalled()
  })
})
