/**
 * features/controller/access/plannerConsole.test.tsx
 * ---------------------------------------------------------------------------
 * identity-auth-roles story 17 (Tom-approved 2026-10-17): a PLANNER may enter `/staff/console`.
 * The REAL `ControllerConsoleRoute` under a real `SessionProvider` with a planner session (same
 * harness as `readOnlyConsole.test.tsx`; the mock exercise is `live`). Every controller-only and
 * lead-only control must be absent (or disabled with words); inject authoring stays available.
 *
 * The persona palette / dock is planner + controller (`useCanEditContent`): a planner has the
 * PERSONAS tool and "Edit persona"; reply-as and conduct posting stay controller-only; an
 * evaluator has none of it.
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { resetPauseStateForTest } from '../hooks/usePauseState'
import { resetNoiseMockForTest } from '../noise/noiseMock'
import { injectMock, MOCK_DEMO_SEED, MOCK_ME } from '../runSheet/injectMock'
import type { InjectItemWrite } from '../runSheet/types'
import { ControllerConsoleRoute } from '../ControllerConsoleRoute'
import { resetSessionRole, setSessionRole } from '../lifecycle/lifecycle.sessionKit.testUtils'

// Whole-console renders (MUI + emotion + several feature trees) are slow on a loaded box.
vi.setConfig({ testTimeout: 60_000 })

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

const all = (testId: string): HTMLElement[] => screen.queryAllByTestId(testId)

/** Controller-only / lead-only controls: none may exist for a planner. */
const ABSENT_FOR_PLANNER: ReadonlyArray<readonly [string, string]> = [
  ['Run sheet: Fire next', 'fire-next'],
  ['Run sheet row: Fire', 'row-fire'],
  ['Run sheet row: Retry', 'row-retry'],
  ['Run sheet row: Release', 'row-release'],
  ['Run sheet row: Hold', 'row-hold'],
  ['Run sheet row: Skip', 'row-skip'],
  ['Run sheet row: Unskip', 'row-unskip'],
  ['Run sheet row: Mark fired', 'row-mark-fired'],
  ['Live world: Take down', 'takedown-trigger'],
  ['Live world: Pin for everyone (live state)', 'live-world-pin'],
  ['Live world: Reply as', 'live-world-reply-as'],
  ['Pause pill (steering tiers)', 'pause-pill'],
  ['Escalation dial (steering)', 'escalation-dial'],
  ['White noise level buttons', 'noise-level-group'],
  ['StartEx / EndEx', 'exercise-lifecycle-control'],
  ['Swamped mode switch (on/off)', 'swamped-mode-enable-toggle'],
  ['Swamped mode OFF-only control', 'swamped-mode-turn-off'],
  ['Engine kill switch (and so the restore step)', 'engine-kill-switch'],
  ['Degraded Restore', 'engine-degraded-restore'],
  ['Review queue: Batch approve', 'batch-approve'],
  ['Review queue: Approve / Veto / Edit / Re-roll', 'card-actions'],
]

describe('a planner in the controller console (story 17)', () => {
  it.each(ABSENT_FOR_PLANNER)('%s: absent', async (_name, testId) => {
    await renderConsole('planner')
    expect(all(testId)).toHaveLength(0)
  })

  it('autonomy / tier raise and provider restore are not enabled (engine settings need the controller tool)', async () => {
    await renderConsole('planner')
    // The ENGINE settings tool belongs to the controller toolstrip; if it is offered, no lever
    // may be enabled for a planner.
    for (const id of [
      'autonomy-default-delayed-auto',
      'tier-policy-standard',
      'tier-policy-auto',
      'provider-lever-restore',
    ]) {
      for (const control of all(id)) expect(control).toBeDisabled()
    }
  })

  it('inject authoring is available: Add, Import from Excel, Edit, Delete and reorder', async () => {
    await renderConsole('planner')
    expect(all('add-item')).toHaveLength(1)
    expect(all('import-from-excel')).toHaveLength(1)
    const edits = all('row-open').filter(b => /^Edit /.test(b.getAttribute('aria-label') ?? ''))
    expect(edits.length).toBeGreaterThan(0)
    expect(all('row-delete').length).toBeGreaterThan(0)
    expect(all('row-move-up').length).toBeGreaterThan(0)
    expect(all('row-move-down').length).toBeGreaterThan(0)
  })

  it('has the PERSONAS tool and, once a persona is chosen, Edit persona; no composer outside build', async () => {
    const user = userEvent.setup()
    await renderConsole('planner')
    await user.click(screen.getByTestId('toolstrip-tool-personas'))
    const palette = await screen.findByRole('dialog', { name: /command palette/i })
    const options = within(palette).getAllByRole('option')
    expect(options.length).toBeGreaterThan(0)
    await user.click(options[0] as HTMLElement)
    expect(await screen.findByTestId('persona-edit-button')).toBeEnabled()
    // The mock exercise is live: conduct posting is controller-only, so no composer.
    expect(screen.queryByTestId('persona-composer')).not.toBeInTheDocument()
    expect(all('live-world-reply-as')).toHaveLength(0)
  })

  it('keeps the read surfaces: run sheet, live world, review cards, Export posts', async () => {
    await renderConsole('planner')
    expect(screen.getAllByTestId('run-sheet-row')).toHaveLength(SEED.length)
    expect(screen.getAllByTestId('live-world-row').length).toBeGreaterThan(0)
    expect(screen.getAllByTestId('review-card').length).toBeGreaterThan(0)
    expect(screen.getByTestId('export-posts')).toBeEnabled()
  })
})
describe('an evaluator in the controller console: no persona tool at all', () => {
  it('has no PERSONAS tool and Ctrl+K opens nothing', async () => {
    const user = userEvent.setup()
    await renderConsole('evaluator')
    expect(all('toolstrip-tool-personas')).toHaveLength(0)
    await user.keyboard('{Control>}k{/Control}')
    expect(screen.queryByRole('dialog', { name: /command palette/i })).not.toBeInTheDocument()
    expect(all('persona-edit-button')).toHaveLength(0)
  })
})
