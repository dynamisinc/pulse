/**
 * features/controller/liveWorld/TakedownAction.inColumn.test.tsx
 * ---------------------------------------------------------------------------
 * `TakedownAction` MOUNTED THROUGH C2's `renderRowActions` slot in the real `LiveWorldColumn`,
 * with the column's `isRowRemoved` wired to the same removed-post store - EXACTLY the wiring the
 * orchestrator implements (demo-polish C5, story 22; implementation.md §4.2):
 *
 *     // module level, one stable function:
 *     const renderTakedown = (post: LiveWorldPost) => <TakedownAction post={post} />
 *     // inside a component (a hook cannot run in a callback):
 *     const isRowRemoved = useIsRowRemoved()
 *     <LiveWorldColumn renderRowActions={renderTakedown} isRowRemoved={isRowRemoved} ... />
 *
 * Proves, with the column's real keyboard handling and row memoization:
 *  - one Take down control per row, after "Reply as…" in the Tab order, named for the row's author;
 *  - the two-click flow takes THAT row's post down: the COLUMN marks it REMOVED once (the
 *    persistent state), "Reply as…" is disabled and `R` is a no-op on it, and the slot adds only
 *    the controller's confirmation "Taken down · {category}" - never a second "Removed". The row
 *    stays for the record (its text is still there), the others keep their control, and exactly
 *    one telemetry event is emitted for it;
 *  - keys typed in the portalled confirm step never reach the column as row keys (J / K / R / N),
 *    and Esc returns focus to the same row's control;
 *  - an arrival re-rendering the column does not disturb an open confirm step, and a takedown made
 *    elsewhere (another controller, the store) marks only its own row REMOVED (the column's marker)
 *    while the slot renders nothing for it;
 *  - the column needs nothing from this component beyond `{ post }` (the slot is ONE module-level
 *    function, as the orchestrator passes it), and existing rows keep their DOM nodes when a new
 *    row arrives.
 *
 * Same harness as `LiveWorldColumn.test.tsx`: the shared transport is a controllable fake source,
 * `resolveFeed` is mocked, personas are the seeded mock cast, the scope is mocked.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThemeProvider } from '@mui/material/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cobraTheme } from '@/theme/cobraTheme'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { resolveFeed } from '@/features/social/services/feedService'
import { removedPosts } from '@/features/social/services/removedPosts'
import { useIsRowRemoved } from '../hooks/useRemovedPostIds'
import { LiveWorldColumn } from './LiveWorldColumn'
import type { LiveWorldPost } from './liveWorldModel'
import { TakedownAction } from './TakedownAction'
import { at, createFakeSource, LOOKALIKE, MVEGA, post, view, WATER, type FakeSource } from './liveWorldTestKit'

vi.mock('@/features/social/services/feedService', async importOriginal => {
  const actual = await importOriginal<typeof import('@/features/social/services/feedService')>()
  return { ...actual, resolveFeed: vi.fn() }
})

vi.mock('@/core/exerciseContext', async importOriginal => {
  const actual = await importOriginal<typeof import('@/core/exerciseContext')>()
  return {
    ...actual,
    useExerciseContext: () => ({
      exerciseId: 'ex-1',
      exerciseName: 'Exercise One',
      timeZone: 'America/New_York',
    }),
  }
})

// The service stands in for the server: it records the id like the real one does after a 2xx.
vi.mock('../services/takedownService', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/takedownService')>()
  const { removedPosts: store } = await import('@/features/social/services/removedPosts')
  return {
    ...actual,
    takeDownPost: vi.fn((postId: string) => {
      store.add(postId)
      return Promise.resolve()
    }),
  }
})

const mockedResolveFeed = vi.mocked(resolveFeed)

let source: FakeSource

/** The slot, as the orchestrator passes it: ONE module-level function, never an inline arrow. */
const renderTakedown = (row: LiveWorldPost) => <TakedownAction post={row} />

beforeEach(() => {
  source = createFakeSource()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T10:50:00Z') })
  resetTelemetryBuffer()
  removedPosts.resetForTests()
  mockedResolveFeed.mockReset()
  mockedResolveFeed.mockResolvedValue([
    post('p-lookalike', {
      authorPersonaId: LOOKALIKE,
      text: 'Do NOT drink the tap water. #WaterIssues',
      scenarioTime: at(40),
    }),
    post('p-reply', {
      authorPersonaId: MVEGA,
      text: 'Is this safe for the baby?',
      scenarioTime: at(35),
      inReplyTo: { postId: 'p-video', authorHandle: 'FairhavenWater' },
    }),
    post('p-video', {
      authorPersonaId: WATER,
      text: 'Boil water notice for Zone 3. #WaterIssues',
      scenarioTime: at(30),
    }),
  ])
})

afterEach(() => {
  resetExerciseClock()
  resetTelemetryBuffer()
  removedPosts.resetForTests()
})

/** The component the orchestrator's route wraps the column in (a hook cannot run in a callback). */
function Harness({ onReplyAs }: { onReplyAs: (target: unknown) => void }) {
  const isRowRemoved = useIsRowRemoved()
  return (
    <ThemeProvider theme={cobraTheme}>
      <LiveWorldColumn
        onReplyAs={onReplyAs}
        source={source}
        renderRowActions={renderTakedown}
        isRowRemoved={isRowRemoved}
      />
    </ThemeProvider>
  )
}

async function loaded() {
  const onReplyAs = vi.fn()
  const utils = render(<Harness onReplyAs={onReplyAs} />)
  await screen.findAllByTestId('live-world-row')
  return { ...utils, onReplyAs }
}

function rowFor(id: string): HTMLElement {
  const row = screen.getAllByTestId('live-world-row').find(el => el.dataset.postId === id)
  if (row === undefined) throw new Error(`no row for ${id}`)
  return row
}

function steeringEvents() {
  return getEmittedTelemetryEvents().filter(event => event.eventType === 'steering_action')
}

describe('TakedownAction through renderRowActions', () => {
  it('mounts one Take down control per row, named for the row\'s author, after Reply as…', async () => {
    await loaded()

    expect(screen.getAllByTestId('takedown-trigger')).toHaveLength(3)
    const lookalike = rowFor('p-lookalike')
    expect(within(lookalike).getByRole('button', { name: 'Take down post by Fairhaven Water Update' }))
      .toBeInTheDocument()
    expect(within(rowFor('p-video')).getByRole('button', {
      name: 'Take down post by Fairhaven Water Utility',
    })).toBeInTheDocument()

    const user = userEvent.setup()
    lookalike.focus()
    await user.tab()
    expect(within(lookalike).getByTestId('live-world-reply-as')).toHaveFocus()
    await user.tab()
    expect(within(lookalike).getByTestId('takedown-trigger')).toHaveFocus()
  })

  it('takes down THAT row\'s post in two clicks: the column marks it REMOVED once, the slot confirms the category', async () => {
    const { onReplyAs } = await loaded()
    const user = userEvent.setup()
    const target = rowFor('p-lookalike')

    await user.click(within(target).getByTestId('takedown-trigger'))
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))

    // The persistent state is the COLUMN's: one REMOVED marker, on the author line.
    const marker = await within(target).findByTestId('live-world-removed')
    expect(marker).toHaveTextContent('REMOVED')
    expect(within(target).getAllByText(/^removed$/i)).toHaveLength(1)
    // The slot adds the controller's acknowledgement - distinct wording, with the category.
    const confirmation = within(target).getByTestId('takedown-confirmation')
    expect(confirmation).toHaveTextContent('Taken down · PII')
    expect(confirmation).toHaveFocus()
    expect(within(confirmation).queryByText(/removed/i)).toBeNull()
    // "Reply as…" is disabled on the removed row, and R is a no-op there.
    expect(within(target).getByTestId('live-world-reply-as')).toBeDisabled()
    await user.keyboard('r')
    expect(onReplyAs).not.toHaveBeenCalled()
    // The row stays, with its content, for the record.
    expect(target).toBeInTheDocument()
    expect(within(target).getByTestId('live-world-text')).toHaveTextContent('Do NOT drink the tap water.')
    expect(within(target).queryByTestId('takedown-trigger')).toBeNull()
    // The other rows are untouched: still live, still takedown-able.
    for (const id of ['p-reply', 'p-video']) {
      expect(within(rowFor(id)).getByTestId('takedown-trigger')).toBeInTheDocument()
      expect(within(rowFor(id)).queryByTestId('live-world-removed')).toBeNull()
      expect(within(rowFor(id)).getByTestId('live-world-reply-as')).toBeEnabled()
    }
    // Exactly one event, for that post.
    expect(steeringEvents()).toHaveLength(1)
    expect(steeringEvents()[0]?.target).toEqual({ entityType: 'post', entityId: 'p-lookalike' })
    expect(steeringEvents()[0]?.payload).toEqual({ action: 'takedown', category: 'pii' })
  })

  it('keys typed in the confirm step never reach the column as J / K / R / N', async () => {
    const { onReplyAs } = await loaded()
    const user = userEvent.setup()
    const target = rowFor('p-reply')
    within(target).getByTestId('takedown-trigger').focus()
    await user.keyboard('{Enter}')
    const dialog = await screen.findByRole('dialog')
    expect(dialog.closest('[data-live-world-row]')).toBeNull()
    expect(screen.getByRole('radio', { name: 'Other' })).toHaveFocus()

    await user.keyboard('rRjJkKnN')

    expect(onReplyAs).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    // Focus stayed inside the step: no row took it.
    expect(dialog).toContainElement(document.activeElement as HTMLElement)
  })

  it('Esc closes the step and returns focus to THAT row\'s control', async () => {
    await loaded()
    const user = userEvent.setup()
    const control = within(rowFor('p-video')).getByTestId('takedown-trigger')
    control.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('dialog')

    await user.keyboard('{Escape}')

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(control).toHaveFocus()
    expect(steeringEvents()).toHaveLength(0)
  })

  it('an arrival re-rendering the column leaves an open confirm step (and its choice) alone', async () => {
    await loaded()
    const user = userEvent.setup()
    await user.click(within(rowFor('p-video')).getByTestId('takedown-trigger'))
    await user.click(await screen.findByRole('radio', { name: 'Real-world reference' }))

    act(() => source.emit(view('p-new', { text: 'Fresh post', scenarioTime: at(45) })))
    await screen.findByText('Fresh post')

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'Real-world reference' })).toBeChecked()
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))
    expect(await within(rowFor('p-video')).findByTestId('takedown-confirmation'))
      .toHaveTextContent('Taken down · Real-world reference')
    expect(within(rowFor('p-video')).getByTestId('live-world-removed')).toBeInTheDocument()
    expect(steeringEvents()[0]?.payload).toEqual({
      action: 'takedown',
      category: 'real-world-reference',
    })
  })

  it('a takedown made elsewhere marks only its own row REMOVED (the column); the slot renders nothing; no telemetry', async () => {
    await loaded()

    act(() => removedPosts.add('p-reply'))

    const target = rowFor('p-reply')
    expect(await within(target).findByTestId('live-world-removed')).toHaveTextContent('REMOVED')
    expect(within(target).getAllByText(/^removed$/i)).toHaveLength(1)
    // Nothing from the slot: no control, no confirmation, no second marker.
    expect(within(target).queryByTestId('takedown-trigger')).toBeNull()
    expect(within(target).queryByTestId('takedown-confirmation')).toBeNull()
    expect(within(target).getByTestId('live-world-reply-as')).toBeDisabled()
    // The other rows are untouched.
    expect(within(rowFor('p-lookalike')).getByTestId('takedown-trigger')).toBeInTheDocument()
    expect(within(rowFor('p-video')).getByTestId('takedown-trigger')).toBeInTheDocument()
    expect(within(rowFor('p-video')).queryByTestId('live-world-removed')).toBeNull()
    expect(steeringEvents()).toHaveLength(0)
  })

  it('a removed row stays REMOVED across a remount of the column rows (the store keeps it)', async () => {
    const first = await loaded()
    const user = userEvent.setup()
    await user.click(within(rowFor('p-video')).getByTestId('takedown-trigger'))
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))
    await within(rowFor('p-video')).findByTestId('takedown-confirmation')
    first.unmount()

    await loaded()

    const target = rowFor('p-video')
    expect(within(target).getByTestId('live-world-removed')).toBeInTheDocument()
    expect(within(target).queryByTestId('takedown-trigger')).toBeNull()
    expect(within(target).queryByTestId('takedown-confirmation')).toBeNull()
    expect(within(target).getByTestId('live-world-reply-as')).toBeDisabled()
  })

  it('a new row arriving gets its own control, and the existing rows keep their DOM nodes', async () => {
    await loaded()
    const before = screen.getAllByTestId('takedown-trigger')

    act(() => source.emit(view('p-new', { text: 'Fresh post', scenarioTime: at(45) })))
    await screen.findByText('Fresh post')

    const after = screen.getAllByTestId('takedown-trigger')
    expect(after).toHaveLength(4)
    for (const control of before) expect(after).toContain(control)
  })

  it('failure inside a row shows the message in that row only, with Retry', async () => {
    const { takeDownPost } = await import('../services/takedownService')
    const { TakedownError } = await import('../services/takedownService')
    vi.mocked(takeDownPost).mockRejectedValueOnce(new TakedownError('The server is busy right now.', 503))
    await loaded()
    const user = userEvent.setup()
    const target = rowFor('p-reply')

    await user.click(within(target).getByTestId('takedown-trigger'))
    await user.click(await screen.findByRole('button', { name: 'Confirm take down' }))

    const alert = await within(target).findByRole('alert')
    expect(alert).toHaveTextContent('The server is busy right now.')
    expect(within(rowFor('p-video')).queryByRole('alert')).toBeNull()
    expect(within(alert).getByRole('button', { name: /Retry/ })).toHaveFocus()
  })
})
