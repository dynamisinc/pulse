/**
 * features/controller/ControllerConsoleRoute.gate2.test.tsx
 * ---------------------------------------------------------------------------
 * The Wave 3 Gate-2 findings that only show up through the REAL `ControllerConsoleRoute`
 * (real providers, mock-mode data layer), next to `ControllerConsoleRoute.wave3.test.tsx`:
 *
 *  L-1  A console re-render (the review queue's tick, every swamped-mode change, a toolstrip
 *       toggle) does not re-render the run sheet's beat rows or the live-world column: both
 *       slot roots are `memo`ized with stable props. Counted with pass-through wrappers.
 *  S-3  C5's takedown step is non-modal, so Ctrl+K still opens the palette OVER it, the step
 *       closes, and focus lands in the palette (not on <body>).
 *  L-2  The pause-tier popover is a MUI modal and now says so (`aria-modal`), so Ctrl+K is inert
 *       while it is open instead of opening the palette hidden behind it.
 *  M-2  A "Post status unknown" reply survives the dock closing (the ENGINE flyout takes it over):
 *       reopened, the "Replying to" banner is back (the route restores it), and "post again" is
 *       still a reply to the SAME post - never a top-level post.
 *  L-3  A reply target taken down after it was set: the composer says so and blocks Post.
 *  S-1  "Reply as..." on another row while the dock is open moves focus into the text field.
 */
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { reviewStore } from './engine/services/reviewStore'
import { engineControlStore } from './engine/hooks/useEngineControl'
import { engineSettingsStore } from './engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from './hooks/useComposeAsPersona'
import { ComposeUnconfirmedError, composeAsPersona } from './services/composeService'
import { ControllerConsoleRoute } from './ControllerConsoleRoute'
import { MOCK_EXERCISE_ID, beatFixture, resetRunSheetWorld, seedStoredSheet, sheetFixture } from './runSheet/runSheetTestKit'

vi.setConfig({ testTimeout: 60_000 })

// Pass-through wrappers that COUNT renders (L-1). A wrapper renders exactly when its parent
// re-renders it, so the count is "how often the slot root let a console render through".
const renders = vi.hoisted(() => ({ liveWorldColumn: 0, beatRow: 0 }))

vi.mock('./liveWorld/LiveWorldColumn', async importOriginal => {
  const actual = await importOriginal<typeof import('./liveWorld/LiveWorldColumn')>()
  const React = await import('react')
  return {
    ...actual,
    LiveWorldColumn: (props: Parameters<typeof actual.LiveWorldColumn>[0]) => {
      renders.liveWorldColumn += 1
      return React.createElement(actual.LiveWorldColumn, props)
    },
  }
})

vi.mock('./runSheet/RunSheetBeatRow', async importOriginal => {
  const actual = await importOriginal<typeof import('./runSheet/RunSheetBeatRow')>()
  const React = await import('react')
  return {
    ...actual,
    RunSheetBeatRow: (props: Parameters<typeof actual.RunSheetBeatRow>[0]) => {
      renders.beatRow += 1
      return React.createElement(actual.RunSheetBeatRow, props)
    },
  }
})

// Lets one test make the (mock-mode) publish look like "the server never answered".
vi.mock('./services/composeService', async importOriginal => {
  const actual = await importOriginal<typeof import('./services/composeService')>()
  return { ...actual, composeAsPersona: vi.fn(actual.composeAsPersona) }
})

const WATER = 'persona-fairhavenwater'
const realComposeAsPersona = vi.mocked(composeAsPersona).getMockImplementation()

beforeEach(() => {
  resetRunSheetWorld()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests({ withDemoFixtures: true })
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  removedPosts.resetForTests()
  renders.liveWorldColumn = 0
  renders.beatRow = 0
  vi.mocked(composeAsPersona).mockReset()
  if (realComposeAsPersona) vi.mocked(composeAsPersona).mockImplementation(realComposeAsPersona)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: 1440 >= Number(/min-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
})

afterEach(() => {
  resetExerciseClock()
  resetRunSheetWorld()
  postStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  removedPosts.resetForTests()
  vi.unstubAllGlobals()
})

function seedBeats() {
  seedStoredSheet(MOCK_EXERCISE_ID, sheetFixture([
    beatFixture({ id: 'b1', order: 1, title: 'Boil notice', scenarioMinute: 14 }),
    beatFixture({ id: 'b2', order: 2, title: 'Citizen pile-on', scenarioMinute: 20 }),
  ]))
}

async function renderRoute() {
  const user = userEvent.setup({ delay: null })
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <MemoryRouter initialEntries={['/console']}>
          <ControllerConsoleRoute />
        </MemoryRouter>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
  const live = await screen.findByRole('region', { name: 'Live world' })
  const rows = await within(live).findAllByTestId('live-world-row')
  const sheet = await screen.findByTestId('run-sheet-panel')
  await waitFor(() => expect(sheet).toHaveAttribute('data-personas', 'ready'))
  return { user, live, rows, sheet }
}

type User = ReturnType<typeof userEvent.setup>

const palette = () => screen.queryByTestId('command-palette')
const dock = () => screen.queryByTestId('persona-dock-host')

async function pickPersona(user: User, personaId: string) {
  await user.keyboard('{Control>}k{/Control}')
  await user.click(await screen.findByTestId(`persona-picker-option-${personaId}`))
  await waitFor(() => expect(palette()).toBeNull())
}

async function closeDock(user: User) {
  await user.click(screen.getByRole('button', { name: 'Close post-as-persona panel' }))
  await waitFor(() => expect(dock()).toBeNull())
}

describe('L-1 - a console re-render does not re-render the slot roots', () => {
  it('toggling the palette (a console render) leaves the beat rows and the live-world column alone', async () => {
    seedBeats()
    const { user } = await renderRoute()
    // Let the mount settle (queries, personas, the first arrivals batch).
    await waitFor(() => expect(renders.beatRow).toBeGreaterThanOrEqual(2))
    await new Promise(resolve => setTimeout(resolve, 400))
    const rowsBefore = renders.beatRow
    const columnBefore = renders.liveWorldColumn

    // Each toggle re-renders ControllerConsole (the toolstrip state it reads) and calls both slots.
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByTestId('command-palette')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).toBeNull())
    await user.keyboard('{Control>}k{/Control}')
    await screen.findByTestId('command-palette')
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).toBeNull())

    expect(renders.beatRow).toBe(rowsBefore)
    expect(renders.liveWorldColumn).toBe(columnBefore)
  })
})

describe('S-3 - Ctrl+K works over the (non-modal) takedown step', () => {
  it('opens the palette over the step, closes the step, and focus lands in the palette', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')

    await user.click(within(row).getByTestId('takedown-trigger'))
    expect(await screen.findByTestId('takedown-dialog')).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')

    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('takedown-dialog')).toBeNull())
    expect(within(screen.getByTestId('command-palette-search')).getByRole('textbox')).toHaveFocus()
    // Nothing was taken down by getting out of the way.
    expect(removedPosts.has(row.dataset.postId ?? '')).toBe(false)
  })
})

describe('L-2 - Ctrl+K is inert while the pause-tier popover is open', () => {
  it('does not open the palette behind the popover', async () => {
    const { user } = await renderRoute()
    await user.click(screen.getByTestId('pause-pill'))
    const popover = await screen.findByTestId('pause-popover')
    expect(popover.closest('[aria-modal="true"]')).not.toBeNull()

    await user.keyboard('{Control>}k{/Control}')

    expect(palette()).toBeNull()
    expect(screen.getByTestId('pause-popover')).toBeInTheDocument()
  })
})

describe('M-2 - a reply that may be live keeps its reply across the dock closing', () => {
  it('comes back as "Replying to @x" and "post again" is still a reply to that post', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    const parentId = row.dataset.postId

    await pickPersona(user, WATER)
    await closeDock(user)
    await user.click(within(row).getByTestId('live-world-reply-as'))
    const composer = await screen.findByTestId('persona-composer')
    expect(within(composer).getByTestId('reply-banner')).toBeInTheDocument()

    // The server never answers: the post may be live.
    vi.mocked(composeAsPersona).mockImplementationOnce(() => {
      throw new ComposeUnconfirmedError()
    })
    await user.type(within(composer).getByRole('textbox', { name: /^Reply as / }), 'Yes, safe now.')
    await user.click(within(composer).getByRole('button', { name: 'Post' }))
    expect(await screen.findByTestId('publish-unconfirmed')).toBeInTheDocument()

    // The ENGINE flyout takes the dock over (not an explicit discard): the route drops the target.
    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    await waitFor(() => expect(dock()).toBeNull())
    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))

    // Reopen the dock for the same persona.
    await pickPersona(user, WATER)
    const reopened = await screen.findByTestId('persona-composer')
    expect(within(reopened).getByTestId('publish-unconfirmed')).toBeInTheDocument()
    expect(within(reopened).getByRole('textbox', { name: /^Reply as / })).toHaveValue('Yes, safe now.')
    expect(within(reopened).getByTestId('reply-banner')).toHaveTextContent(/^Replying to @\S+/)
    expect(within(reopened).queryByTestId('draft-reply-notice')).toBeNull()

    await user.click(within(reopened).getByRole('button', { name: 'Post again anyway…' }))
    await user.click(within(reopened).getByRole('button', { name: 'I checked the feed — post again' }))

    const calls = vi.mocked(composeAsPersona).mock.calls
    expect(calls).toHaveLength(2)
    expect(calls[1]?.[0].parentPostId).toBe(parentId)
    await waitFor(() =>
      expect(postStore.getPosts().find(post => post.text === 'Yes, safe now.')?.parentPostId)
        .toBe(parentId))
  })
})

describe('L-3 - replying to a post that was taken down', () => {
  it('says so in words and blocks Post until the reply is cleared', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    await pickPersona(user, WATER)
    await closeDock(user)
    await user.click(within(row).getByTestId('live-world-reply-as'))
    const composer = await screen.findByTestId('persona-composer')
    await user.type(within(composer).getByRole('textbox', { name: /^Reply as / }), 'Answering.')
    expect(within(composer).getByRole('button', { name: 'Post' })).toBeEnabled()

    // Another controller takes the post down (the `PostRemoved` push reaches this tab).
    act(() => removedPosts.add(row.dataset.postId ?? ''))

    const removedBanner = await within(composer).findByTestId('reply-banner-removed')
    expect(removedBanner).toHaveTextContent("The post you're replying to was taken down.")
    expect(within(composer).getByRole('button', { name: 'Post' })).toBeDisabled()

    await user.click(within(removedBanner).getByRole('button', { name: 'Clear reply' }))
    expect(within(composer).queryByTestId('reply-banner-removed')).toBeNull()
    expect(within(composer).getByRole('button', { name: 'Post' })).toBeEnabled()
  })
})

describe('S-1 - "Reply as..." with the dock already open focuses the text field', () => {
  it('moves focus from the live-world row into the composer\'s text field', async () => {
    const { user, rows } = await renderRoute()
    const [first, second] = rows
    if (first === undefined || second === undefined) throw new Error('need two live-world rows')
    await pickPersona(user, WATER)
    expect(await screen.findByTestId('persona-composer')).toBeInTheDocument()

    await user.click(within(first).getByTestId('live-world-reply-as'))
    const composer = screen.getByTestId('persona-composer')
    await waitFor(() =>
      expect(within(composer).getByRole('textbox', { name: /^Reply as / })).toHaveFocus())

    // And again on another row, with focus back on the live world.
    within(second).getByTestId('live-world-reply-as').focus()
    await user.click(within(second).getByTestId('live-world-reply-as'))
    await waitFor(() =>
      expect(within(composer).getByRole('textbox', { name: /^Reply as / })).toHaveFocus())
  })
})
