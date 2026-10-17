/**
 * core/hooks/platformModifier.test.ts
 * ---------------------------------------------------------------------------
 * Story 14: the platform-correct modifier label for shortcut hints. Pure functions, plain
 * `navigator`-shaped objects. The iPadOS case is the one that matters: Safari on iPadOS reports
 * `MacIntel`, so only `maxTouchPoints > 1` tells it from a Mac, and both want Command.
 */
import { describe, expect, it } from 'vitest'
import {
  isApplePlatform,
  isIpadOs,
  platformChordLabel,
  platformModifierLabel,
} from './platformModifier'

const MAC = { platform: 'MacIntel', maxTouchPoints: 0 }
const IPADOS = { platform: 'MacIntel', maxTouchPoints: 5 }
const IPAD_LEGACY = { platform: 'iPad', maxTouchPoints: 5 }
const WINDOWS = { platform: 'Win32', maxTouchPoints: 0 }
const WINDOWS_TOUCH = { platform: 'Win32', maxTouchPoints: 10 }
const LINUX = { platform: 'Linux x86_64', maxTouchPoints: 0 }
const ANDROID = { platform: 'Linux armv8l', maxTouchPoints: 5 }

describe('platformModifierLabel', () => {
  it('is the command glyph on a Mac', () => {
    expect(platformModifierLabel(MAC)).toBe('⌘')
    expect(isApplePlatform(MAC)).toBe(true)
  })

  it('is the command glyph on iPadOS (MacIntel with touch points)', () => {
    expect(isIpadOs(IPADOS)).toBe(true)
    expect(isIpadOs(MAC)).toBe(false)
    expect(platformModifierLabel(IPADOS)).toBe('⌘')
    expect(platformModifierLabel(IPAD_LEGACY)).toBe('⌘')
  })

  it('is Ctrl on Windows, with or without touch', () => {
    expect(platformModifierLabel(WINDOWS)).toBe('Ctrl')
    expect(platformModifierLabel(WINDOWS_TOUCH)).toBe('Ctrl')
  })

  it('is Ctrl on Linux and Android', () => {
    expect(platformModifierLabel(LINUX)).toBe('Ctrl')
    expect(platformModifierLabel(ANDROID)).toBe('Ctrl')
  })

  it('is Ctrl when nothing is known', () => {
    expect(platformModifierLabel({})).toBe('Ctrl')
  })

  it('prefers userAgentData.platform when the browser provides it', () => {
    expect(platformModifierLabel({ platform: 'Win32', userAgentData: { platform: 'macOS' } })).toBe('⌘')
    expect(platformModifierLabel({ platform: 'MacIntel', userAgentData: { platform: 'Windows' } })).toBe('Ctrl')
  })
})

describe('platformChordLabel', () => {
  it('shows exactly one keycap per platform', () => {
    expect(platformChordLabel('K', MAC)).toBe('⌘K')
    expect(platformChordLabel('K', IPADOS)).toBe('⌘K')
    expect(platformChordLabel('K', WINDOWS)).toBe('Ctrl+K')
    expect(platformChordLabel('Enter', LINUX)).toBe('Ctrl+Enter')
  })
})
