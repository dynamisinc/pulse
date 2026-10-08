/**
 * features/controller/runSheet/runSheetKeyboard.test.ts
 * ---------------------------------------------------------------------------
 * The run sheet's keyboard map (demo-polish C3; NFR-001): which key means what, and -
 * above all - when a key press is IGNORED (typing in a field, modifier held, already
 * handled, an auto-repeating action key).
 */
import { describe, expect, it } from 'vitest'
import { KEYBOARD_HELP, isTypingTarget, shortcutFor, type ShortcutEvent } from './runSheetKeyboard'

function press(key: string, overrides: Partial<ShortcutEvent> = {}): ShortcutEvent {
  return {
    key,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    target: document.body,
    ...overrides,
  }
}

describe('shortcutFor', () => {
  it('maps the five documented keys, case-insensitively', () => {
    expect(shortcutFor(press('ArrowUp'))).toBe('previous')
    expect(shortcutFor(press('ArrowDown'))).toBe('next')
    expect(shortcutFor(press('f'))).toBe('fire')
    expect(shortcutFor(press('F'))).toBe('fire')
    expect(shortcutFor(press('n'))).toBe('fireNext')
    expect(shortcutFor(press('S'))).toBe('skip')
    expect(shortcutFor(press('e'))).toBe('edit')
  })

  it('leaves every other key alone', () => {
    for (const key of ['a', 'x', 'Enter', ' ', 'Tab', 'Escape', 'ArrowLeft', '1']) {
      expect(shortcutFor(press(key))).toBeUndefined()
    }
  })

  it('is ignored while typing in a text field, textarea, select or contenteditable', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    // jsdom does not implement isContentEditable; mirror what a browser reports.
    Object.defineProperty(editable, 'isContentEditable', { value: true })
    for (const target of [input, textarea, select, editable]) {
      expect(isTypingTarget(target)).toBe(true)
      expect(shortcutFor(press('f', { target }))).toBeUndefined()
      expect(shortcutFor(press('ArrowDown', { target }))).toBeUndefined()
    }
  })

  it('still works from a button or the list (not typing)', () => {
    const button = document.createElement('button')
    const row = document.createElement('div')
    expect(isTypingTarget(button)).toBe(false)
    expect(shortcutFor(press('f', { target: button }))).toBe('fire')
    expect(shortcutFor(press('n', { target: row }))).toBe('fireNext')
    expect(isTypingTarget(null)).toBe(false)
  })

  it('ignores a press with Ctrl, Meta or Alt held (the browser / console own those)', () => {
    expect(shortcutFor(press('f', { ctrlKey: true }))).toBeUndefined()
    expect(shortcutFor(press('f', { metaKey: true }))).toBeUndefined()
    expect(shortcutFor(press('n', { altKey: true }))).toBeUndefined()
    expect(shortcutFor(press('ArrowDown', { ctrlKey: true }))).toBeUndefined()
  })

  it('ignores a press someone already handled', () => {
    expect(shortcutFor(press('f', { defaultPrevented: true }))).toBeUndefined()
  })

  it('never lets a held key repeat an ACTION (holding N must not fire a string of posts)', () => {
    for (const key of ['f', 'n', 's', 'e']) {
      expect(shortcutFor(press(key, { repeat: true }))).toBeUndefined()
    }
    // Selection may repeat so a long list is easy to cross.
    expect(shortcutFor(press('ArrowDown', { repeat: true }))).toBe('next')
  })
})

describe('KEYBOARD_HELP', () => {
  it('lists every shortcut the map implements', () => {
    const keys = KEYBOARD_HELP.map(entry => entry.keys)
    expect(keys).toEqual(['↑ ↓', 'F', 'N', 'S', 'E'])
  })
})
