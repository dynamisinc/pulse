/**
 * core/emoji/EmojiPicker.test.tsx
 * ---------------------------------------------------------------------------
 * Behaviour of the shared emoji picker wired through `useEmojiPicker` to a plain
 * controlled text area (demo-feedback story 12, DF-15) - the same three pieces every
 * host uses, without any composer around them:
 *  - the button opens the picker and focus lands in its search box;
 *  - typing filters; arrow keys move the active emoji; Enter inserts it at the caret
 *    (or over the selection) and never submits the form; a press on an emoji inserts;
 *  - after a pick the picker closes and focus is back in the text area, caret after
 *    the emoji;
 *  - Escape closes, returns focus to the text area with the selection intact, and does
 *    not reach an ancestor's key handler (a surrounding dialog stays open);
 *  - Tab out and a press outside close it without moving focus back;
 *  - a press on a non-option part of the panel (a heading) does not move focus, so a
 *    following Escape still returns focus to the text area (Gate-1 M-1);
 *  - Escape on the trigger closes the picker and stops there (L-1); going busy closes
 *    it for good (L-2); Enter during IME composition does nothing (L-3); the scrolling
 *    listbox is not a Tab stop (L-4);
 *  - NO NETWORK: neither fetch nor XMLHttpRequest is touched during picker use, and
 *    the emoji are text, not images.
 */
import { useRef, useState } from 'react'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { EmojiPicker, EmojiPickerButton, useEmojiPicker } from '.'

interface HarnessProps {
  readonly initial?: string
  readonly disabled?: boolean
  readonly onOuterKeyDown?: (key: string) => void
  readonly onSubmit?: () => void
}

function Harness({ initial = '', disabled = false, onOuterKeyDown, onSubmit }: HarnessProps) {
  const [text, setText] = useState(initial)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiPicker({ targetRef: textRef, value: text, onChange: setText, disabled })
  return (
    <div onKeyDown={event => onOuterKeyDown?.(event.key)}>
      <form
        onSubmit={event => {
          event.preventDefault()
          onSubmit?.()
        }}
      >
        <textarea
          ref={textRef}
          aria-label="Text"
          value={text}
          onChange={event => setText(event.target.value)}
        />
        <EmojiPickerButton {...emoji.buttonProps} />
        {emoji.isOpen && <EmojiPicker {...emoji.pickerProps} />}
        <button type="submit">Send</button>
      </form>
      <button type="button">Elsewhere</button>
    </div>
  )
}

function textBox(): HTMLTextAreaElement {
  const element = screen.getByLabelText('Text')
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
  return element
}

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Add emoji' }))
  return screen.getByRole('dialog', { name: 'Emoji picker' })
}

let fetchSpy: MockInstance<typeof fetch>
let xhrSpy: MockInstance<XMLHttpRequest['open']>

beforeEach(() => {
  fetchSpy = vi.spyOn(globalThis, 'fetch')
  xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('EmojiPicker — opening and searching', () => {
  it('opens from the button, with focus in the search box', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const button = screen.getByRole('button', { name: 'Add emoji' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')

    const picker = await openPicker(user)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button).toHaveAttribute('aria-controls', picker.id)
    expect(within(picker).getByRole('combobox', { name: 'Search emoji' })).toHaveFocus()
    expect(within(picker).getByRole('group', { name: 'Smileys' })).toBeInTheDocument()
  })

  it('opens from the keyboard (Enter on the focused button)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    screen.getByRole('button', { name: 'Add emoji' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('combobox', { name: 'Search emoji' })).toHaveFocus()
  })

  it('filters by name or keyword and announces the count', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const picker = await openPicker(user)

    await user.keyboard('thumbs')
    const options = within(picker).getAllByRole('option')
    expect(options.map(option => option.getAttribute('aria-label'))).toEqual([
      'thumbs up',
      'thumbs down',
    ])
    expect(within(picker).getByRole('status')).toHaveTextContent('2 emoji found')

    await user.clear(within(picker).getByRole('combobox'))
    await user.keyboard('zzzqqq')
    expect(within(picker).queryAllByRole('option')).toHaveLength(0)
    expect(within(picker).getByText('No emoji match that search.')).toBeInTheDocument()
  })

  it('renders native emoji text, not images, and no MUI chrome', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const picker = await openPicker(user)
    expect(picker.querySelector('img, svg, [class*="Mui"]')).toBeNull()
    expect(within(picker).getByRole('option', { name: 'thumbs up' })).toHaveTextContent('👍')
  })
})

describe('EmojiPicker — keyboard and insertion', () => {
  it('arrow keys move the active emoji; Enter inserts it at the caret', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Stay safe" />)
    textBox().setSelectionRange(4, 4)
    const picker = await openPicker(user)
    const search = within(picker).getByRole('combobox')

    const first = within(picker).getByRole('option', { name: 'grinning face' })
    expect(search).toHaveAttribute('aria-activedescendant', first.id)
    expect(first).toHaveAttribute('aria-selected', 'true')

    // Right, Down, Left: index 0 -> 1 -> 9 -> 8 (8 columns).
    await user.keyboard('{ArrowRight}{ArrowDown}{ArrowLeft}')
    const options = within(picker).getAllByRole('option')
    const target = options[8]
    expect(target).toBeDefined()
    expect(search).toHaveAttribute('aria-activedescendant', target?.id)

    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    const expected = `Stay${target?.textContent ?? ''} safe`
    expect(textBox()).toHaveValue(expected)
    expect(textBox()).toHaveFocus()
    expect(textBox().selectionStart).toBe(4 + (target?.textContent ?? '').length)
  })

  it('Enter inserts the first search match and does not submit the form', async () => {
    const onSubmit = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial="Road closed " onSubmit={onSubmit} />)
    textBox().setSelectionRange(12, 12)
    await openPicker(user)

    await user.keyboard('roadwork{Enter}')
    expect(textBox()).toHaveValue('Road closed 🚧')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('replaces the selected text', async () => {
    const user = userEvent.setup()
    render(<Harness initial="I love this" />)
    textBox().setSelectionRange(2, 6)
    const picker = await openPicker(user)

    await user.click(within(picker).getByRole('option', { name: 'red heart' }))
    expect(textBox()).toHaveValue('I ❤️ this')
    expect(textBox()).toHaveFocus()
    expect(textBox().selectionStart).toBe(2 + '❤️'.length)
    expect(textBox().selectionEnd).toBe(2 + '❤️'.length)
  })

  it('Escape closes, returns focus to the text area with its selection, and stops there', async () => {
    const onOuterKeyDown = vi.fn()
    const user = userEvent.setup()
    render(<Harness initial="abcdef" onOuterKeyDown={onOuterKeyDown} />)
    textBox().setSelectionRange(1, 3)
    await openPicker(user)
    onOuterKeyDown.mockClear()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(textBox()).toHaveFocus()
    expect(textBox().selectionStart).toBe(1)
    expect(textBox().selectionEnd).toBe(3)
    expect(textBox()).toHaveValue('abcdef')
    expect(onOuterKeyDown).not.toHaveBeenCalledWith('Escape')
  })

  it('Tab out of the picker closes it', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    await user.tab()
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Send' })).toHaveFocus()
  })

  it('a press outside closes it; the button toggles it closed too', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await openPicker(user)
    await user.click(screen.getByRole('button', { name: 'Elsewhere' }))
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()

    await openPicker(user)
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
  })

  it('is closed and its button disabled while the host is busy', () => {
    render(<Harness disabled />)
    expect(screen.getByRole('button', { name: 'Add emoji' })).toBeDisabled()
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
  })

  it('stays closed when the host goes busy and then idle again (L-2)', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<Harness />)
    await openPicker(user)
    rerender(<Harness disabled />)
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    rerender(<Harness />)
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add emoji' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('a press on a heading keeps focus in the picker; Escape then returns it (M-1)', async () => {
    const user = userEvent.setup()
    render(<Harness initial="abc" />)
    textBox().setSelectionRange(1, 1)
    const picker = await openPicker(user)
    const search = within(picker).getByRole('combobox')

    await user.click(within(picker).getByText('Smileys'))
    expect(search).toHaveFocus()
    expect(picker).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(textBox()).toHaveFocus()
    expect(textBox().selectionStart).toBe(1)
  })

  it('Escape on the open trigger closes the picker and stops there (L-1)', async () => {
    const onOuterKeyDown = vi.fn()
    const user = userEvent.setup()
    render(<Harness onOuterKeyDown={onOuterKeyDown} />)
    await openPicker(user)
    const button = screen.getByRole('button', { name: 'Add emoji' })

    await user.tab({ shift: true })
    expect(button).toHaveFocus()
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeInTheDocument()
    onOuterKeyDown.mockClear()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(onOuterKeyDown).not.toHaveBeenCalledWith('Escape')
  })

  it('ignores Enter while an IME is composing (L-3)', async () => {
    const user = userEvent.setup()
    render(<Harness initial="abc" />)
    const picker = await openPicker(user)
    fireEvent.keyDown(within(picker).getByRole('combobox'), { key: 'Enter', isComposing: true })
    expect(textBox()).toHaveValue('abc')
    expect(screen.getByRole('dialog', { name: 'Emoji picker' })).toBeInTheDocument()
  })

  it('does not make the scrolling listbox a Tab stop (L-4)', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const picker = await openPicker(user)
    expect(within(picker).getByRole('listbox')).toHaveAttribute('tabindex', '-1')
  })
})

describe('EmojiPicker — no network (DF-15)', () => {
  it('makes no fetch or XMLHttpRequest while opening, searching, navigating and inserting', async () => {
    const user = userEvent.setup()
    render(<Harness initial="Update: " />)
    textBox().setSelectionRange(8, 8)
    const picker = await openPicker(user)
    await user.keyboard('storm')
    await user.keyboard('{ArrowRight}{ArrowLeft}{Enter}')
    await openPicker(user)
    await user.click(screen.getByRole('option', { name: 'warning' }))
    await openPicker(user)
    await user.keyboard('{Escape}')

    expect(picker).not.toBeInTheDocument()
    expect(textBox().value.startsWith('Update: ')).toBe(true)
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})
