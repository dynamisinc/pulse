/**
 * features/controller/liveWorld/LiveWorldColumn.inConsole.test.tsx
 * ---------------------------------------------------------------------------
 * The Live world column MOUNTED THROUGH C4's `liveWorldSlot` in the real
 * `ControllerConsole` (demo-polish C2 + the orchestrator's slot wiring,
 * implementation.md §4.2) — the contract the route file implements:
 *
 *   liveWorldSlot={ctx => <LiveWorldColumn
 *     onReplyAs={replyTo => ctx.openComposer({ replyTo })} />}
 *
 * Proves, on the real console: the column lands in the labelled "Live world"
 * region and owns its own scroll (the console grid gives it a shrinkable flex
 * column); "Reply as…" reaches `ctx.openComposer` with the `ReplyTarget` (here the
 * console opens the ⌘K palette because no persona is active — it never opens an
 * empty dock); the column is reachable beside the other staff tools; and the
 * region still holds exactly one "LIVE WORLD" title.
 *
 * Mirrors `ControllerConsole.slots.test.tsx`'s render setup (real
 * `ExerciseContextProvider` + `ToolstripProvider` + `ActivePersonaProvider`);
 * jsdom has no `matchMedia`, so the viewport is stubbed.
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ThemeProvider } from '@mui/material/styles'
import { cobraTheme } from '@/theme/cobraTheme'
import { ExerciseContextProvider } from '@/core/exerciseContext'
import { ToolstripProvider } from '@/features/staffShell/toolRegistry'
import { Toolstrip } from '@/features/staffShell/components/Toolstrip'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { resetTelemetryBuffer } from '@/core/telemetry'
import { postStore } from '@/features/social/services/postStore'
import { reviewStore } from '../engine/services/reviewStore'
import { engineControlStore } from '../engine/hooks/useEngineControl'
import { engineSettingsStore } from '../engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from '../hooks/useComposeAsPersona'
import { ActivePersonaProvider } from '../hooks/useActivePersona'
import { ControllerConsole, type ReplyTarget } from '../components/ControllerConsole'
import { LiveWorldColumn } from './LiveWorldColumn'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests({ withDemoFixtures: true })
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
  vi.stubGlobal('matchMedia', (query: string) => ({
    // A 1440px-wide viewport: every `(min-width:Npx)` query with N <= 1440 matches.
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
  postStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  vi.unstubAllGlobals()
})

function renderConsoleWithColumn(onOpen: (replyTo: ReplyTarget | undefined) => void) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ActivePersonaProvider>
            <ControllerConsole
              liveWorldSlot={ctx => (
                <LiveWorldColumn
                  onReplyAs={replyTo => {
                    onOpen(replyTo)
                    ctx.openComposer({ replyTo })
                  }}
                />
              )}
            />
            <Toolstrip />
          </ActivePersonaProvider>
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

describe('LiveWorldColumn mounted through ControllerConsole.liveWorldSlot', { timeout: 20000 }, () => {
  it('lands in the labelled "Live world" region, with one title and its own scroll', async () => {
    renderConsoleWithColumn(vi.fn())
    const region = await screen.findByRole('region', { name: 'Live world' })
    await within(region).findAllByTestId('live-world-row')

    expect(within(region).getAllByRole('heading', { name: 'LIVE WORLD' })).toHaveLength(1)
    const column = within(region).getByTestId('live-world-column')
    expect(getComputedStyle(column).flexGrow).toBe('1')
    expect(getComputedStyle(column).minHeight).toBe('0px')
    expect(getComputedStyle(within(region).getByTestId('live-world-list')).overflowY).toBe('auto')
  })

  it('"Reply as…" reaches ctx.openComposer with the ReplyTarget (palette opens: no persona active)', async () => {
    const onOpen = vi.fn()
    renderConsoleWithColumn(onOpen)
    const region = await screen.findByRole('region', { name: 'Live world' })
    const rows = await within(region).findAllByTestId('live-world-row')
    const first = rows[0]
    if (first === undefined) throw new Error('no rows')

    await userEvent.setup().click(within(first).getByTestId('live-world-reply-as'))

    expect(onOpen).toHaveBeenCalledTimes(1)
    const target = onOpen.mock.calls[0]?.[0] as ReplyTarget
    expect(target.postId).toBe(first.dataset.postId)
    expect(target.excerpt.length).toBeLessThanOrEqual(140)
    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
  })

  it('keeps the column\'s title bar and scenario-time label free of dev copy (cf. the C4 string scan)', async () => {
    renderConsoleWithColumn(vi.fn())
    const region = await screen.findByRole('region', { name: 'Live world' })
    await within(region).findAllByTestId('live-world-row')

    const chrome = [
      screen.getByTestId('live-world-column').querySelector('header')?.textContent ?? '',
      screen.getByTestId('live-world-zone').textContent ?? '',
    ].join(' ')
    expect(chrome).not.toMatch(/\b(land|Wave|TODO|mock)\b/i)
  })
})
