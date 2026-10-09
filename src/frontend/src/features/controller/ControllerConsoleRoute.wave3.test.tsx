/**
 * features/controller/ControllerConsoleRoute.wave3.test.tsx
 * ---------------------------------------------------------------------------
 * The Wave 3 INTEGRATION of the controller console, through the real
 * `ControllerConsoleRoute` (demo-polish C1 post-as-persona v2, C2 live world, C3 run sheet,
 * C4 console cleanup, and the orchestrator's slot wiring - implementation.md section 4.2;
 * Wave 3 Gate-2 checks 1, 5, 11, 16, 22, 23, 26). Real providers (exercise context, React
 * Query, toolstrip, active persona), the real mock-mode data layer, NOTHING about the
 * pieces under test mocked.
 *
 *  - REPLY FLOW: "Reply as..." on a live-world row opens the composer with "Replying to
 *    @handle"; publishing creates a reply (`createPost` with `parentPostId`: one `reply`
 *    telemetry event, the stored post linked via `inReplyTo`) and the target clears; closing
 *    the dock clears it; picking a DIFFERENT persona clears it.
 *  - ⌘K PATH: with no persona active the console opens the palette, and the target SURVIVES
 *    the pick (the composer opens already replying); a palette dismissed without a pick drops
 *    it, so a later unrelated ⌘K -> persona never opens a stale reply.
 *  - RUN SHEET: "Fire next" fires the next beat, as a controller-as-persona post.
 *  - ⌘K GATING: with a run-sheet dialog open the chord does nothing; with no modal it opens.
 *  - TWO-COLUMN KEY SCOPING: the run sheet's F / N / S / E do NOT fire from the live-world
 *    column or from the composer; the live world's R does NOT fire from inside the run sheet.
 */
import { render, screen, waitFor, within, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { getEmittedTelemetryEvents, resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from './engine/services/reviewStore'
import { engineControlStore } from './engine/hooks/useEngineControl'
import { engineSettingsStore } from './engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from './hooks/useComposeAsPersona'
import { ControllerConsoleRoute } from './ControllerConsoleRoute'
import { MOCK_EXERCISE_ID, beatFixture, resetRunSheetWorld, seedStoredSheet, sheetFixture } from './runSheet/runSheetTestKit'

// Whole-console renders (MUI + emotion + three feature trees) are slow on a loaded box.
vi.setConfig({ testTimeout: 60_000 })

const FULCO = 'persona-fulcoem'
const WATER = 'persona-fairhavenwater'

beforeEach(() => {
  resetRunSheetWorld()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests({ withDemoFixtures: true })
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  // jsdom has no matchMedia: a 1440px viewport puts Live world | Run sheet side by side.
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
  vi.unstubAllGlobals()
})

/** Two pending beats for the run sheet, posting as personas in the mock cast. */
function seedTwoBeats() {
  seedStoredSheet(MOCK_EXERCISE_ID, sheetFixture([
    beatFixture({ id: 'b1', order: 1, title: 'Boil notice', scenarioMinute: 14 }),
    beatFixture({
      id: 'b2',
      order: 2,
      title: 'Citizen pile-on',
      scenarioMinute: 20,
      persona: { handle: 'tbrandt41' },
      text: 'Mine has been brown since noon.',
    }),
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
const banner = () => screen.queryByTestId('reply-banner')
const beatStatus = (id: string) =>
  within(screen.getByTestId(`beat-row-${id}`)).getByTestId('beat-status')

/** ⌘K, then pick `personaId` in the palette's persona list. */
async function pickPersona(user: User, personaId: string) {
  await user.keyboard('{Control>}k{/Control}')
  await user.click(await screen.findByTestId(`persona-picker-option-${personaId}`))
  await waitFor(() => expect(palette()).toBeNull())
}

async function closeDock(user: User) {
  await user.click(screen.getByRole('button', { name: 'Close post-as-persona panel' }))
  await waitFor(() => expect(dock()).toBeNull())
}

/** "Reply as..." on the row, returning the id of the post replied to. */
async function replyAs(user: User, row: HTMLElement): Promise<string> {
  const postId = row.dataset.postId
  if (postId === undefined) throw new Error('a live-world row has no post id')
  await user.click(within(row).getByTestId('live-world-reply-as'))
  return postId
}

describe('the route wires both slots into the split layout', () => {
  it('mounts the live world and the run sheet side by side', async () => {
    seedTwoBeats()
    const { live } = await renderRoute()
    expect(screen.getByTestId('console-slots')).toHaveAttribute('data-layout', 'split')
    expect(within(live).getByRole('heading', { name: 'LIVE WORLD' })).toBeInTheDocument()
    expect(
      within(screen.getByRole('region', { name: 'Run sheet' })).getByRole('heading', { name: 'RUN SHEET' }),
    ).toBeInTheDocument()
    // The wired slots replace the "not connected" line.
    expect(screen.queryByTestId('console-slots-status')).toBeNull()
  })
})

describe('reply flow - a persona is already active', () => {
  it('opens the composer replying to the row, publishes a reply, and clears the target', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')

    // Operate as a persona once, then close the dock: the persona stays active.
    await pickPersona(user, WATER)
    expect(await screen.findByTestId('persona-composer')).toBeInTheDocument()
    expect(banner()).toBeNull()
    await closeDock(user)

    const parentId = await replyAs(user, row)
    const composer = await screen.findByTestId('persona-composer')
    const replying = within(composer).getByTestId('reply-banner')
    expect(replying).toHaveTextContent(/^Replying to @\S+/)
    expect(dock()).not.toBeNull()

    await user.type(
      within(composer).getByRole('textbox', { name: /^Reply as / }),
      'We are looking into it.',
    )
    await user.click(within(composer).getByRole('button', { name: 'Post' }))

    // `createPost` was called with the parent: one `reply` event naming it, and the post the
    // route stored is linked to it.
    await waitFor(() => {
      const reply = postStore.getPosts().find(post => post.text === 'We are looking into it.')
      expect(reply).toBeDefined()
      expect(reply?.parentPostId).toBe(parentId)
      expect(reply?.inReplyTo?.postId).toBe(parentId)
      expect(reply?.origin).toBe('controller-as-persona')
    })
    const replyEvents = getEmittedTelemetryEvents().filter(event => event.eventType === 'reply')
    expect(replyEvents).toHaveLength(1)
    expect(replyEvents[0]?.payload).toEqual({ parentPostId: parentId })

    // ... and the target is gone: the dock is still open, but a plain composer now.
    await waitFor(() => expect(banner()).toBeNull())
    expect(dock()).not.toBeNull()
  })

  it('clears the target with the composer\'s own (x) control', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    await pickPersona(user, WATER)
    await closeDock(user)
    await replyAs(user, row)
    expect(await screen.findByTestId('reply-banner')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Clear reply target' }))
    expect(banner()).toBeNull()
    expect(dock()).not.toBeNull()
  })

  it('drops the target when the dock closes: reopening it is a plain composer', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    await pickPersona(user, WATER)
    await closeDock(user)
    await replyAs(user, row)
    expect(await screen.findByTestId('reply-banner')).toBeInTheDocument()

    await closeDock(user)
    // Reopen as the SAME persona through the palette: nothing carried over.
    await pickPersona(user, WATER)
    expect(await screen.findByTestId('persona-composer')).toBeInTheDocument()
    expect(banner()).toBeNull()
  })

  it('drops the target when a DIFFERENT persona is picked, and does not revive it', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    await pickPersona(user, WATER)
    await closeDock(user)
    await replyAs(user, row)
    expect(await screen.findByTestId('reply-banner')).toBeInTheDocument()

    await pickPersona(user, FULCO)
    await waitFor(() =>
      expect(within(screen.getByTestId('persona-composer')).getByRole('textbox', { name: /^Post as / }))
        .toBeInTheDocument())
    expect(banner()).toBeNull()

    // Back to the first persona: still nothing.
    await pickPersona(user, WATER)
    expect(banner()).toBeNull()
  })

  it('replaces the target when "Reply as..." is chosen on another row', async () => {
    const { user, rows } = await renderRoute()
    const [first, second] = rows
    if (first === undefined || second === undefined) throw new Error('need two live-world rows')
    await pickPersona(user, WATER)
    await closeDock(user)

    await replyAs(user, first)
    const firstBanner = (await screen.findByTestId('reply-banner')).textContent
    await replyAs(user, second)
    await waitFor(() => expect(screen.getByTestId('reply-banner').textContent).not.toBe(firstBanner))
  })
})

describe('reply flow - the ⌘K path (no persona active)', () => {
  it('opens the palette, and the target SURVIVES picking a persona', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')

    const parentId = await replyAs(user, row)
    // No persona to open a composer for: the palette opens, never an empty dock.
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(dock()).toBeNull()

    await user.click(await screen.findByTestId(`persona-picker-option-${WATER}`))
    const composer = await screen.findByTestId('persona-composer')
    expect(within(composer).getByTestId('reply-banner')).toHaveTextContent(/^Replying to @\S+/)

    // It is a real reply to THAT post.
    await user.type(within(composer).getByRole('textbox', { name: /^Reply as / }), 'Via the palette.')
    await user.click(within(composer).getByRole('button', { name: 'Post' }))
    await waitFor(() =>
      expect(postStore.getPosts().find(post => post.text === 'Via the palette.')?.parentPostId)
        .toBe(parentId))
  })

  it('is dropped when the palette is dismissed without a pick', async () => {
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')

    await replyAs(user, row)
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(palette()).toBeNull())

    // A later, unrelated ⌘K -> persona opens a plain composer.
    await pickPersona(user, WATER)
    expect(await screen.findByTestId('persona-composer')).toBeInTheDocument()
    expect(banner()).toBeNull()
  })
})

describe('run sheet', () => {
  it('"Fire next" fires the next pending beat as a controller-as-persona post', async () => {
    seedTwoBeats()
    const { user } = await renderRoute()
    expect(beatStatus('b1')).toHaveTextContent('Pending')

    await user.click(screen.getByRole('button', { name: /Fire next/ }))

    await waitFor(() => expect(beatStatus('b1')).toHaveTextContent('Fired'))
    expect(beatStatus('b2')).toHaveTextContent('Pending')
    const fired = postStore.getPosts().find(post => post.text === 'Boil-water advisory is in effect for Zones 2-4.')
    expect(fired?.origin).toBe('controller-as-persona')
  })
})

describe('⌘K gating - another modal on top', () => {
  it('does nothing while a run-sheet dialog is open, and works again once it closes', async () => {
    const { user } = await renderRoute()

    await user.click(screen.getByRole('button', { name: 'Add beat' }))
    expect(await screen.findByRole('dialog', { name: 'New beat' })).toBeInTheDocument()

    await user.keyboard('{Control>}k{/Control}')
    expect(palette()).toBeNull()
    await user.keyboard('{Meta>}k{/Meta}')
    expect(palette()).toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'New beat' })).toBeNull())

    await user.keyboard('{Control>}k{/Control}')
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
  })
})

describe('two-column key scoping', () => {
  /** Focuses a live-world row, as a Tab to the list would. */
  function focusRow(row: HTMLElement) {
    act(() => row.focus())
    expect(row).toHaveFocus()
  }

  it('the run sheet\'s F / N / S / E do NOT fire from a focused live-world row', async () => {
    seedTwoBeats()
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')
    const postsBefore = postStore.getPosts().length

    focusRow(row)
    await user.keyboard('fnse')

    expect(beatStatus('b1')).toHaveTextContent('Pending')
    expect(beatStatus('b2')).toHaveTextContent('Pending')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(postStore.getPosts()).toHaveLength(postsBefore)
  })

  it('the run sheet\'s F / N / S / E do NOT fire while typing in the composer', async () => {
    seedTwoBeats()
    const { user } = await renderRoute()
    await pickPersona(user, WATER)
    const composer = await screen.findByTestId('persona-composer')
    const field = within(composer).getByRole('textbox', { name: /^Post as / })
    const postsBefore = postStore.getPosts().length

    await user.click(field)
    await user.keyboard('fnse')

    expect(field).toHaveValue('fnse')
    expect(beatStatus('b1')).toHaveTextContent('Pending')
    expect(beatStatus('b2')).toHaveTextContent('Pending')
    expect(screen.queryByTestId('beat-editor')).toBeNull()
    expect(postStore.getPosts()).toHaveLength(postsBefore)
  })

  it('the live world\'s R does NOT fire from inside the run sheet (its own keys still do)', async () => {
    seedTwoBeats()
    const { user } = await renderRoute()

    await user.click(screen.getByTestId('beat-row-b1'))
    await user.keyboard('r')
    // R is the live world's "Reply as...": from the run sheet it opens neither the palette
    // (no persona is active, so a reply would have opened it) nor a dock.
    expect(palette()).toBeNull()
    expect(dock()).toBeNull()
    expect(beatStatus('b1')).toHaveTextContent('Pending')

    // The run sheet's own key, from the same place, works: the keys are scoped, not dead.
    await user.keyboard('n')
    await waitFor(() => expect(beatStatus('b1')).toHaveTextContent('Fired'))
    expect(beatStatus('b2')).toHaveTextContent('Pending')
    expect(palette()).toBeNull()
    expect(dock()).toBeNull()
  })

  it('the live world\'s own R still replies (the scoping is not a dead keyboard)', async () => {
    seedTwoBeats()
    const { user, rows } = await renderRoute()
    const row = rows[0]
    if (row === undefined) throw new Error('no live-world rows')

    focusRow(row)
    await user.keyboard('r')

    // No persona active -> the palette opens, carrying the reply.
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
    expect(beatStatus('b1')).toHaveTextContent('Pending')
  })
})
