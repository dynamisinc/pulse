/**
 * features/controller/shortcutHints.test.tsx
 * ---------------------------------------------------------------------------
 * Story 14 (D5-024, TABLET-AMENDMENT section 4): the console's shortcut hints.
 *  - ONE keycap, the platform's own: Ctrl+K off Apple, the command glyph on macOS AND iPadOS
 *    (`MacIntel` + touch points);
 *  - on a COARSE pointer the strip is the tap hint "Tap PERSONAS or press <chord>";
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ConsoleShortcutStrip } from './shortcutHints'
import { usePersonasTooltip } from './usePersonasTooltip'
import { mockPointer, restoreMatchMedia } from '@/features/controller/components/confirm/coarsePointer.testUtils'

/** jsdom has no `maxTouchPoints`, so both fields are (re)defined on the instance. */
function stubNavigator(platform: string, maxTouchPoints: number) {
  Object.defineProperty(window.navigator, 'platform', { configurable: true, value: platform })
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    configurable: true,
    value: maxTouchPoints,
  })
}

afterEach(() => {
  Reflect.deleteProperty(window.navigator, 'platform')
  Reflect.deleteProperty(window.navigator, 'maxTouchPoints')
  restoreMatchMedia()
})

function strip() {
  render(<ThemeProvider theme={cobraTheme}><ConsoleShortcutStrip /></ThemeProvider>)
  return screen.getByTestId('console-shortcut-strip')
}

describe('ConsoleShortcutStrip — fine pointer', () => {
  it('shows only Ctrl+K off Apple platforms', () => {
    stubNavigator('Win32', 0)
    const el = strip()
    expect(el).toHaveTextContent('Ctrl+K')
    expect(el).toHaveTextContent(/post as a persona/i)
    expect(el.querySelectorAll('kbd')).toHaveLength(1)
    expect(el).not.toHaveTextContent('⌘')
  })

  it('shows only the command glyph on a Mac', () => {
    stubNavigator('MacIntel', 0)
    const el = strip()
    expect(el).toHaveTextContent('⌘K')
    expect(el).not.toHaveTextContent('Ctrl')
    expect(el.querySelectorAll('kbd')).toHaveLength(1)
  })

  it('shows the command glyph on iPadOS (MacIntel with touch points)', () => {
    stubNavigator('MacIntel', 5)
    expect(strip()).toHaveTextContent('⌘K')
  })
})

describe('ConsoleShortcutStrip — coarse pointer', () => {
  it('reads "Tap PERSONAS or press ⌘K" on iPadOS', () => {
    stubNavigator('MacIntel', 5)
    mockPointer(true)
    const el = strip()
    expect(el).toHaveAttribute('data-pointer', 'coarse')
    expect(el).toHaveTextContent('Tap PERSONAS or press⌘K')
    expect(el.querySelectorAll('kbd')).toHaveLength(1)
  })

  it('reads "Tap PERSONAS or press Ctrl+K" off Apple', () => {
    stubNavigator('Linux armv8l', 5)
    mockPointer(true)
    expect(strip()).toHaveTextContent('Tap PERSONAS or pressCtrl+K')
  })
})

describe('usePersonasTooltip', () => {
  function Probe() {
    return <span data-testid="tip">{usePersonasTooltip()}</span>
  }
  it('names the platform chord', () => {
    stubNavigator('MacIntel', 5)
    render(<Probe />)
    expect(screen.getByTestId('tip')).toHaveTextContent('Post as persona (⌘K)')
  })
})
