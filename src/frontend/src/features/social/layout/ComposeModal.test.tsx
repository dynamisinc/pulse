/**
 * features/social/layout/ComposeModal.test.tsx
 * ---------------------------------------------------------------------------
 * The compose dialog (demo-polish F1, "Nav rail" AC: "a Post button that opens the
 * composer in a modal (focus-trapped, Esc closes, focus returns to the button)").
 * Mounted beside a stand-in Post button, with the real `<Composer>` inside, under
 * the same Exercise / Session providers the channel uses.
 */
import { useRef, useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { SessionProvider } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { ComposeModal } from './ComposeModal'
import { SCENARIO_NOW } from './renderChannel.testUtils'

function Host() {
  const [open, setOpen] = useState(false)
  const postRef = useRef<HTMLButtonElement>(null)
  return (
    <div>
      <button ref={postRef} type="button" onClick={() => setOpen(true)}>
        Open composer
      </button>
      <button type="button">Behind the modal</button>
      {open && <ComposeModal onClose={() => setOpen(false)} returnFocusRef={postRef} />}
    </div>
  )
}

function renderHost() {
  setExerciseClock({ scenarioNow: () => SCENARIO_NOW })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <Host />
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
}

async function openDialog(user: ReturnType<typeof userEvent.setup>) {
  const opener = await screen.findByRole('button', { name: 'Open composer' })
  await user.click(opener)
  return { opener, dialog: await screen.findByRole('dialog') }
}

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
})

describe('ComposeModal', () => {
  it('is a labelled modal dialog wrapping the real composer', async () => {
    const user = userEvent.setup()
    renderHost()
    const { dialog } = await openDialog(user)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('New post')
    expect(within(dialog).getByTestId('composer')).toBeInTheDocument()
  })

  it('moves focus into the dialog, onto the post text box', async () => {
    const user = userEvent.setup()
    renderHost()
    const { dialog } = await openDialog(user)
    expect(within(dialog).getByRole('textbox', { name: 'Post text' })).toHaveFocus()
  })

  it('traps Tab inside the dialog (wraps forward and backward)', async () => {
    const user = userEvent.setup()
    renderHost()
    const { dialog } = await openDialog(user)

    // Walk forward until focus would leave: it must wrap to the first control.
    const first = within(dialog).getByRole('button', { name: 'Close' })
    const seen = new Set<Element>()
    for (let i = 0; i < 12; i += 1) {
      await user.tab()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
      if (document.activeElement !== null) seen.add(document.activeElement)
    }
    expect(seen.has(first)).toBe(true)
    expect(screen.getByRole('button', { name: 'Behind the modal' })).not.toHaveFocus()

    // Backward from the first control wraps to the last.
    first.focus()
    await user.tab({ shift: true })
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
    expect(first).not.toHaveFocus()
  })

  it('closes on Escape and returns focus to the button that opened it', async () => {
    const user = userEvent.setup()
    renderHost()
    const { opener } = await openDialog(user)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes from the Close button and returns focus', async () => {
    const user = userEvent.setup()
    renderHost()
    const { opener, dialog } = await openDialog(user)
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  it('closes on a press on the backdrop, but not on a press inside the dialog', async () => {
    const user = userEvent.setup()
    renderHost()
    const { dialog } = await openDialog(user)

    await user.click(within(dialog).getByRole('textbox', { name: 'Post text' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()

    await user.click(screen.getByTestId('compose-backdrop'))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('closes itself after a successful post (the composer\'s onPosted)', async () => {
    const user = userEvent.setup()
    renderHost()
    const { opener, dialog } = await openDialog(user)

    await user.type(within(dialog).getByRole('textbox', { name: 'Post text' }), 'Hello Fairhaven')
    await user.click(within(dialog).getByRole('button', { name: 'Post' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(opener).toHaveFocus()
  })

  describe('over a draft (demo-polish F1 L7)', () => {
    async function openWithDraft(user: ReturnType<typeof userEvent.setup>) {
      const opened = await openDialog(user)
      await user.type(
        within(opened.dialog).getByRole('textbox', { name: 'Post text' }),
        'Boil water until further notice',
      )
      return opened
    }

    it('Escape asks "Discard this draft?" instead of closing, with Keep editing focused', async () => {
      const user = userEvent.setup()
      renderHost()
      const { dialog } = await openWithDraft(user)

      await user.keyboard('{Escape}')

      expect(within(dialog).getByRole('alert')).toHaveTextContent('Discard this draft?')
      expect(screen.getByRole('dialog')).toBeInTheDocument()
      expect(within(dialog).getByRole('button', { name: 'Keep editing' })).toHaveFocus()
    })

    it('Escape on the question means "keep editing" and returns to the text box, draft intact', async () => {
      const user = userEvent.setup()
      renderHost()
      const { dialog } = await openWithDraft(user)
      await user.keyboard('{Escape}')

      await user.keyboard('{Escape}')

      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
      const textBox = within(dialog).getByRole('textbox', { name: 'Post text' })
      expect(textBox).toHaveFocus()
      expect(textBox).toHaveValue('Boil water until further notice')
    })

    it('Discard closes and returns focus to the opener', async () => {
      const user = userEvent.setup()
      renderHost()
      const { opener, dialog } = await openWithDraft(user)
      await user.keyboard('{Escape}')

      await user.click(within(dialog).getByRole('button', { name: 'Discard' }))

      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(opener).toHaveFocus()
    })

    it('the Close button and a backdrop press ask too', async () => {
      const user = userEvent.setup()
      renderHost()
      const { dialog } = await openWithDraft(user)

      await user.click(within(dialog).getByRole('button', { name: 'Close' }))
      expect(within(dialog).getByRole('alert')).toBeInTheDocument()
      await user.click(within(dialog).getByRole('button', { name: 'Keep editing' }))
      expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()

      await user.click(screen.getByTestId('compose-backdrop'))
      expect(within(dialog).getByRole('alert')).toBeInTheDocument()
      expect(screen.getByRole('dialog')).toBeInTheDocument()
    })

    it('freezes the draft while the question shows (the composer is inert)', async () => {
      const user = userEvent.setup()
      renderHost()
      const { dialog } = await openWithDraft(user)
      await user.keyboard('{Escape}')

      const textBox = within(dialog).getByRole('textbox', { name: 'Post text' })
      expect(textBox.closest('[inert]')).not.toBeNull()
    })

    it('a whitespace-only draft is not a draft: it closes at once', async () => {
      const user = userEvent.setup()
      renderHost()
      const { dialog, opener } = await openDialog(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Post text' }), '   ')
      await user.keyboard('{Escape}')
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(opener).toHaveFocus()
    })
  })

  describe('focus trap ignores unrendered controls (demo-polish F1 L8)', () => {
    const original = Object.getOwnPropertyDescriptor(Element.prototype, 'checkVisibility')

    afterEach(() => {
      if (original !== undefined) Object.defineProperty(Element.prototype, 'checkVisibility', original)
      else Reflect.deleteProperty(Element.prototype, 'checkVisibility')
    })

    it('does not treat a checkVisibility()-false control as the last Tab stop', async () => {
      // jsdom has no layout, so model a control the browser reports as unrendered
      // (e.g. `display:none` through a class, which `[hidden]` cannot see).
      Object.defineProperty(Element.prototype, 'checkVisibility', {
        configurable: true,
        value(this: Element) {
          return !this.hasAttribute('data-test-unrendered')
        },
      })
      const user = userEvent.setup()
      renderHost()
      const { dialog } = await openDialog(user)
      await user.type(within(dialog).getByRole('textbox', { name: 'Post text' }), 'x')

      // Post is the last control in DOM order and is now enabled; mark it unrendered.
      const post = within(dialog).getByRole('button', { name: 'Post' })
      post.setAttribute('data-test-unrendered', '')
      const addPhotos = within(dialog).getByRole('button', { name: 'Add photos' })
      addPhotos.focus()

      await user.tab()

      // Tab wrapped from the last RENDERED control to the first, instead of landing on Post.
      expect(post).not.toHaveFocus()
      expect(dialog).toContainElement(document.activeElement as HTMLElement)
      expect(within(dialog).getByRole('button', { name: 'Close' })).toHaveFocus()
    })
  })
})
