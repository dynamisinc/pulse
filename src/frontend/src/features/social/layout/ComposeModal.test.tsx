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
import { SCENARIO_NOW } from './testHarness'

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
})
