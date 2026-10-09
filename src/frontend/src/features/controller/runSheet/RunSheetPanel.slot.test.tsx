/**
 * features/controller/runSheet/RunSheetPanel.slot.test.tsx
 * ---------------------------------------------------------------------------
 * AC "Staff world only ... the panel is self-contained (`RunSheetPanel`, no props) so the
 * orchestrator mounts it through C4's `runSheetSlot`." This mounts the REAL
 * `ControllerConsole` with `runSheetSlot={() => <RunSheetPanel />}` - exactly the line the
 * orchestrator adds to `ControllerConsoleRoute.tsx` - and checks that the panel needs
 * nothing else, sits in the console's labelled "Run sheet" region, works inside it, and
 * does not disturb the console's own keyboard (the review queue's shortcuts).
 */
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import { ControllerConsole } from '../components/ControllerConsole'
import { RunSheetPanel } from './RunSheetPanel'
import { readStoredSheet } from './runSheetStorage'
import {
  MOCK_EXERCISE_ID,
  beatFixture,
  resetRunSheetWorld,
  seedStoredSheet,
  sheetFixture,
  useFixedClock,
} from './runSheetTestKit'

/** jsdom has no `matchMedia`; the console picks split / stacked from it. */
function testQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function stubViewport(widthPx: number) {
  vi.stubGlobal('matchMedia', (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query)
    return {
      matches: min ? widthPx >= Number(min[1]) : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  })
}

// Full-panel renders (MUI + emotion + the exercise context) are slow on a loaded CI box:
// give each test a generous budget instead of the 10s default.
vi.setConfig({ testTimeout: 30_000 })

beforeEach(() => {
  resetRunSheetWorld()
  useFixedClock('2033-09-04T14:00:30Z')
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  stubViewport(1440)
})
afterEach(() => {
  resetRunSheetWorld()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  vi.unstubAllGlobals()
})

function renderConsoleWithRunSheet() {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <QueryClientProvider client={testQueryClient()}>
        <ExerciseContextProvider>
          <ToolstripProvider>
            <ActivePersonaProvider>
              <ControllerConsole runSheetSlot={() => <RunSheetPanel />} />
            </ActivePersonaProvider>
          </ToolstripProvider>
        </ExerciseContextProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  )
}

describe('RunSheetPanel mounted through the console\'s runSheetSlot', () => {
  it('renders, prop-less, inside the labelled "Run sheet" region', async () => {
    renderConsoleWithRunSheet()
    const region = await screen.findByRole('region', { name: 'Run sheet' })
    expect(within(region).getByTestId('run-sheet-panel')).toBeInTheDocument()
    expect(within(region).getByRole('heading', { name: 'RUN SHEET' })).toBeInTheDocument()
    expect(screen.getByTestId('console-slots')).toHaveAttribute('data-layout', 'stacked')
  })

  it('fires a beat from inside the console, as a controller-as-persona post', async () => {
    seedStoredSheet(MOCK_EXERCISE_ID, sheetFixture([
      beatFixture({ id: 'b1', order: 1, title: 'Boil notice' }),
    ]))
    const user = userEvent.setup({ delay: null })
    renderConsoleWithRunSheet()
    const panel = await screen.findByTestId('run-sheet-panel')
    await waitFor(() => expect(panel).toHaveAttribute('data-personas', 'ready'))

    await user.click(screen.getByTestId('beat-row-b1'))
    await user.keyboard('f')
    await waitFor(() =>
      expect(within(screen.getByTestId('beat-row-b1')).getByTestId('beat-status'))
        .toHaveTextContent('Fired'))
    const read = readStoredSheet(MOCK_EXERCISE_ID)
    const postId = read.kind === 'ok' ? read.data.runtime.b1?.firedPostId : undefined
    expect(postStore.getPosts().find(post => post.id === postId)?.origin).toBe('controller-as-persona')
  })

  it('keeps its single-letter shortcuts inside the panel (the console\'s own keys are untouched)', async () => {
    seedStoredSheet(MOCK_EXERCISE_ID, sheetFixture([beatFixture({ id: 'b1', order: 1 })]))
    const user = userEvent.setup({ delay: null })
    renderConsoleWithRunSheet()
    const panel = await screen.findByTestId('run-sheet-panel')
    await waitFor(() => expect(panel).toHaveAttribute('data-personas', 'ready'))

    // Focus is outside the panel (the document): a stray N / F fires nothing.
    await user.click(screen.getByTestId('controller-console'))
    await user.keyboard('nfse')
    expect(within(screen.getByTestId('beat-row-b1')).getByTestId('beat-status'))
      .toHaveTextContent('Pending')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
