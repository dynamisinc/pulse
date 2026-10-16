/**
 * features/controller/access/readOnlyConsole.test.tsx
 * ---------------------------------------------------------------------------
 * Demo-feedback story 11 (#507, DF-14): the controller console, read-only for evaluators.
 *
 * The REAL `ControllerConsoleRoute` under a real `SessionProvider` (as `app-shell/routes.tsx`
 * hoists it). The ONE thing replaced is the session RESOLVER (the mock one always returns a
 * participant), so each case picks the signed-in role. Everything under test runs on its normal
 * mock-mode data: the run sheet's in-memory queue, the review store's seed, the live world's
 * demo posts, the noise, pause and storyline mocks.
 *
 *  - TABLE: every write control the story lists is PRESENT for a controller and ABSENT (not
 *    disabled) for an evaluator.
 *  - Export posts and the read-only surfaces stay for both; the "View only" chip shows for the
 *    evaluator only.
 *  - The keyboard shortcuts that write are inert for an evaluator, and the run sheet editor opens
 *    read-only.
 *  - The controller's console is UNCHANGED: the full list of its controls (role, test id and name)
 *    equals the list recorded before this story's gating went in.
 */
import { act, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SessionProvider, type ExerciseRole } from '@/core/auth'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import {
  resetMockExerciseStatus,
  setMockExerciseStatus,
} from '@/core/exerciseContext/exerciseContextResolver'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { removedPosts } from '@/features/social/services/removedPosts'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore, useEngineControl } from '../engine/hooks/useEngineControl'
import { engineSettingsStore, MOCK_ENGINE_SETTINGS } from '../engine/hooks/useEngineSettings'
import type { EngineSettingsAutonomy } from '../engine/services/engineSettingsActions'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { resetPauseStateForTest } from '../hooks/usePauseState'
import { resetNoiseMockForTest } from '../noise/noiseMock'
import { injectMock, MOCK_DEMO_SEED, MOCK_ME } from '../runSheet/injectMock'
import type { InjectItemWrite } from '../runSheet/types'
import { ControllerConsoleRoute } from '../ControllerConsoleRoute'
import { resetSessionRole, setSessionRole } from '../lifecycle/lifecycle.sessionKit.testUtils'
import { useReadOnlyRefresh } from './useReadOnlyRefresh'

// Whole-console renders (MUI + emotion + several feature trees) are slow on a loaded box.
vi.setConfig({ testTimeout: 60_000 })

// The real polling hook, behind a spy, so a case can tell whether the console mounted it (L-A).
vi.mock('./useReadOnlyRefresh', async importOriginal => {
  const actual = await importOriginal<typeof import('./useReadOnlyRefresh')>()
  return { ...actual, useReadOnlyRefresh: vi.fn(actual.useReadOnlyRefresh) }
})

vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('../lifecycle/lifecycle.sessionKit.testUtils')).resolveSession,
}))

/** The first element, or a loud failure (the suite's fixtures are never empty). */
function first<T>(items: readonly T[]): T {
  const [head] = items
  if (head === undefined) throw new Error('expected at least one element')
  return head
}

/** One run sheet item per state the row actions depend on. */
const TEMPLATE: InjectItemWrite = first(MOCK_DEMO_SEED)
const item = (title: string, plannedMinute: number): InjectItemWrite => ({
  ...TEMPLATE,
  title,
  plannedMinute,
  assigneeId: MOCK_ME,
})
const SEED: InjectItemWrite[] = [
  item('Pending one', 0),
  item('Pending two', 5),
  item('Held three', 10),
  item('Skipped four', 15),
  item('Failed five', 20),
]

const idOf = (title: string): string => {
  const found = injectMock.snapshot().items.find(candidate => candidate.title === title)
  if (!found) throw new Error(`no run sheet item ${title}`)
  return found.id
}

/** Status of every run sheet item, by title (to prove a key press changed nothing). */
const queueStatuses = (): Record<string, string> =>
  Object.fromEntries(injectMock.snapshot().items.map(i => [i.title, i.status]))

/** Disposition of every review item (to prove a key press changed nothing). */
const reviewDispositions = (): string[] => reviewStore.getItems().map(i => `${i.draftId}:${i.disposition}`)

async function prepareQueue(): Promise<void> {
  injectMock.reset({ seed: SEED })
  await injectMock.hold(idOf('Held three'))
  await injectMock.skip(idOf('Skipped four'))
  injectMock.failNextPublish('Publish refused (test)')
  await injectMock.fire(idOf('Failed five'))
}

beforeEach(async () => {
  resetPauseStateForTest()
  resetNoiseMockForTest()
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests({ withDemoFixtures: true })
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  removedPosts.resetForTests()
  setMockExerciseStatus('live')
  await prepareQueue()
  // jsdom has no matchMedia: a 1440px-wide viewport (Live world | Run sheet side by side).
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
  injectMock.dispose()
  resetPauseStateForTest()
  resetNoiseMockForTest()
  resetExerciseClock()
  resetMockExerciseStatus()
  resetSessionRole()
  postStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  removedPosts.resetForTests()
  vi.unstubAllGlobals()
})

async function renderConsole(role: ExerciseRole): Promise<void> {
  setSessionRole(role)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ExerciseContextProvider>
        <SessionProvider>
          <MemoryRouter initialEntries={['/staff/console']}>
            <ControllerConsoleRoute />
          </MemoryRouter>
        </SessionProvider>
      </ExerciseContextProvider>
    </QueryClientProvider>,
  )
  await screen.findByTestId('controller-console')
  // Every panel has loaded its data before anything is counted.
  await waitFor(() => expect(screen.getAllByTestId('run-sheet-row')).toHaveLength(SEED.length))
  await waitFor(() => expect(screen.getAllByTestId('live-world-row').length).toBeGreaterThan(0))
  await waitFor(() => expect(screen.getAllByTestId('review-card').length).toBeGreaterThan(0))
  await screen.findByTestId('noise-rate')
  await screen.findByTestId('export-posts')
}

/** Puts this exercise's engine into the mock provider-degraded clamp before the console mounts. */
async function degradeEngine(): Promise<void> {
  const hook = renderHook(() => useEngineControl(), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={new QueryClient()}>
        <ExerciseContextProvider>{children}</ExerciseContextProvider>
      </QueryClientProvider>
    ),
  })
  await waitFor(() => expect(hook.result.current).toBeTruthy())
  act(() => hook.result.current.degrade('provider degraded (test)'))
  hook.unmount()
}

/** Seeds the mock exercise's engine settings with this autonomy (the server's view). */
function serverAutonomy(autonomy: Partial<EngineSettingsAutonomy>): void {
  engineSettingsStore.setForTests('ex-mock-0001', {
    ...MOCK_ENGINE_SETTINGS,
    autonomy: { ...MOCK_ENGINE_SETTINGS.autonomy, ...autonomy },
  })
}

/** Lets anything a key press MIGHT have started actually start before asserting it did not. */
async function quiet(): Promise<void> {
  await act(async () => {
    await new Promise(resolve => setTimeout(resolve, 30))
  })
}

const all = (testId: string): HTMLElement[] => screen.queryAllByTestId(testId)

/**
 * The write controls, one row each. `find` returns every instance in the console; a controller
 * must have at least one, an evaluator none at all (absent, not disabled).
 */
const WRITE_CONTROLS: ReadonlyArray<readonly [string, () => HTMLElement[]]> = [
  // The persona composer and what opens it.
  ['PERSONAS toolstrip tool (opens the composer palette)', () => all('toolstrip-tool-personas')],
  ['"Post as a persona" shortcut strip', () => all('console-shortcut-strip')],
  ['Live world: Reply as…', () => all('live-world-reply-as')],
  // Live world.
  ['Live world: Take down', () => all('takedown-trigger')],
  ['Live world: Pin for everyone', () => all('live-world-pin')],
  // World steering.
  ['Pause pill (its tier actions)', () => all('pause-pill')],
  ['Escalation dial', () => all('escalation-dial')],
  ['White noise level buttons', () => all('noise-level-group')],
  // Engine control bar.
  ['Engine kill switch', () => all('engine-kill-switch')],
  ['Engine "Simulate degraded (dev)"', () => all('engine-degraded-simulate')],
  ['Swamped mode toggle', () => all('swamped-mode-enable-toggle')],
  // Review queue.
  ['Review queue: Batch approve', () => all('batch-approve')],
  ['Review queue: batch selection', () => all('select-toggle')],
  ['Review queue: Approve / Veto / Edit / Re-roll', () => all('card-actions')],
  // StartEx / EndEx.
  ['StartEx / EndEx', () => all('exercise-lifecycle-control')],
  // Run sheet.
  ['Run sheet: Fire next', () => all('fire-next')],
  ['Run sheet: Add', () => all('add-item')],
  ['Run sheet: Import from Excel', () => all('import-from-excel')],
  ['Run sheet row: Fire', () => all('row-fire')],
  ['Run sheet row: Retry', () => all('row-retry')],
  ['Run sheet row: Release', () => all('row-release')],
  ['Run sheet row: Hold', () => all('row-hold')],
  ['Run sheet row: Skip', () => all('row-skip')],
  ['Run sheet row: Unskip', () => all('row-unskip')],
  ['Run sheet row: Delete', () => all('row-delete')],
  // Demo-feedback story 23 (DF-36).
  ['Run sheet row: Mark fired', () => all('row-mark-fired')],
  ['Run sheet row: Move up', () => all('row-move-up')],
  ['Run sheet row: Move down', () => all('row-move-down')],
  [
    'Run sheet row: Edit',
    () => all('row-open').filter(button => /^Edit /.test(button.getAttribute('aria-label') ?? '')),
  ],
]

describe('the console as a controller and as an evaluator (story 11, table-driven)', () => {
  it.each(WRITE_CONTROLS)('%s: present for a controller', async (_name, find) => {
    await renderConsole('controller')
    expect(find().length).toBeGreaterThan(0)
  })

  it.each(WRITE_CONTROLS)('%s: absent for an evaluator', async (_name, find) => {
    await renderConsole('evaluator')
    expect(find()).toHaveLength(0)
  })
})

describe('what an evaluator keeps', () => {
  it.each(['controller', 'evaluator'] as const)('Export posts is available to a %s', async role => {
    await renderConsole(role)
    expect(screen.getByTestId('export-posts')).toBeEnabled()
  })

  it('shows "View only" in the console title row for an evaluator, never for a controller', async () => {
    await renderConsole('evaluator')
    const chip = screen.getByTestId('console-view-only-chip')
    expect(chip).toHaveTextContent('View only')
    // Gate-1 L-2: the reason is in the chip's text (visually hidden), not a mouse-only title.
    expect(within(chip).getByTestId('console-view-only-reason'))
      .toHaveTextContent('Only a controller can change the exercise.')
    expect(chip).not.toHaveAttribute('title')
    // In the title row, beside the console title.
    const title = screen.getByRole('heading', { level: 1, name: 'CONTROLLER CONSOLE' })
    expect(title.parentElement).toContainElement(chip)
  })

  it('shows no "View only" chip to a controller', async () => {
    await renderConsole('controller')
    expect(screen.queryByTestId('console-view-only-chip')).not.toBeInTheDocument()
  })

  it('keeps the read surfaces: the run sheet, the live world, the review cards and the noise level as text', async () => {
    await renderConsole('evaluator')
    expect(screen.getAllByTestId('run-sheet-row')).toHaveLength(SEED.length)
    expect(screen.getAllByTestId('live-world-row').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('review-card').length).toBeGreaterThan(0)
    // The white noise level and rate stay visible as words.
    expect(screen.getByTestId('noise-level-readonly')).toHaveTextContent('Level: Off')
    expect(screen.getByTestId('noise-rate')).toBeInTheDocument()
    // Every row still opens, read-only ("View").
    const opens = screen.getAllByTestId('row-open')
    expect(opens).toHaveLength(SEED.length)
    for (const open of opens) expect(open).toHaveAccessibleName(/^View /)
  })

  it.each(['controller', 'evaluator'] as const)(
    'the engine mode is shown to a %s (kill switch or read-only readout)',
    async role => {
      await renderConsole(role)
      const shown = [...all('engine-kill-switch'), ...all('engine-mode-readout')]
      expect(shown).toHaveLength(1)
    },
  )

  it('H-1: an evaluator reads the engine mode from the server settings, as a status', async () => {
    await renderConsole('evaluator')
    const readout = await screen.findByTestId('engine-mode-readout')
    expect(readout.tagName).toBe('SPAN')
    expect(readout).toHaveAttribute('role', 'status')
    // The mock settings snapshot: not stopped, no clamp, effective Suggest.
    await waitFor(() => expect(readout).toHaveTextContent('ENGINE · LIVE (SUGGEST)'))
    expect(within(readout).queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([
    [
      'generation stopped (the local kill switch still says live)',
      { generationStopped: true, safetyClampActive: true, effectiveLevel: null },
      'stop',
      'ENGINE · STOPPED',
    ],
    [
      'a safety clamp with no degraded reason (the kill switch at Suggest-only)',
      { safetyClampActive: true, degradedReason: null, effectiveLevel: 'suggest' },
      'suggest-only',
      'ENGINE · SUGGEST-ONLY',
    ],
    [
      'a degraded clamp (L-G)',
      { safetyClampActive: true, degradedReason: 'provider timeouts', effectiveLevel: 'suggest' },
      'live',
      'ENGINE · LIVE (SUGGEST) (DEGRADED)',
    ],
  ] as const)('M-A: the readout follows the server, not the local store: %s', async (
    _case,
    autonomy,
    mode,
    label,
  ) => {
    serverAutonomy(autonomy)
    await renderConsole('evaluator')
    // The local kill-switch store was never touched: it still seeds 'live'.
    expect(engineControlStore.getSnapshot('ex-mock-0001').mode).toBe('live')
    const readout = screen.getByTestId('engine-mode-readout')
    expect(readout).toHaveAttribute('data-mode', mode)
    expect(readout).toHaveTextContent(label)
  })

  it('an evaluator reads the pause tier as a non-interactive status', async () => {
    await renderConsole('evaluator')
    const readout = screen.getByTestId('pause-readout')
    expect(readout.tagName).toBe('SPAN')
    expect(readout).toHaveAttribute('role', 'status')
    expect(readout).toHaveTextContent('Pause state: RUNNING')
  })

  it('L-E: a controller gets the pause pill, not the readout', async () => {
    await renderConsole('controller')
    expect(screen.getByTestId('pause-pill')).toBeInTheDocument()
    expect(screen.queryByTestId('pause-readout')).not.toBeInTheDocument()
  })

  it.each([
    ['controller', false],
    ['evaluator', true],
  ] as const)('L-A: a %s console mounts the read-only refresh: %s', async (role, mounted) => {
    vi.mocked(useReadOnlyRefresh).mockClear()
    await renderConsole(role)
    expect(vi.mocked(useReadOnlyRefresh).mock.calls.length > 0).toBe(mounted)
  })

  it('L-1: the review queue does not tell an evaluator to press A or V', async () => {
    await renderConsole('evaluator')
    const queue = screen.getByTestId('review-queue')
    expect(queue).not.toHaveTextContent(/approve \(A\)|veto \(V\)/)
    expect(queue).toHaveTextContent("Engine drafts awaiting a controller's call.")
  })

  it('M-2: the ENGINE flyout shows an evaluator the settings as text, with no lever', async () => {
    await renderConsole('evaluator')
    fireEvent.click(screen.getByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-readonly-note')).toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Exercise autonomy default' })).not.toBeInTheDocument()
    expect(screen.queryByRole('group', { name: 'Tier-policy mode' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('provider-lever-cut')).not.toBeInTheDocument()
    expect(screen.queryByTestId('provider-lever-restore')).not.toBeInTheDocument()
    // M-1: the current values are still there, as words.
    expect(screen.getByTestId('autonomy-default-readonly')).toHaveTextContent('Exercise default: Suggest')
    expect(screen.getByTestId('tier-policy-readonly')).toHaveTextContent(/^Current: /)
  })

  it('M-2 control case: a controller gets the ENGINE levers and no read-only text', async () => {
    await renderConsole('controller')
    fireEvent.click(screen.getByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByRole('group', { name: 'Exercise autonomy default' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Tier-policy mode' })).toBeInTheDocument()
    // L-F: the provider lever too (the mock provider is already Fake, so Cut is shown, inert).
    expect(screen.getByTestId('provider-lever-cut')).toBeInTheDocument()
    expect(screen.queryByTestId('engine-settings-readonly-note')).not.toBeInTheDocument()
    expect(screen.queryByTestId('autonomy-default-readonly')).not.toBeInTheDocument()
    expect(screen.queryByTestId('tier-policy-readonly')).not.toBeInTheDocument()
  })

  it.each([
    ['controller', 1],
    ['evaluator', 0],
  ] as const)('M-2: while degraded, a %s gets %i Restore control(s); the indicator stays', async (role, count) => {
    await degradeEngine()
    await renderConsole(role)
    expect(screen.getByTestId('engine-degraded-indicator')).toBeInTheDocument()
    expect(all('engine-degraded-restore')).toHaveLength(count)
  })

  it('opens the run sheet editor in view mode, with no Save', async () => {
    await renderConsole('evaluator')
    fireEvent.click(screen.getByRole('button', { name: 'View Pending one' }))
    const editor = await screen.findByTestId('inject-editor')
    expect(editor).toHaveAttribute('data-mode', 'view')
    expect(within(editor).queryByTestId('editor-save')).not.toBeInTheDocument()
    expect(within(editor).queryByTestId('editor-add-post')).not.toBeInTheDocument()
  })
})

describe('keyboard shortcuts that write are inert for an evaluator', () => {
  it('run sheet: N, F, H, S and A change nothing and open nothing', async () => {
    await renderConsole('evaluator')
    const before = queueStatuses()
    const row = first(screen.getAllByTestId('run-sheet-row'))
    row.focus()
    for (const key of ['n', 'f', 'h', 's', 'a']) fireEvent.keyDown(row, { key })
    await quiet()
    expect(queueStatuses()).toEqual(before)
    expect(screen.queryByTestId('inject-editor')).not.toBeInTheDocument()
  })

  it('run sheet: E opens the selected item read-only', async () => {
    await renderConsole('evaluator')
    const row = first(screen.getAllByTestId('run-sheet-row'))
    fireEvent.click(row)
    fireEvent.keyDown(row, { key: 'e' })
    expect(await screen.findByTestId('inject-editor')).toHaveAttribute('data-mode', 'view')
  })

  it('run sheet: Ctrl+Enter in the read-only editor saves nothing', async () => {
    await renderConsole('evaluator')
    const before = queueStatuses()
    const versions = injectMock.snapshot().items.map(i => i.version)
    fireEvent.click(screen.getByRole('button', { name: 'View Pending one' }))
    const editor = await screen.findByTestId('inject-editor')
    fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true })
    fireEvent.keyDown(editor, { key: 'Enter', metaKey: true })
    await quiet()
    expect(queueStatuses()).toEqual(before)
    expect(injectMock.snapshot().items.map(i => i.version)).toEqual(versions)
    expect(screen.getByTestId('inject-editor')).toHaveAttribute('data-mode', 'view')
  })

  it('run sheet: the Keyboard help lists only the keys that still work (move, open)', async () => {
    await renderConsole('evaluator')
    fireEvent.click(screen.getByRole('button', { name: 'Keyboard shortcuts' }))
    const help = await screen.findByTestId('keyboard-help')
    const keys = within(help).getAllByRole('term').map(term => term.textContent)
    expect(keys).toEqual(['↑ / ↓', 'E'])
  })

  it('review queue: A, V, R, E, Space (batch select) and B change nothing', async () => {
    await renderConsole('evaluator')
    const before = reviewDispositions()
    const card = first(screen.getAllByTestId('review-card'))
    card.focus()
    for (const key of ['a', 'v', 'r', 'e', ' ', 'b']) fireEvent.keyDown(card, { key })
    await quiet()
    expect(reviewDispositions()).toEqual(before)
    expect(screen.getByTestId('review-queue-status')).toHaveTextContent('')
    expect(screen.queryByTestId('review-queue-edit-slot')).not.toBeInTheDocument()
  })

  it("review queue control case: a controller's Space then B batch-approves", async () => {
    await renderConsole('controller')
    const card = first(screen.getAllByTestId('review-card'))
    card.focus()
    fireEvent.keyDown(card, { key: ' ' })
    fireEvent.keyDown(card, { key: 'b' })
    expect(screen.getByTestId('review-queue-status')).toHaveTextContent(/^Batch approved 1 draft/)
  })

  it('live world: R (Reply as…) opens nothing', async () => {
    await renderConsole('evaluator')
    const row = first(screen.getAllByTestId('live-world-row'))
    row.focus()
    fireEvent.keyDown(row, { key: 'r' })
    await quiet()
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  })

  it('Ctrl+K / ⌘K opens no persona palette', async () => {
    await renderConsole('evaluator')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    await quiet()
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  it('a controller still gets the palette from Ctrl+K (the control case)', async () => {
    await renderConsole('controller')
    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// The controller sees no change at all
// ---------------------------------------------------------------------------

const INTERACTIVE_ROLES = ['button', 'radio', 'switch', 'slider', 'checkbox', 'textbox', 'combobox']

/**
 * Every interactive control on the page, in document order, as `role|test id|name` (the name is
 * the `aria-label`, else the visible text).
 */
function controlInventory(): string[] {
  const selector = [
    'button',
    'input',
    'textarea',
    'select',
    ...INTERACTIVE_ROLES.map(role => `[role="${role}"]`),
  ].join(',')
  return Array.from(document.body.querySelectorAll<HTMLElement>(selector)).map(element => {
    const role = element.getAttribute('role') ?? element.tagName.toLowerCase()
    const testId = element.getAttribute('data-testid') ?? ''
    // A <select>'s text is every option's text run together: its id says enough.
    const name = element.tagName === 'SELECT'
      ? ''
      : (element.getAttribute('aria-label') ?? element.textContent ?? '').replace(/\s+/g, ' ').trim()
    return `${role}|${testId}|${name}`
  })
}

describe('a controller sees no change at all', () => {
  it('the controller console controls equal the list recorded before story 11', async () => {
    await renderConsole('controller')
    expect(controlInventory()).toEqual(CONTROLLER_CONTROLS_BEFORE_STORY_11)
  })
})

/**
 * The controller console's controls with the seed above, recorded on `feature/demo-feedback-w3`
 * @ e5b8d76c (before any story 11 gating). If this list changes, the controller's console changed.
 * Since then, deliberately: story 23 (DF-36) adds "Mark fired" on pending / held / failed rows.
 */
const CONTROLLER_CONTROLS_BEFORE_STORY_11: readonly string[] = [
  'button|staff-header-preview-toggle|Preview as participant',
  'button|staff-header-sign-out|Sign out',
  'button|engine-kill-switch|ENGINE · LIVE (SUGGEST) — activate to switch to ENGINE · SUGGEST-ONLY',
  'button|engine-degraded-simulate|Simulate degraded (dev)',
  'switch|swamped-mode-enable-toggle|Swamped mode is off — turn on timeout auto-send',
  'button|lifecycle-end|End exercise',
  'button|export-posts|Export posts',
  'button|pause-pill|Pause control — current state: RUNNING',
  'radio|noise-level-off|Off',
  'radio|noise-level-low|Low',
  'radio|noise-level-medium|Medium',
  'radio|noise-level-high|High',
  'slider|escalation-dial-track|Storyline escalation target',
  'select|live-world-filter|',
  'button|live-world-mark-all-read|Mark all read',
  'button|live-world-reply-as|Reply as… to Dana Reyes',
  'button|live-world-pin|Pin for everyone: the post by Dana Reyes',
  'button|takedown-trigger|Take down post by Dana Reyes',
  'button|live-world-reply-as|Reply as… to Dana Reyes',
  'button|live-world-pin|Pin for everyone: the post by Dana Reyes',
  'button|takedown-trigger|Take down post by Dana Reyes',
  'button|live-world-reply-as|Reply as… to Dana Reyes',
  'button|live-world-pin|Pin for everyone: the post by Dana Reyes',
  'button|takedown-trigger|Take down post by Dana Reyes',
  'button|live-world-reply-as|Reply as… to Tom Brandt',
  'button|live-world-pin|Pin for everyone: the post by Tom Brandt',
  'button|takedown-trigger|Take down post by Tom Brandt',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Keisha Ward',
  'button|live-world-pin|Pin for everyone: the post by Keisha Ward',
  'button|takedown-trigger|Take down post by Keisha Ward',
  'button|live-world-reply-as|Reply as… to Keisha Ward',
  'button|live-world-pin|Pin for everyone: the post by Keisha Ward',
  'button|takedown-trigger|Take down post by Keisha Ward',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Marisol Vega',
  'button|live-world-pin|Pin for everyone: the post by Marisol Vega',
  'button|takedown-trigger|Take down post by Marisol Vega',
  'button|live-world-reply-as|Reply as… to The Scoop',
  'button|live-world-pin|Pin for everyone: the post by The Scoop',
  'button|takedown-trigger|Take down post by The Scoop',
  'button|live-world-reply-as|Reply as… to Newsline 7',
  'button|live-world-pin|Pin for everyone: the post by Newsline 7',
  'button|takedown-trigger|Take down post by Newsline 7',
  'button|live-world-reply-as|Reply as… to Newsline 7',
  'button|live-world-pin|Pin for everyone: the post by Newsline 7',
  'button|takedown-trigger|Take down post by Newsline 7',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Update',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Update',
  'button|takedown-trigger|Take down post by Fairhaven Water Update',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Utility',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Utility',
  'button|takedown-trigger|Take down post by Fairhaven Water Utility',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Utility',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Utility',
  'button|takedown-trigger|Take down post by Fairhaven Water Utility',
  'button|live-world-reply-as|Reply as… to Keisha Ward',
  'button|live-world-pin|Pin for everyone: the post by Keisha Ward',
  'button|takedown-trigger|Take down post by Keisha Ward',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Update',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Update',
  'button|takedown-trigger|Take down post by Fairhaven Water Update',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Utility',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Utility',
  'button|takedown-trigger|Take down post by Fairhaven Water Utility',
  'button|live-world-reply-as|Reply as… to Tom Brandt',
  'button|live-world-pin|Pin for everyone: the post by Tom Brandt',
  'button|takedown-trigger|Take down post by Tom Brandt',
  'button|live-world-reply-as|Reply as… to Keisha Ward',
  'button|live-world-pin|Pin for everyone: the post by Keisha Ward',
  'button|takedown-trigger|Take down post by Keisha Ward',
  'button|live-world-reply-as|Reply as… to Keisha Ward',
  'button|live-world-pin|Pin for everyone: the post by Keisha Ward',
  'button|takedown-trigger|Take down post by Keisha Ward',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Marisol Vega',
  'button|live-world-pin|Pin for everyone: the post by Marisol Vega',
  'button|takedown-trigger|Take down post by Marisol Vega',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Newsline 7',
  'button|live-world-pin|Pin for everyone: the post by Newsline 7',
  'button|takedown-trigger|Take down post by Newsline 7',
  'button|live-world-reply-as|Reply as… to Fulton County EM',
  'button|live-world-pin|Pin for everyone: the post by Fulton County EM',
  'button|takedown-trigger|Take down post by Fulton County EM',
  'button|live-world-reply-as|Reply as… to Marisol Vega',
  'button|live-world-pin|Pin for everyone: the post by Marisol Vega',
  'button|takedown-trigger|Take down post by Marisol Vega',
  'button|live-world-reply-as|Reply as… to Fairhaven Water Utility',
  'button|live-world-pin|Pin for everyone: the post by Fairhaven Water Utility',
  'button|takedown-trigger|Take down post by Fairhaven Water Utility',
  'button|filter-mine|Assigned to: Mine',
  'button|filter-all|Assigned to: All',
  'button|filter-open|Status: Open',
  'button|filter-fired|Status: Fired',
  'button|filter-all|Status: All',
  'button|fire-next|Fire next pending item',
  'button|add-item|Add item',
  'button|import-from-excel|Import from Excel',
  'button|keyboard-toggle|Keyboard shortcuts',
  'button|notice-dismiss|Dismiss message',
  'button|row-fire|Fire Pending one',
  'button|row-hold|Hold Pending one',
  'button|row-skip|Skip Pending one',
  'button|row-mark-fired|Mark fired Pending one',
  'button|row-open|Edit Pending one',
  'button|row-delete|Delete Pending one',
  'button|row-move-up|Move Pending one up',
  'button|row-move-down|Move Pending one down',
  'button|row-fire|Fire Pending two',
  'button|row-hold|Hold Pending two',
  'button|row-skip|Skip Pending two',
  'button|row-mark-fired|Mark fired Pending two',
  'button|row-open|Edit Pending two',
  'button|row-delete|Delete Pending two',
  'button|row-move-up|Move Pending two up',
  'button|row-move-down|Move Pending two down',
  'button|row-release|Release Held three',
  'button|row-skip|Skip Held three',
  'button|row-mark-fired|Mark fired Held three',
  'button|row-open|Edit Held three',
  'button|row-delete|Delete Held three',
  'button|row-move-up|Move Held three up',
  'button|row-move-down|Move Held three down',
  'button|row-unskip|Unskip Skipped four',
  'button|row-open|View Skipped four',
  'button|row-delete|Delete Skipped four',
  'button|row-move-up|Move Skipped four up',
  'button|row-move-down|Move Skipped four down',
  'button|row-retry|Retry Failed five',
  'button|row-mark-fired|Mark fired Failed five',
  'button|row-open|Edit Failed five',
  'button|row-move-up|Move Failed five up',
  'button|row-move-down|Move Failed five down',
  'button|batch-approve|Batch approve [B]',
  'button|select-toggle|Select Fulton County EM draft',
  'button||Approve (A)',
  'button||Veto (V)',
  'button||Edit (E)',
  'button||Re-roll (R)',
  'button|select-toggle|Select Newsline 7 draft',
  'button|select-toggle|Select The Scoop draft',
  'button|select-toggle|Select Marisol Vega draft',
  'button|toolstrip-tool-personas|PERSONAS: 9 pending',
  'button|toolstrip-tool-engine-settings|ENGINE',
  'button|toolstrip-tool-engine-usage|USAGE',
]
