/**
 * features/social/components/Composer.emoji.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 12a (#508, DF-15): the emoji button in the participant
 * `ComposerForm` tools row, exercised in all three places that form appears -
 * the inline `<Composer>`, the `<ComposeModal>` and the thread's `<ReplyComposer>`:
 *  - a FontAwesome face-smile button sits in the tools row next to attach;
 *  - a chosen emoji goes in at the caret, or over the selection, and focus stays in
 *    the text area with the caret just past it;
 *  - the emoji counts toward the 280 limit like any typed character (the ring);
 *  - Escape closes the picker and returns focus to the text area - in the modal it
 *    does NOT also close (or prompt to discard) the dialog;
 *  - participant skin: the picker is the form's own skinned panel, no MUI/COBRA;
 *  - NO NETWORK: no fetch / XMLHttpRequest while the picker is used.
 *
 * Renders through the real exercise + session providers (the shared axios client's
 * dev mock adapters), like the neighbouring composer suites.
 */
import { useRef, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { Composer } from './Composer'
import { ReplyComposer } from './ReplyComposer'
import { ComposeModal } from '../layout/ComposeModal'
import { ownPostStore } from '../services/ownPostStore'
import { postStore } from '../services/postStore'

function renderInProviders(children: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>{children}</SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

function asTextArea(element: HTMLElement): HTMLTextAreaElement {
  if (!(element instanceof HTMLTextAreaElement)) throw new Error('not a textarea')
  return element
}

function ModalHost() {
  const [open, setOpen] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={opener} type="button" onClick={() => setOpen(true)}>Open composer</button>
      {open && <ComposeModal onClose={() => setOpen(false)} returnFocusRef={opener} />}
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  postStore.resetForTests()
  ownPostStore.resetForTests()
  resetTelemetryBuffer()
})

describe('Composer — emoji picker (story 12a)', () => {
  it('has the emoji button in the tools row, beside attach', async () => {
    renderInProviders(<Composer />)
    const form = await screen.findByTestId('composer')
    const button = within(form).getByRole('button', { name: 'Add emoji' })
    const attach = within(form).getByRole('button', { name: 'Add photos or video' })
    expect(button.parentElement).toBe(attach.parentElement)
    // FontAwesome face-smile, decorative.
    expect(button.querySelector('svg.fa-face-smile')).toHaveAttribute('aria-hidden', 'true')
  })

  it('inserts at the caret, keeps focus, and counts toward the limit', async () => {
    const user = userEvent.setup()
    renderInProviders(<Composer />)
    const input = asTextArea(await screen.findByLabelText('Post text'))

    await user.type(input, 'Shelter open')
    input.setSelectionRange(7, 7)
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    const picker = screen.getByRole('dialog', { name: 'Emoji picker' })
    await user.click(within(picker).getByRole('option', { name: 'house' }))

    expect(input).toHaveValue('Shelter🏠 open')
    expect(input).toHaveFocus()
    expect(input.selectionStart).toBe(7 + '🏠'.length)
    // 12 typed characters + 1 emoji (counted by code point, like the hook counts text).
    expect(screen.getByTestId('char-ring')).toHaveAttribute('aria-label', '267 characters remaining')

    // Typing continues at the caret, after the emoji.
    await user.keyboard('!')
    expect(input).toHaveValue('Shelter🏠! open')
  })

  it('replaces a selection, and an emoji can push the draft over the limit', async () => {
    const user = userEvent.setup()
    renderInProviders(<Composer charLimit={10} />)
    const input = asTextArea(await screen.findByLabelText('Post text'))

    await user.type(input, 'Stay safe!')
    input.setSelectionRange(5, 9)
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    await user.keyboard('folded{Enter}')
    expect(input).toHaveValue('Stay 🙏!')
    expect(screen.getByTestId('char-ring')).toHaveAttribute('aria-label', '3 characters remaining')

    input.setSelectionRange(input.value.length, input.value.length)
    for (let i = 0; i < 4; i++) {
      await user.click(screen.getByRole('button', { name: 'Add emoji' }))
      await user.keyboard('fire{Enter}')
    }
    expect(screen.getByTestId('char-ring')).toHaveAttribute('data-state', 'over')
    expect(screen.getByRole('button', { name: 'Post' })).toBeDisabled()
  })

  it('Escape closes the picker and returns focus to the text area', async () => {
    const user = userEvent.setup()
    renderInProviders(<Composer />)
    const input = await screen.findByLabelText('Post text')

    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    expect(screen.getByRole('combobox', { name: 'Search emoji' })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(input).toHaveFocus()
  })

  it('is the participant-skinned panel inside the form, with no MUI or COBRA chrome', async () => {
    const user = userEvent.setup()
    renderInProviders(<Composer />)
    const form = await screen.findByTestId('composer')
    await user.click(within(form).getByRole('button', { name: 'Add emoji' }))
    const picker = within(form).getByTestId('emoji-picker')
    // Its className carries the composer's skin class (`.emojiPicker`, --pc-* tokens).
    expect(picker.className).toMatch(/emojiPicker/)
    expect(form.querySelector('[class*="Mui"], [class*="cobra" i]')).toBeNull()
  })

  it('makes no network request while the picker is used', async () => {
    const user = userEvent.setup()
    renderInProviders(<Composer />)
    const input = await screen.findByLabelText('Post text')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Add emoji' })).toBeEnabled())

    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const xhrSpy = vi.spyOn(XMLHttpRequest.prototype, 'open')
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    await user.keyboard('umbrella{ArrowRight}{ArrowLeft}{Enter}')
    await user.click(screen.getByRole('button', { name: 'Add emoji' }))
    await user.click(screen.getByRole('option', { name: 'thumbs up' }))

    expect(input).toHaveValue('☔👍')
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(xhrSpy).not.toHaveBeenCalled()
  })
})

describe('ComposeModal — emoji picker (story 12a)', () => {
  it('inserts in the modal; Escape closes only the picker, not the dialog', async () => {
    const user = userEvent.setup()
    renderInProviders(<ModalHost />)
    await user.click(await screen.findByRole('button', { name: 'Open composer' }))
    const dialog = await screen.findByRole('dialog', { name: 'New post' })
    const input = within(dialog).getByLabelText('Post text')
    await waitFor(() => expect(input).toHaveFocus())

    await user.type(input, 'Heads up ')
    await user.click(within(dialog).getByRole('button', { name: 'Add emoji' }))
    await user.keyboard('warning{Enter}')
    expect(input).toHaveValue('Heads up ⚠️')
    expect(input).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Add emoji' }))
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Emoji picker' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'New post' })).toBeInTheDocument()
    expect(screen.queryByTestId('compose-discard-confirm')).not.toBeInTheDocument()
    expect(input).toHaveFocus()

    // A second Escape, now in the text area, is the dialog's again (asks to discard).
    await user.keyboard('{Escape}')
    expect(screen.getByTestId('compose-discard-confirm')).toBeInTheDocument()
  })
})

describe('ReplyComposer — emoji picker (story 12a)', () => {
  it('inserts into the reply box at the caret', async () => {
    const user = userEvent.setup()
    renderInProviders(<ReplyComposer parentPostId="post-seed-mvega-question" parentHandle="mvega_fh" />)
    const form = await screen.findByTestId('reply-composer')
    const input = asTextArea(within(form).getByLabelText('Reply text'))

    await user.type(input, 'Thanks')
    await user.click(within(form).getByRole('button', { name: 'Add emoji' }))
    await user.click(within(form).getByRole('option', { name: 'folded hands' }))

    expect(input).toHaveValue('Thanks🙏')
    expect(input).toHaveFocus()
    expect(within(form).getByTestId('char-ring')).toHaveAttribute(
      'aria-label',
      '273 characters remaining',
    )
  })
})
