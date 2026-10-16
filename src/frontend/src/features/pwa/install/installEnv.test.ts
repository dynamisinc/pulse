/**
 * features/pwa/install/installEnv.test.ts - platform/standalone detection + per-exercise storage.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  detectPlatform, dismissKey, isDismissed, isStandalone, markDismissed, recordVisit, visitsKey,
} from './installEnv'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
  '(KHTML, like Gecko) Version/17.0 Safari/605.1.15'

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
})

describe('detectPlatform', () => {
  it('recognises iPhone Safari and iPad-as-Mac Safari', () => {
    expect(detectPlatform(IPHONE, 5)).toBe('ios-safari')
    expect(detectPlatform(IPAD_AS_MAC, 5)).toBe('ios-safari')
  })
  it('does not treat desktop Safari, Android, or iOS third-party browsers as iOS Safari', () => {
    expect(detectPlatform(IPAD_AS_MAC, 0)).toBe('other')
    expect(detectPlatform('Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile Safari/537.36', 5)).toBe('other')
    expect(detectPlatform(IPHONE.replace('Version/17.0', 'CriOS/120'), 5)).toBe('other')
    expect(detectPlatform(IPHONE.replace(' Safari/604.1', ''), 5)).toBe('other') // webview
  })
})

describe('isStandalone', () => {
  it('detects display-mode standalone and iOS navigator.standalone', () => {
    const mm = (m: boolean) => ({ matchMedia: () => ({ matches: m }), navigator: {} }) as unknown as Window
    expect(isStandalone(mm(true))).toBe(true)
    expect(isStandalone(mm(false))).toBe(false)
    expect(isStandalone({ navigator: { standalone: true } } as unknown as Window)).toBe(true)
  })
})

describe('per-exercise persistence', () => {
  it('keys include the exerciseId and never leak across exercises', () => {
    markDismissed('ex-a')
    expect(localStorage.getItem(dismissKey('ex-a'))).toBe('1')
    expect(dismissKey('ex-a')).toContain('ex-a')
    expect(isDismissed('ex-a')).toBe(true)
    expect(isDismissed('ex-b')).toBe(false)
  })
  it('counts one visit per tab session, per exercise', () => {
    expect(recordVisit('ex-a')).toBe(1)
    expect(recordVisit('ex-a')).toBe(1) // same session
    sessionStorage.clear()
    expect(recordVisit('ex-a')).toBe(2)
    expect(recordVisit('ex-b')).toBe(1)
    expect(localStorage.getItem(visitsKey('ex-a'))).toBe('2')
  })
  it('degrades silently when storage throws', () => {
    const bad = { getItem: () => { throw new Error('x') }, setItem: () => { throw new Error('x') } } as unknown as Storage
    expect(isDismissed('ex-a', bad)).toBe(false)
    expect(() => markDismissed('ex-a', bad)).not.toThrow()
    expect(recordVisit('ex-a', bad, bad)).toBe(0)
  })
})
