/**
 * features/controller/liveWorld/TakedownAction.test.tsx
 * ---------------------------------------------------------------------------
 * The Live world row's **Take down** action (demo-polish C5,
 * docs/features/demo-polish/22-takedown-ui.md; CTL-025, CTL-033, XC-004, DP-9, NFR-001), one
 * `describe` per acceptance criterion:
 *
 *  1. TWO CLICKS, WITH A CATEGORY  Take down opens a confirm popover with the four-way category
 *     radio group (default Other) and "Confirm take down"; nothing is sent until the second click;
 *     the chosen category reaches the service; the step resets to Other each time it opens.
 *     Fully keyboard-operable: Enter opens with focus on the selected category, arrows change it,
 *     Tab wraps inside the step, Esc / Cancel cancel and focus returns to the control.
 *  2. VISIBLE OUTCOME  pending ("Taking down…", ignores a second activation), success (a
 *     confirmation "Taken down · {category}" as icon + text, nothing actionable left; the row's own
 *     persistent REMOVED marker is the column's, via `isRowRemoved` - so a takedown made elsewhere
 *     or before a remount renders NOTHING here), failure (the server's message + Retry that
 *     re-sends the confirmed category, + Dismiss); ABSENT - not disabled - for a non-controller.
 *  2b. FOCUS (Gate-1 M-1 / M-2)  Dismiss and Retry put focus back on the control; a settled request
 *     takes focus only when it was lost, never off an input the controller moved to (so a following
 *     Space cannot re-send); a polite announcement stands in when focus does not move.
 *  2c. NON-MODAL STEP (Gate-1 M-3)  opening the step sets no aria-hidden on the app root or its
 *     siblings and lays no backdrop; a later `[aria-modal]` stays reachable.
 *  3. ONE TELEMETRY EVENT  exactly one XC-004 `steering_action` per SUCCESSFUL takedown with the
 *     closed shape (channel system, actor system + acting human + role, target post + id, payload
 *     action + category); none for a cancel, a failure or someone else's takedown; none carrying
 *     text.
 *  4. FOCUS-TRAP CONTRACT  the step stands aside for any other `[aria-modal]` (the shell overlay):
 *     no focus taken on open, no Tab wrap, no pull-back.
 *  5. STAFF WORLD  COBRA controls, FontAwesome icons, the dialog is portalled (the column ignores
 *     J/K/R/N from outside its list DOM).
 *
 * The service is the real mock-mode one (seeded `postStore`) unless a test overrides
 * `takeDownPost`; the scope is mocked to a fixed exercise; the exercise clock is fixed.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { useControllerIdentity } from '../identity/controllerIdentity'
import {
  TakedownError,
  takeDownPost,
  type TakedownCategory,
} from '../services/takedownService'
import { TakedownAction } from './TakedownAction'
import type { LiveWorldPost } from './liveWorldModel'

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    useExerciseContext: () => ({
      exerciseId: 'ex-mock-0001',
      exerciseName: 'Mock Exercise',
      timeZone: 'America/New_York',
    }),
  }
})

vi.mock('../identity/controllerIdentity', async importOriginal => {
  const actual = await importOriginal<typeof import('../identity/controllerIdentity')>()
  return { ...actual, useControllerIdentity: vi.fn(actual.useControllerIdentity) }
})

vi.mock('../services/takedownService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/takedownService')>()
  return { ...actual, takeDownPost: vi.fn(actual.takeDownPost) }
})

const mockedIdentity = vi.mocked(useControllerIdentity)
const mockedTakeDown = vi.mocked(takeDownPost)
const realTakeDown = mockedTakeDown.getMockImplementation()
const realIdentity = mockedIdentity.getMockImplementation()

/** A seeded post, so the real mock-mode service finds it in `postStore`. */
const POST: LiveWorldPost = {
  id: 'post-seed-fwupd-rumor',
  authorPersonaId: 'persona-fairhavenwaterupd',
  authorHandle: 'FairhavenWaterUpd',
  authorDisplayName: 'Fairhaven Water Update',
  authorVerified: false,
  text: 'DO NOT drink the water, the plant is poisoned #WaterIssues',
  scenarioTime: '2033-09-04T13:45:00Z',
  counts: { reply: 0, repost: 0, like: 0 },
}

const TRIGGER_NAME = 'Take down post by Fairhaven Water Update'

function renderAction(post: LiveWorldPost = POST) {
  const ui = (
    <ThemeProvider theme={cobraTheme}>
      <TakedownAction post={post} />
    </ThemeProvider>
  )
  const utils = render(ui)
  return { ...utils, rerenderAction: () => utils.rerender(ui) }
}

function trigger(): HTMLElement {
  return screen.getByTestId('takedown-trigger')
}

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(event => event.eventType === 'steering_action')
}

/** A promise the test settles by hand, for the pending state. */
function deferred() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  resetTelemetryBuffer()
  postStore.resetForTests()
  removedPosts.resetForTests()
  mockedTakeDown.mockReset()
  if (realTakeDown) mockedTakeDown.mockImplementation(realTakeDown)
  mockedIdentity.mockReset()
  if (realIdentity) mockedIdentity.mockImplementation(realIdentity)
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  postStore.resetForTests()
  removedPosts.resetForTests()
})

describe('TakedownAction - AC1: two clicks, with a category', () => {
  it('offers a Take down control, and opens the confirm step with the four categories, Other selected', async () => {
    const user = userEvent.setup()
    renderAction()

    const button = screen.getByRole('button', { name: TRIGGER_NAME })
    expect(button).toHaveTextContent('Take down')
    expect(button).toHaveAttribute('aria-haspopup', 'dialog')
    expect(button).toHaveAttribute('aria-expanded', 'false')

    await user.click(button)

    const dialog = await screen.findByRole('dialog', { name: 'Take down this post?' })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(dialog).toHaveAccessibleDescription(/disappears from every participant feed/i)
    const group = within(dialog).getByRole('radiogroup', { name: 'Category' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map(radio => (radio as HTMLInputElement).value)).toEqual([
      'inappropriate',
      'pii',
      'real-world-reference',
      'other',
    ])
    expect(within(group).getByRole('radio', { name: 'Inappropriate' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: 'PII' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Real-world reference' })).not.toBeChecked()
    expect(within(group).getByRole('radio', { name: 'Other' })).toBeChecked()
    expect(within(dialog).getByRole('button', { name: 'Confirm take down' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('sends NOTHING on the first click: the request needs the second, deliberate activation', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await screen.findByRole('dialog')

    expect(mockedTakeDown).not.toHaveBeenCalled()
    expect(steeringEvents()).toHaveLength(0)
    expect(removedPosts.has(POST.id)).toBe(false)
  })

  it('two clicks take the post down with the default category (other)', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
    expect(mockedTakeDown).toHaveBeenCalledWith(POST.id, 'other')
    expect(await screen.findByTestId('takedown-confirmation')).toBeInTheDocument()
  })

  it.each<[string, TakedownCategory]>([
    ['Inappropriate', 'inappropriate'],
    ['PII', 'pii'],
    ['Real-world reference', 'real-world-reference'],
    ['Other', 'other'],
  ])('sends the chosen category: %s -> %s', async (label, wire) => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: label }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))

    expect(mockedTakeDown).toHaveBeenCalledWith(POST.id, wire)
    await screen.findByTestId('takedown-confirmation')
    expect(steeringEvents()[0]?.payload).toEqual({ action: 'takedown', category: wire })
  })

  it('resets to Other every time the step opens (a cancelled choice is not remembered)', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    expect(screen.getByRole('radio', { name: 'PII' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    await user.click(trigger())

    expect(await screen.findByRole('radio', { name: 'Other' })).toBeChecked()
    expect(screen.getByRole('radio', { name: 'PII' })).not.toBeChecked()
  })

  it('cancelling sends nothing and emits nothing', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedTakeDown).not.toHaveBeenCalled()
    expect(steeringEvents()).toHaveLength(0)
    expect(screen.queryByTestId('takedown-confirmation')).not.toBeInTheDocument()
  })

  it('clicking elsewhere (click-away) cancels it and returns focus to the control', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await screen.findByRole('dialog')

    await user.click(document.body)

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedTakeDown).not.toHaveBeenCalled()
    expect(trigger()).toHaveFocus()
  })

  it('click-away into another field leaves focus in that field (it is not stolen back)', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={cobraTheme}>
        <TakedownAction post={POST} />
        <input aria-label="composer" />
      </ThemeProvider>,
    )
    await user.click(trigger())
    await screen.findByRole('dialog')

    await user.click(screen.getByLabelText('composer'))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByLabelText('composer')).toHaveFocus()
    expect(mockedTakeDown).not.toHaveBeenCalled()
  })

  it('clicking the control again while the step is open closes it (a toggle)', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await screen.findByRole('dialog')

    await user.click(trigger())

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
    expect(trigger()).toHaveFocus()
  })
})

describe('TakedownAction - AC1: fully keyboard-operable', () => {
  it('Enter on the control opens the step with focus on the selected category', async () => {
    const user = userEvent.setup()
    renderAction()

    trigger().focus()
    await user.keyboard('{Enter}')

    const other = await screen.findByRole('radio', { name: 'Other' })
    expect(other).toHaveFocus()
  })

  it('Space on the control opens it too', async () => {
    const user = userEvent.setup()
    renderAction()

    trigger().focus()
    await user.keyboard(' ')

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('arrow keys change the category, and the keyboard alone completes the take down', async () => {
    const user = userEvent.setup()
    renderAction()

    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'Real-world reference' })).toBeChecked()
    await user.keyboard('{ArrowUp}')
    expect(screen.getByRole('radio', { name: 'PII' })).toBeChecked()

    await user.tab() // Cancel
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab() // Confirm take down
    expect(screen.getByRole('button', { name: 'Confirm take down' })).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(mockedTakeDown).toHaveBeenCalledWith(POST.id, 'pii')
    expect(await screen.findByTestId('takedown-confirmation')).toBeInTheDocument()
  })

  it('Tab and Shift+Tab wrap inside the step - focus never leaves it', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog')
    expect(screen.getByRole('radio', { name: 'Other' })).toHaveFocus()

    // Forward past the last control wraps to the first (the selected radio).
    await user.tab()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Confirm take down' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('radio', { name: 'Other' })).toHaveFocus()

    // Backwards from the first wraps to the last.
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Confirm take down' })).toHaveFocus()
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('only the selected radio is a Tab stop (one stop for the group, like a native radio group)', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.keyboard('{ArrowUp}{ArrowUp}')

    await user.tab({ shift: true })

    // Shift+Tab from the selected radio wraps to Confirm, not to a sibling radio.
    expect(screen.getByRole('button', { name: 'Confirm take down' })).toHaveFocus()
  })

  it('Esc cancels: nothing is sent, the step closes and focus returns to the control', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(mockedTakeDown).not.toHaveBeenCalled()
    expect(steeringEvents()).toHaveLength(0)
    expect(trigger()).toHaveFocus()
    expect(trigger()).toHaveAttribute('aria-expanded', 'false')
  })

  it('Esc is swallowed by the step: it does not reach a key handler higher in the console', async () => {
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    render(
      <ThemeProvider theme={cobraTheme}>
        <div onKeyDown={onKeyDown}>
          <TakedownAction post={POST} />
        </div>
      </ThemeProvider>,
    )
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    onKeyDown.mockClear()

    await user.keyboard('{Escape}')

    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it('Cancel by keyboard returns focus to the control too', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger()).toHaveFocus()
  })
})

describe('TakedownAction - AC2: the visible outcome', () => {
  it('while the request is in flight the control says "Taking down…", keeps focus and ignores a second activation', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mockedTakeDown.mockReturnValue(pending.promise)
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const busy = screen.getByTestId('takedown-trigger')
    expect(busy).toHaveTextContent('Taking down…')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveAccessibleName('Taking down the post by Fairhaven Water Update')
    expect(busy).toHaveFocus()

    await user.click(busy)
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
    // Nothing is recorded as done until the server says so.
    expect(steeringEvents()).toHaveLength(0)
    expect(screen.queryByTestId('takedown-confirmation')).not.toBeInTheDocument()

    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })
    expect(await screen.findByTestId('takedown-confirmation')).toBeInTheDocument()
  })

  it('success replaces the control with "Taken down · {category}" as ICON + TEXT; nothing actionable is left', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const confirmation = await screen.findByTestId('takedown-confirmation')
    expect(confirmation).toHaveTextContent('Taken down · PII')
    expect(confirmation.querySelector('svg')).not.toBeNull() // the icon (never colour alone)
    // Distinct from the column's REMOVED marker: never the word "Removed" here.
    expect(screen.queryByText(/removed/i)).not.toBeInTheDocument()
    // Focus lands here, so it is named for the post (and starts with the visible words).
    expect(confirmation).toHaveAccessibleName(
      'Taken down · PII. The post by Fairhaven Water Update is no longer shown to participants.',
    )
    // The control is gone: a repeat is impossible from this row.
    expect(screen.queryByTestId('takedown-trigger')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('the focused confirmation is NOT a live region (focus already announces it - no double announce)', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const confirmation = await screen.findByTestId('takedown-confirmation')

    expect(confirmation).toHaveFocus()
    expect(confirmation).not.toHaveAttribute('role', 'status')
    expect(confirmation).not.toHaveAttribute('role', 'alert')
    expect(confirmation.closest('[aria-live]')).toBeNull()
    // And the polite region stays quiet when focus itself carries the news.
    expect(screen.getByTestId('takedown-announcer')).toBeEmptyDOMElement()
  })

  it('moves focus to the confirmation after its OWN success when the control that held it is gone', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const confirmation = await screen.findByTestId('takedown-confirmation')

    expect(confirmation).toHaveFocus()
    expect(confirmation).toHaveAttribute('tabindex', '-1')
  })

  it('failure shows the server message with Retry, moves focus to Retry, and emits no telemetry', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValue(new TakedownError('The server is busy right now. Try again in a moment.', 503))
    renderAction()

    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('The server is busy right now. Try again in a moment.')
    expect(alert.querySelector('svg')).not.toBeNull()
    const retry = within(alert).getByRole('button', { name: /Retry/ })
    expect(retry).toHaveFocus()
    expect(steeringEvents()).toHaveLength(0)
    expect(screen.queryByTestId('takedown-confirmation')).not.toBeInTheDocument()
    expect(screen.queryByTestId('takedown-trigger')).not.toBeInTheDocument()
  })

  it('Retry re-sends the category the controller ALREADY confirmed (no second confirm), then succeeds once', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValueOnce(new TakedownError('The server is busy right now.', 503))
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'Real-world reference' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))
    await screen.findByRole('alert')

    // The retry goes through the real service now.
    await user.click(screen.getByRole('button', { name: /Retry/ }))

    expect(mockedTakeDown).toHaveBeenCalledTimes(2)
    expect(mockedTakeDown).toHaveBeenLastCalledWith(POST.id, 'real-world-reference')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await screen.findByTestId('takedown-confirmation')).toBeInTheDocument()
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.payload).toEqual({
      action: 'takedown',
      category: 'real-world-reference',
    })
  })

  it('a second failure keeps the alert (and still emits nothing)', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValue(new TakedownError('That post no longer exists in this exercise.', 404))
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /Retry/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('no longer exists')
    expect(mockedTakeDown).toHaveBeenCalledTimes(2)
    expect(steeringEvents()).toHaveLength(0)
  })

  it('Dismiss clears the failure and offers Take down again (the dialog is back to Other)', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValueOnce(new TakedownError('boom', 500))
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))
    await screen.findByRole('alert')

    await user.click(screen.getByRole('button', { name: /Dismiss/ }))

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.click(trigger())
    expect(await screen.findByRole('radio', { name: 'Other' })).toBeChecked()
  })

  it('a non-TakedownError failure still shows a plain sentence, never a stack', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValue(new Error('TypeError: x is undefined at Object.<anonymous> (a.js:1:2)'))
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const alert = await screen.findByRole('alert')

    expect(alert).toHaveTextContent('The post was not taken down. Try again.')
    expect(alert).not.toHaveTextContent(/TypeError|a\.js/)
  })

  it('renders the server message as TEXT, never as HTML', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValue(new TakedownError('<img src=x onerror=alert(1)> bad', 400))
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const alert = await screen.findByRole('alert')

    expect(alert.querySelector('img')).toBeNull()
    expect(alert).toHaveTextContent('<img src=x onerror=alert(1)> bad')
  })

  it('renders NOTHING for a post that is ALREADY taken down (the column\'s REMOVED marker covers it)', () => {
    removedPosts.add(POST.id)

    const { container } = renderAction()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('takedown-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText(/removed|taken down/i)).not.toBeInTheDocument()
  })

  it('goes quiet when ANOTHER controller\'s takedown reaches this tab - no focus, no telemetry, no second marker', async () => {
    const { container } = renderAction()
    expect(trigger()).toBeInTheDocument()

    act(() => removedPosts.add(POST.id))

    expect(container).toBeEmptyDOMElement()
    expect(document.activeElement).toBe(document.body)
    expect(steeringEvents()).toHaveLength(0)
    expect(mockedTakeDown).not.toHaveBeenCalled()
  })

  it('renders nothing after a remount (no category is known; the column\'s marker is the persistent state)', async () => {
    const user = userEvent.setup()
    const first = renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    await screen.findByTestId('takedown-confirmation')
    first.unmount()

    const { container } = renderAction()

    expect(container).toBeEmptyDOMElement()
  })

  it('a different post\'s removal leaves this row alone', () => {
    renderAction()

    act(() => removedPosts.add('some-other-post'))

    expect(trigger()).toBeInTheDocument()
    expect(screen.queryByTestId('takedown-confirmation')).not.toBeInTheDocument()
  })

  it('survives a parent re-render with the confirm step open (state is the row\'s, not the render\'s)', async () => {
    const user = userEvent.setup()
    const { rerenderAction } = renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'PII' }))

    rerenderAction()

    expect(screen.getByRole('radio', { name: 'PII' })).toBeChecked()
  })
})

describe('TakedownAction - CTL-033: absent, not disabled, for a non-controller', () => {
  it('renders nothing at all when the role is not controller', () => {
    mockedIdentity.mockReturnValue({
      actingHumanId: 'human-evaluator-1',
      callSign: 'EVAL-1',
      role: 'evaluator' as unknown as 'controller',
      isLead: false,
    })

    const { container } = renderAction()

    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByTestId('takedown-trigger')).not.toBeInTheDocument()
    expect(screen.queryByText(/take down/i)).not.toBeInTheDocument()
  })

  it('renders nothing for a non-controller even when the post is already removed', () => {
    mockedIdentity.mockReturnValue({
      actingHumanId: 'human-planner-1',
      callSign: 'PLAN-1',
      role: 'planner' as unknown as 'controller',
      isLead: false,
    })
    removedPosts.add(POST.id)

    const { container } = renderAction()

    expect(container).toBeEmptyDOMElement()
  })
})

describe('TakedownAction - AC3: exactly one XC-004 steering_action', () => {
  it('emits ONE event on success, in the closed shape (system actor + acting human + role, post target)', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('radio', { name: 'Inappropriate' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))
    await screen.findByTestId('takedown-confirmation')

    const events = steeringEvents()
    expect(events).toHaveLength(1)
    const event = events[0]
    expect(event?.eventType).toBe('steering_action')
    expect(event?.channel).toBe('system')
    expect(event?.actor).toEqual({
      kind: 'system',
      actingHumanId: 'human-controller-01',
      role: 'controller',
    })
    expect(event?.target).toEqual({ entityType: 'post', entityId: POST.id })
    expect(event?.payload).toEqual({ action: 'takedown', category: 'inappropriate' })
    expect(event?.exerciseId).toBe('ex-mock-0001')
    expect(event?.timeZone).toBe('America/New_York')
    expect(event?.scenarioTime).toBe('2033-09-04T14:00:30.000Z')
  })

  it('carries no post text, author handle or persona id (the event names the post by id only)', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    await screen.findByTestId('takedown-confirmation')

    const serialized = JSON.stringify(steeringEvents())
    expect(serialized).not.toContain('poisoned')
    expect(serialized).not.toContain(POST.authorHandle)
    expect(serialized).not.toContain(POST.authorPersonaId)
  })

  it('emits nothing for a cancel, nothing for a failure, and nothing extra for the idempotent repeat of a re-render', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValueOnce(new TakedownError('nope', 500))
    const { rerenderAction } = renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    await screen.findByRole('alert')
    expect(steeringEvents()).toHaveLength(0)

    await user.click(screen.getByRole('button', { name: /Retry/ }))
    await screen.findByTestId('takedown-confirmation')
    rerenderAction()
    await act(async () => {})

    expect(steeringEvents()).toHaveLength(1)
  })

  it('is recorded even when the row unmounts while the request is in flight (the takedown happened)', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mockedTakeDown.mockReturnValue(pending.promise)
    const { unmount } = renderAction()
    await user.click(trigger())
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    unmount()

    await act(async () => {
      pending.resolve()
    })

    expect(steeringEvents()).toHaveLength(1)
  })

  it('does not emit for a takedown another controller performed', () => {
    renderAction()
    act(() => removedPosts.add(POST.id))
    expect(steeringEvents()).toHaveLength(0)
  })

  it('does not double-submit when the confirm button is activated twice in the same tick', async () => {
    const pending = deferred()
    mockedTakeDown.mockReturnValue(pending.promise)
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    const confirm = await screen.findByRole('button', { name: 'Confirm take down' })

    await act(async () => {
      confirm.click()
      confirm.click()
    })

    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })
    await waitFor(() => expect(steeringEvents()).toHaveLength(1))
  })
})

describe('TakedownAction - the focus-trap contract (F2: stand aside for the shell overlay)', () => {
  /** A stand-in for the shell overlay: an `[aria-modal]` element outside the step. */
  function mountOverlay(): { button: HTMLButtonElement; remove(): void } {
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'alertdialog')
    overlay.setAttribute('aria-modal', 'true')
    overlay.setAttribute('data-shell-layer', 'overlay')
    const button = document.createElement('button')
    button.textContent = 'Resume'
    overlay.appendChild(button)
    document.body.appendChild(overlay)
    return { button, remove: () => overlay.remove() }
  }

  it('control: with NO other modal, focus that moves outside ENDS the step and stays where it went', async () => {
    const user = userEvent.setup()
    renderAction()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    try {
      trigger().focus()
      await user.keyboard('{Enter}')
      await screen.findByRole('dialog')

      act(() => outside.focus())

      // Never pulled back (that would fight a click into another field) - the step simply yields.
      expect(outside).toHaveFocus()
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
      expect(mockedTakeDown).not.toHaveBeenCalled()
    } finally {
      outside.remove()
    }
  })

  it('takes no focus on open while another modal is mounted', async () => {
    const user = userEvent.setup()
    renderAction()
    const overlay = mountOverlay()
    try {
      overlay.button.focus()
      // Open via the pointer so the control's own focus is not what is being asserted.
      await user.click(trigger())
      const dialog = await screen.findByRole('dialog')

      expect(dialog).toBeInTheDocument()
      expect(screen.getByRole('radio', { name: 'Other' })).not.toHaveFocus()
      expect(dialog).not.toContainElement(document.activeElement as HTMLElement)
    } finally {
      overlay.remove()
    }
  })

  it('does not pull focus back from the other modal: the step yields and the overlay keeps focus', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    const overlay = mountOverlay()
    try {
      act(() => overlay.button.focus())

      expect(overlay.button).toHaveFocus()
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take down this post?' }))
        .not.toBeInTheDocument())
      expect(overlay.button).toHaveFocus()
    } finally {
      overlay.remove()
    }
  })

  it('does not wrap Tab while another modal is mounted (the keydown is left alone)', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    const confirm = screen.getByRole('button', { name: 'Confirm take down' })
    act(() => confirm.focus())
    const overlay = mountOverlay()
    try {
      const press = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      act(() => {
        confirm.dispatchEvent(press)
      })

      expect(press.defaultPrevented).toBe(false)
    } finally {
      overlay.remove()
    }
  })

  it('does not take focus back to the control on close while another modal is mounted', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    const overlay = mountOverlay()
    try {
      await user.click(screen.getByRole('button', { name: 'Cancel' }))
      await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take down this post?' }))
        .not.toBeInTheDocument())

      expect(trigger()).not.toHaveFocus()
    } finally {
      overlay.remove()
    }
  })
})

describe('TakedownAction - AC6: staff world only', () => {
  it('portals the confirm step out of the row (the column ignores keys that originate outside its list)', async () => {
    const user = userEvent.setup()
    const { container } = renderAction()

    await user.click(trigger())
    const dialog = await screen.findByRole('dialog')

    expect(container).not.toContainElement(dialog)
    expect(document.body).toContainElement(dialog)
  })

  it('stops a keypress inside the step reaching a row-level handler as a row key (it is outside the list DOM)', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog')

    // The dialog is not inside any [data-live-world-row] element: the column's J/K/R/N handler
    // requires the target to be inside its list DOM, so these keys cannot reach it.
    expect(dialog.closest('[data-live-world-row]')).toBeNull()
  })

  it('uses FontAwesome icons (svg), never an icon font', async () => {
    const user = userEvent.setup()
    renderAction()
    expect(trigger().querySelector('svg[data-icon]')).not.toBeNull()

    await user.click(trigger())
    const dialog = await screen.findByRole('dialog')

    expect(dialog.querySelector('svg[data-icon]')).not.toBeNull()
    expect(document.querySelector('.material-icons, .material-symbols-outlined')).toBeNull()
  })

  it('the post author is named in the control and in the step (the controller sees exactly which post)', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    const dialog = await screen.findByRole('dialog')

    expect(trigger()).toHaveAccessibleName(TRIGGER_NAME)
    expect(dialog).toHaveAccessibleDescription(/Fairhaven Water Update/)
  })
})

describe('TakedownAction - Gate-1 M-1: Dismiss and Retry never drop focus to <body>', () => {
  /** Opens the step by keyboard, confirms, and waits for the failure box (Retry holds focus). */
  async function reachFailure(user: ReturnType<typeof userEvent.setup>) {
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    await screen.findByRole('alert')
    expect(screen.getByTestId('takedown-retry')).toHaveFocus()
  }

  it('Dismiss puts focus back on the Take down control', async () => {
    const user = userEvent.setup()
    mockedTakeDown.mockRejectedValueOnce(new TakedownError('boom', 500))
    renderAction()
    await reachFailure(user)

    await user.tab() // Retry -> Dismiss
    expect(screen.getByTestId('takedown-dismiss')).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(trigger()).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
    // ... and it is a working control again, from the keyboard.
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
  })

  it('during a Retry the pending control holds focus - never <body>', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mockedTakeDown
      .mockRejectedValueOnce(new TakedownError('boom', 500))
      .mockReturnValueOnce(pending.promise)
    renderAction()
    await reachFailure(user)

    await user.keyboard('{Enter}') // Retry

    const busy = screen.getByTestId('takedown-trigger')
    expect(busy).toHaveTextContent('Taking down…')
    expect(busy).toHaveAttribute('aria-disabled', 'true')
    expect(busy).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
    expect(mockedTakeDown).toHaveBeenCalledTimes(2)
    // A stray key on the pending control cannot start a third request.
    await user.keyboard('{Enter}')
    expect(mockedTakeDown).toHaveBeenCalledTimes(2)

    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })
    // The pending control had focus, so the confirmation takes it.
    expect(await screen.findByTestId('takedown-confirmation')).toHaveFocus()
  })

  it('a Retry that fails again hands focus back to Retry', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mockedTakeDown
      .mockRejectedValueOnce(new TakedownError('boom', 500))
      .mockReturnValueOnce(pending.promise)
    renderAction()
    await reachFailure(user)
    await user.keyboard('{Enter}') // Retry -> pending control holds focus
    expect(trigger()).toHaveFocus()

    await act(async () => {
      pending.reject(new TakedownError('still down', 503))
    })

    expect(await screen.findByRole('alert')).toHaveTextContent('still down')
    expect(screen.getByTestId('takedown-retry')).toHaveFocus()
  })

  it('Retry by POINTER also lands on the control that replaces the failure box', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    mockedTakeDown
      .mockRejectedValueOnce(new TakedownError('boom', 500))
      .mockReturnValueOnce(pending.promise)
    renderAction()
    await reachFailure(user)

    await user.click(screen.getByTestId('takedown-retry'))

    expect(trigger()).toHaveFocus()
    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })
    await screen.findByTestId('takedown-confirmation')
  })
})

describe('TakedownAction - Gate-1 M-2: a settled request never steals focus', () => {
  function renderWithField() {
    return render(
      <ThemeProvider theme={cobraTheme}>
        <TakedownAction post={POST} />
        <input aria-label="composer" />
      </ThemeProvider>,
    )
  }

  /** Confirms with the deferred request pending, then parks focus where `park` says. */
  async function pendingThenPark(
    user: ReturnType<typeof userEvent.setup>,
    pending: ReturnType<typeof deferred>,
    park: () => Promise<void> | void,
  ) {
    mockedTakeDown.mockReturnValue(pending.promise)
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(trigger()).toHaveTextContent('Taking down…')
    await park()
  }

  it('SUCCESS with focus in an unrelated input: focus stays there, the news arrives politely', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    renderWithField()
    await pendingThenPark(user, pending, () => user.click(screen.getByLabelText('composer')))
    const field = screen.getByLabelText('composer')
    expect(field).toHaveFocus()

    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })

    const confirmation = await screen.findByTestId('takedown-confirmation')
    expect(confirmation).toHaveTextContent('Taken down · Other')
    expect(field).toHaveFocus()
    expect(confirmation).not.toHaveFocus()
    expect(screen.getByTestId('takedown-announcer')).toHaveTextContent(
      'The post by Fairhaven Water Update is taken down: Other.',
    )
    // What the controller types next goes to their field.
    await user.keyboard('hello')
    expect(field).toHaveValue('hello')
    expect(steeringEvents()).toHaveLength(1)
  })

  it('FAILURE with focus in an unrelated input: focus stays, and a following Space cannot re-send', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    renderWithField()
    await pendingThenPark(user, pending, () => user.click(screen.getByLabelText('composer')))
    const field = screen.getByLabelText('composer')
    expect(mockedTakeDown).toHaveBeenCalledTimes(1)

    await act(async () => {
      pending.reject(new TakedownError('The server is busy right now.', 503))
    })

    // The alert announces itself; it does not drag focus onto Retry.
    expect(await screen.findByRole('alert')).toHaveTextContent('The server is busy right now.')
    expect(screen.getByTestId('takedown-retry')).not.toHaveFocus()
    expect(field).toHaveFocus()
    await user.keyboard(' ')
    await user.keyboard('{Enter}')
    expect(field).toHaveValue(' ')
    expect(mockedTakeDown).toHaveBeenCalledTimes(1)
    expect(steeringEvents()).toHaveLength(0)
  })

  it('FAILURE with focus on another row-like control: focus stays on it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    render(
      <ThemeProvider theme={cobraTheme}>
        <TakedownAction post={POST} />
        <button type="button">next row</button>
      </ThemeProvider>,
    )
    await pendingThenPark(user, pending, () => screen.getByRole('button', { name: 'next row' }).focus())

    await act(async () => {
      pending.reject(new TakedownError('nope', 500))
    })

    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'next row' })).toHaveFocus()
  })

  it('SUCCESS when focus fell to <body> during the request: the confirmation takes it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    renderAction()
    await pendingThenPark(user, pending, async () => {
      await user.click(document.body)
    })
    expect(document.activeElement).toBe(document.body)

    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })

    expect(await screen.findByTestId('takedown-confirmation')).toHaveFocus()
  })

  it('FAILURE when focus fell to <body> during the request: Retry takes it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    renderAction()
    await pendingThenPark(user, pending, async () => {
      await user.click(document.body)
    })

    await act(async () => {
      pending.reject(new TakedownError('nope', 500))
    })

    await screen.findByRole('alert')
    expect(screen.getByTestId('takedown-retry')).toHaveFocus()
  })

  it('SUCCESS when the pending control still holds focus: the confirmation takes it', async () => {
    const user = userEvent.setup()
    const pending = deferred()
    renderAction()
    await pendingThenPark(user, pending, () => {})
    expect(trigger()).toHaveFocus()

    await act(async () => {
      removedPosts.add(POST.id)
      pending.resolve()
    })

    expect(await screen.findByTestId('takedown-confirmation')).toHaveFocus()
    expect(screen.getByTestId('takedown-announcer')).toBeEmptyDOMElement()
  })
})

describe('TakedownAction - Gate-1 M-3: the confirm step is non-modal (no aria-hidden app root)', () => {
  it('opening the step sets no aria-hidden on the app root or any sibling, and lays no backdrop', async () => {
    const user = userEvent.setup()
    const { container } = renderAction()

    await user.click(trigger())
    await screen.findByRole('dialog')

    expect(container).not.toHaveAttribute('aria-hidden')
    for (const child of Array.from(document.body.children)) {
      expect(child).not.toHaveAttribute('aria-hidden', 'true')
    }
    expect(document.querySelector('[aria-hidden="true"] [role="dialog"]')).toBeNull()
    expect(document.querySelector('.MuiBackdrop-root')).toBeNull()
    // The app stays in the accessibility tree while the step is open.
    expect(screen.getByRole('button', { name: TRIGGER_NAME })).toBeInTheDocument()
  })

  it('the Popper root is presentational: the one dialog role is the panel', async () => {
    const user = userEvent.setup()
    renderAction()

    await user.click(trigger())
    const dialog = await screen.findByRole('dialog', { name: 'Take down this post?' })

    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    // Wave 3 Gate-2 A S-3: NON-modal, so it must not declare `aria-modal` - the console's Ctrl+K
    // gate stands aside for every `[aria-modal="true"]` layer, and this step is not one.
    expect(dialog).not.toHaveAttribute('aria-modal')
  })

  it('a later [aria-modal] (the Ctrl+K palette) is still found by role, and keeps focus', async () => {
    const user = userEvent.setup()
    const { container } = renderAction()
    await user.click(trigger())
    await screen.findByRole('dialog', { name: 'Take down this post?' })

    // The palette renders INLINE inside the app root, like the real one.
    const palette = document.createElement('div')
    palette.setAttribute('role', 'dialog')
    palette.setAttribute('aria-modal', 'true')
    palette.setAttribute('aria-label', 'Console command palette')
    const search = document.createElement('input')
    search.setAttribute('aria-label', 'Search personas')
    palette.appendChild(search)
    container.appendChild(palette)
    act(() => search.focus())

    expect(screen.getByRole('dialog', { name: 'Console command palette' })).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search personas' })).toBeInTheDocument()
    expect(search).toHaveFocus() // the step's trap stood aside
    expect(container).not.toHaveAttribute('aria-hidden')
    // The palette wins: the step yields (closes) rather than sitting under it.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Take down this post?' }))
      .not.toBeInTheDocument())
    expect(search).toHaveFocus()
  })

  it('paints below a modal: its z-index is under the palette\'s 1300', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    const dialog = await screen.findByRole('dialog')

    const root = dialog.parentElement?.closest('[role="presentation"]')
    if (!(root instanceof HTMLElement)) throw new Error('no popper root')
    const zIndex = Number(getComputedStyle(root).zIndex)
    expect(zIndex).toBeGreaterThan(0)
    expect(zIndex).toBeLessThan(1300)
  })

  it('Esc still closes it and returns focus to the control (the Popper has no Modal Esc of its own)', async () => {
    const user = userEvent.setup()
    renderAction()
    trigger().focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger()).toHaveFocus()
  })
})

describe('TakedownAction - Gate-2 A S-3: a layer that is not modal is not aria-modal', () => {
  it('no [aria-modal] element exists while the step is open (the console\'s Ctrl+K gate sees none)', async () => {
    const user = userEvent.setup()
    renderAction()
    await user.click(trigger())
    await screen.findByRole('dialog', { name: 'Take down this post?' })
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
  })
})

describe('TakedownAction - Gate-2 A L-8: taken down elsewhere while the step is open', () => {
  /** A Live world row wrapper: the stable element focus falls back to. */
  function renderInRow() {
    const ui = (
      <ThemeProvider theme={cobraTheme}>
        <div data-live-world-row data-post-id={POST.id} tabIndex={-1} data-testid="the-row">
          <TakedownAction post={POST} />
        </div>
      </ThemeProvider>
    )
    return render(ui)
  }

  it('puts focus on the ROW, never <body>, when the step (holding focus) disappears', async () => {
    const user = userEvent.setup()
    renderInRow()
    await user.click(trigger())
    const dialog = await screen.findByRole('dialog', { name: 'Take down this post?' })
    expect(within(dialog).getByRole('radio', { name: 'Other' })).toHaveFocus()

    // Another controller's takedown reaches this tab (the `PostRemoved` push).
    act(() => removedPosts.add(POST.id))

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.queryByTestId('takedown-trigger')).toBeNull()
    expect(screen.getByTestId('the-row')).toHaveFocus()
    expect(document.activeElement).not.toBe(document.body)
  })

  it('leaves focus alone when the step was already closed and focus is elsewhere', async () => {
    const user = userEvent.setup()
    render(
      <ThemeProvider theme={cobraTheme}>
        <input aria-label="elsewhere" />
        <div data-live-world-row data-post-id={POST.id} tabIndex={-1} data-testid="the-row">
          <TakedownAction post={POST} />
        </div>
      </ThemeProvider>,
    )
    await user.click(trigger())
    await screen.findByRole('dialog', { name: 'Take down this post?' })
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    const elsewhere = screen.getByRole('textbox', { name: 'elsewhere' })
    elsewhere.focus()

    act(() => removedPosts.add(POST.id))

    await waitFor(() => expect(screen.queryByTestId('takedown-trigger')).toBeNull())
    expect(elsewhere).toHaveFocus()
  })
})
