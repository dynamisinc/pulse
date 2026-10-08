/**
 * features/controller/liveWorld/TakedownAction.inColumn.test.tsx
 * ---------------------------------------------------------------------------
 * `TakedownAction` MOUNTED THROUGH C2's `renderRowActions` slot in the real `LiveWorldColumn`
 * (demo-polish C5, story 22; the wiring the orchestrator implements, implementation.md §4.2):
 *
 *     const renderTakedown = (post: LiveWorldPost) => <TakedownAction post={post} />
 *     <LiveWorldColumn renderRowActions={renderTakedown} ... />
 *
 * Proves, with the column's real keyboard handling and row memoization:
 *  - one Take down control per row, after "Reply as…" in the Tab order, named for the row's author;
 *  - the two-click flow takes THAT row's post down and only that row turns "Removed" - the row
 *    stays for the record (its text is still there), the others keep their control, and exactly
 *    one telemetry event is emitted for it;
 *  - keys typed in the portalled confirm step never reach the column as row keys (J / K / R / N),
 *    and Esc returns focus to the same row's control;
 *  - an arrival re-rendering the column does not disturb an open confirm step, and a takedown made
 *    elsewhere (another controller, the store) flips only its own row;
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

async function loaded() {
  const onReplyAs = vi.fn()
  const utils = render(
    <ThemeProvider theme={cobraTheme}>
      <LiveWorldColumn onReplyAs={onReplyAs} source={source} renderRowActions={renderTakedown} />
    </ThemeProvider>,
  )
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

  it('takes down THAT row\'s post in two clicks; only that row turns Removed and it stays for the record', async () => {
    await loaded()
    const user = userEvent.setup()
    const target = rowFor('p-lookalike')

    await user.click(within(target).getByTestId('takedown-trigger'))
    await user.click(await screen.findByRole('radio', { name: 'PII' }))
    await user.click(screen.getByRole('button', { name: 'Confirm take down' }))

    const marker = await within(target).findByTestId('takedown-removed')
    expect(marker).toHaveTextContent('Removed')
    // The row stays, with its content, for the record.
    expect(target).toBeInTheDocument()
    expect(within(target).getByTestId('live-world-text')).toHaveTextContent('Do NOT drink the tap water.')
    expect(within(target).queryByTestId('takedown-trigger')).toBeNull()
    // The other rows are untouched.
    expect(within(rowFor('p-reply')).getByTestId('takedown-trigger')).toBeInTheDocument()
    expect(within(rowFor('p-video')).getByTestId('takedown-trigger')).toBeInTheDocument()
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
    expect(await within(rowFor('p-video')).findByTestId('takedown-removed')).toBeInTheDocument()
    expect(steeringEvents()[0]?.payload).toEqual({
      action: 'takedown',
      category: 'real-world-reference',
    })
  })

  it('a takedown made elsewhere (another controller / the store) flips only its own row, with no telemetry', async () => {
    await loaded()

    act(() => removedPosts.add('p-reply'))

    expect(await within(rowFor('p-reply')).findByTestId('takedown-removed')).toBeInTheDocument()
    expect(within(rowFor('p-lookalike')).getByTestId('takedown-trigger')).toBeInTheDocument()
    expect(within(rowFor('p-video')).getByTestId('takedown-trigger')).toBeInTheDocument()
    expect(steeringEvents()).toHaveLength(0)
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
