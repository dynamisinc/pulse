/**
 * features/pwa/install/iosFlag.test.tsx - IOS_INSTALL_PROMPT_ENABLED kill flag (H-2) and the
 * held-event reset on exercise switch (L-1).
 */
import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const flag = vi.hoisted(() => ({ on: true }))
vi.mock('./installConfig', () => ({
  get IOS_INSTALL_PROMPT_ENABLED() { return flag.on },
}))
const ctx = vi.hoisted(() => ({ exerciseId: 'ex-a' }))
vi.mock('@/core/exerciseContext', () => ({
  useOptionalExerciseContext: () => ({ exerciseId: ctx.exerciseId }),
}))

import { InstallPrompt } from './InstallPrompt'
import { visitsKey } from './installEnv'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'

function bip() {
  const evt = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: string }>
  }
  evt.prompt = async () => undefined
  evt.userChoice = Promise.resolve({ outcome: 'accepted' })
  act(() => { window.dispatchEvent(evt) })
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  ctx.exerciseId = 'ex-a'
  flag.on = true
})

describe('IOS_INSTALL_PROMPT_ENABLED', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'userAgent', { value: IPHONE, configurable: true })
    localStorage.setItem(visitsKey('ex-a'), '1')
  })

  it('true: the iOS sheet shows', () => {
    render(<InstallPrompt brandName="Bay Shield" />)
    expect(screen.getByRole('region', { name: /Add Bay Shield/ })).toBeInTheDocument()
  })

  it('false: the iOS sheet never shows', () => {
    flag.on = false
    render(<InstallPrompt brandName="Bay Shield" />)
    expect(screen.queryByRole('region')).toBeNull()
  })

  it('false: the Android banner is unaffected', () => {
    flag.on = false
    render(<InstallPrompt brandName="Bay Shield" />)
    bip()
    expect(screen.getByRole('button', { name: /Add Bay Shield/ })).toBeInTheDocument()
  })
})

describe('held beforeinstallprompt event', () => {
  it('is dropped when the exercise changes', () => {
    const { rerender } = render(<InstallPrompt brandName="Bay Shield" />)
    bip()
    expect(screen.getByRole('button', { name: /Add Bay Shield/ })).toBeInTheDocument()
    ctx.exerciseId = 'ex-b'
    rerender(<InstallPrompt brandName="Harbor News" />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
