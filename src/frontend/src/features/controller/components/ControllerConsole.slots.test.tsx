/**
 * features/controller/components/ControllerConsole.slots.test.tsx
 * ---------------------------------------------------------------------------
 * Covers the console cleanup + main-area slots (feature: demo-polish, story C4,
 * docs/features/demo-polish/20-console-cleanup.md):
 *
 *  - SLOTS. `liveWorldSlot` / `runSheetSlot` are render props receiving a
 *    `ConsoleSlotContext`; they lay out as Live world | Run sheet (split) at a
 *    viewport >= 1280px and stack below it; with NO slot the area shows one
 *    concise status line, not placeholder panels; with one slot that column is
 *    alone.
 *  - `openComposer`. With a `personaId` it selects that persona and opens the
 *    persona dock; without one it reopens the persona last worked with, or opens
 *    the palette when none has been chosen yet; it closes an open ENGINE flyout
 *    first so the dock is not left gated off behind it.
 *  - DEV COPY GONE. The "dock here as they land" paragraph is replaced by a short
 *    ⌘K / Ctrl+K shortcut strip, and no visible string in the console contains
 *    "land", "Wave", "TODO" or "mock" (string-scan over text + labels).
 *  - The ⌘K palette still opens from the shortcut strip's promise (Ctrl+K).
 *
 * Mirrors `ControllerConsole.test.tsx`'s render setup (real
 * `ExerciseContextProvider` + `ToolstripProvider` + the shipped `<Toolstrip>`).
 * jsdom has no `window.matchMedia`, so the viewport is stubbed per test
 * (`stubViewport`) — the split/stacked choice is driven by `useMediaQuery`.
 */
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
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
import {
  ControllerConsole,
  type ConsoleSlotContext,
  type ControllerConsoleProps,
  type ReplyTarget,
} from './ControllerConsole'

beforeEach(() => {
  setExerciseClock({ scenarioNow: () => new Date('2033-09-04T14:00:30Z') })
  postStore.resetForTests()
  reviewStore.resetForTests()
  engineControlStore.resetForTests()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  resetTelemetryBuffer()
})

afterEach(() => {
  resetExerciseClock()
  engineSettingsStore.resetForTests()
  composeAsPersonaDraftStore.resetForTests()
  vi.unstubAllGlobals()
})

/** Stubs `window.matchMedia` so `(min-width:Npx)` queries resolve against `widthPx`. */
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

function renderConsole(props: ControllerConsoleProps = {}) {
  return render(
    <ThemeProvider theme={cobraTheme}>
      <ExerciseContextProvider>
        <ToolstripProvider>
          <ControllerConsole {...props} />
          <Toolstrip />
        </ToolstripProvider>
      </ExerciseContextProvider>
    </ThemeProvider>,
  )
}

/** A slot that renders a button which calls `openComposer` with `opts`. */
function composerButton(
  label: string,
  opts?: Parameters<ConsoleSlotContext['openComposer']>[0],
): (ctx: ConsoleSlotContext) => ReactNode {
  return ctx => (
    <button type="button" onClick={() => ctx.openComposer(opts)}>
      {label}
    </button>
  )
}

const REPLY_TARGET: ReplyTarget = {
  postId: 'post-1',
  authorHandle: 'someone',
  authorDisplayName: 'Some One',
  excerpt: 'an excerpt',
}

const DOCK_SLOTS = { composer: <div data-testid="fake-composer">composer</div> }

describe('ControllerConsole — main-area slots', () => {
  it('renders each slot inside a labelled section, passing a ConsoleSlotContext', async () => {
    const liveWorldSlot = vi.fn((ctx: ConsoleSlotContext) => {
      void ctx
      return <div data-testid="live-world-content">live</div>
    })
    const runSheetSlot = vi.fn((ctx: ConsoleSlotContext) => {
      void ctx
      return <div data-testid="run-sheet-content">sheet</div>
    })
    renderConsole({ liveWorldSlot, runSheetSlot })
    await screen.findByTestId('controller-console')

    const live = screen.getByRole('region', { name: 'Live world' })
    const sheet = screen.getByRole('region', { name: 'Run sheet' })
    expect(within(live).getByTestId('live-world-content')).toBeInTheDocument()
    expect(within(sheet).getByTestId('run-sheet-content')).toBeInTheDocument()

    expect(liveWorldSlot).toHaveBeenCalled()
    expect(liveWorldSlot.mock.calls[0]?.[0]).toEqual({ openComposer: expect.any(Function) })
    expect(runSheetSlot.mock.calls[0]?.[0]).toEqual({ openComposer: expect.any(Function) })
    // With slots supplied the "nothing connected" line is gone.
    expect(screen.queryByTestId('console-slots-status')).not.toBeInTheDocument()
  })

  it('with NO slot supplied shows one concise status line and no placeholder panels', async () => {
    renderConsole()
    await screen.findByTestId('controller-console')

    expect(screen.getByTestId('console-slots-status')).toHaveTextContent(
      'Live world and run sheet are not connected to this console.',
    )
    expect(screen.queryByTestId('console-slots')).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Live world' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Run sheet' })).not.toBeInTheDocument()
  })

  it('with only one slot supplied renders just that column and no status line', async () => {
    renderConsole({ runSheetSlot: () => <div>only the sheet</div> })
    await screen.findByTestId('controller-console')

    expect(screen.getByRole('region', { name: 'Run sheet' })).toHaveTextContent('only the sheet')
    expect(screen.queryByRole('region', { name: 'Live world' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-slots-status')).not.toBeInTheDocument()
  })

  it('gives a lone slot the full width even on a wide viewport (no half-empty split)', async () => {
    stubViewport(1920)
    renderConsole({ liveWorldSlot: () => <div>only live</div> })
    await screen.findByTestId('controller-console')

    const grid = screen.getByTestId('console-slots')
    expect(grid).toHaveAttribute('data-layout', 'stacked')
    expect(getComputedStyle(grid).gridTemplateColumns).toBe('minmax(0, 1fr)')
  })

  describe('layout', () => {
    const slots: ControllerConsoleProps = {
      liveWorldSlot: () => <div>live</div>,
      runSheetSlot: () => <div>sheet</div>,
    }

    it('splits Live world | Run sheet into two equal columns at a >= 1280px viewport', async () => {
      stubViewport(1440)
      renderConsole(slots)
      await screen.findByTestId('controller-console')

      const grid = screen.getByTestId('console-slots')
      expect(grid).toHaveAttribute('data-layout', 'split')
      expect(grid).toHaveStyle({ display: 'grid' })
      expect(getComputedStyle(grid).gridTemplateColumns).toBe('repeat(2, minmax(0, 1fr))')
    })

    it('splits at exactly 1280px', async () => {
      stubViewport(1280)
      renderConsole(slots)
      await screen.findByTestId('controller-console')

      expect(screen.getByTestId('console-slots')).toHaveAttribute('data-layout', 'split')
    })

    it('stacks one column below 1280px, Live world first', async () => {
      stubViewport(1279)
      renderConsole(slots)
      await screen.findByTestId('controller-console')

      const grid = screen.getByTestId('console-slots')
      expect(grid).toHaveAttribute('data-layout', 'stacked')
      expect(getComputedStyle(grid).gridTemplateColumns).toBe('minmax(0, 1fr)')

      const [first, second] = Array.from(grid.children)
      expect(first).toBe(screen.getByRole('region', { name: 'Live world' }))
      expect(second).toBe(screen.getByRole('region', { name: 'Run sheet' }))
    })

    it('keeps Live world on the left of Run sheet when split', async () => {
      stubViewport(1920)
      renderConsole(slots)
      await screen.findByTestId('controller-console')

      const children = Array.from(screen.getByTestId('console-slots').children)
      expect(children).toEqual([
        screen.getByRole('region', { name: 'Live world' }),
        screen.getByRole('region', { name: 'Run sheet' }),
      ])
    })
  })
})

describe('ControllerConsole — ConsoleSlotContext.openComposer', () => {
  it('selects the given persona and opens the persona dock', async () => {
    const user = userEvent.setup()
    renderConsole({
      dockSlots: DOCK_SLOTS,
      liveWorldSlot: composerButton('Reply as…', { personaId: 'persona-fairhavenwater', replyTo: REPLY_TARGET }),
    })
    await screen.findByTestId('controller-console')
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Reply as…' }))

    const dock = await screen.findByTestId('persona-dock-host')
    expect(within(dock).getByTestId('fake-composer')).toBeInTheDocument()
    // The dock is a named region, focus moved inside it.
    expect(screen.getByRole('region', { name: 'Post as persona' })).toBe(dock)
  })

  it('opens the ⌘K palette when no persona is named and none has been chosen yet', async () => {
    const user = userEvent.setup()
    renderConsole({
      dockSlots: DOCK_SLOTS,
      liveWorldSlot: composerButton('Reply as…', { replyTo: REPLY_TARGET }),
    })
    await screen.findByTestId('controller-console')

    await user.click(screen.getByRole('button', { name: 'Reply as…' }))

    expect(await screen.findByRole('dialog', { name: /command palette/i })).toBeInTheDocument()
    expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument()
  })

  it('reopens the persona last worked with when none is named', async () => {
    const user = userEvent.setup()
    renderConsole({
      dockSlots: DOCK_SLOTS,
      liveWorldSlot: ctx => (
        <>
          <button type="button" onClick={() => ctx.openComposer({ personaId: 'persona-fulcoem' })}>
            Open as Fulco
          </button>
          <button type="button" onClick={() => ctx.openComposer()}>
            Open again
          </button>
        </>
      ),
    })
    await screen.findByTestId('controller-console')

    await user.click(screen.getByRole('button', { name: 'Open as Fulco' }))
    const dock = await screen.findByTestId('persona-dock-host')
    await user.click(within(dock).getByRole('button', { name: /close post-as-persona panel/i }))
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())

    await user.click(screen.getByRole('button', { name: 'Open again' }))

    expect(await screen.findByTestId('persona-dock-host')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes an open ENGINE flyout so the dock is not left gated off behind it', async () => {
    const user = userEvent.setup()
    renderConsole({
      dockSlots: DOCK_SLOTS,
      runSheetSlot: composerButton('Compose', { personaId: 'persona-fairhavenwater' }),
    })
    await screen.findByTestId('controller-console')

    await user.click(await screen.findByTestId('toolstrip-tool-engine-settings'))
    expect(await screen.findByTestId('engine-settings-panel')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Compose' }))

    expect(await screen.findByTestId('persona-dock-host')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTestId('engine-settings-panel')).not.toBeInTheDocument())
  })

  it('the dock opened through a slot closes on Escape, like a palette-opened one', async () => {
    const user = userEvent.setup()
    renderConsole({
      dockSlots: DOCK_SLOTS,
      liveWorldSlot: composerButton('Compose', { personaId: 'persona-fairhavenwater' }),
    })
    await screen.findByTestId('controller-console')

    await user.click(screen.getByRole('button', { name: 'Compose' }))
    await screen.findByTestId('persona-dock-host')

    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTestId('persona-dock-host')).not.toBeInTheDocument())
  })
})

describe('ControllerConsole — dev copy is gone, replaced by a shortcut strip', () => {
  it('shows a short ⌘K / Ctrl+K shortcut strip that says what it does', async () => {
    renderConsole()
    await screen.findByTestId('controller-console')

    const strip = screen.getByTestId('console-shortcut-strip')
    expect(strip).toHaveTextContent('⌘K')
    expect(strip).toHaveTextContent('Ctrl+K')
    expect(strip).toHaveTextContent(/post as a persona/i)
    expect(strip.querySelectorAll('kbd')).toHaveLength(2)
  })

  it('no longer carries the old paragraph', async () => {
    renderConsole()
    const consoleRoot = await screen.findByTestId('controller-console')

    expect(consoleRoot).not.toHaveTextContent(/dock here/i)
    expect(consoleRoot).not.toHaveTextContent(/as they land/i)
    expect(consoleRoot).not.toHaveTextContent(/other surfaces/i)
    expect(consoleRoot).not.toHaveTextContent(/engine review queue is docked/i)
  })

  /** Every string a user could see or hear in `root`: text + title/aria-label/placeholder. */
  function visibleStrings(root: HTMLElement): string[] {
    const out: string[] = [root.textContent ?? '']
    for (const el of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
      for (const attr of ['title', 'aria-label', 'placeholder', 'alt']) {
        const value = el.getAttribute(attr)
        if (value) out.push(value)
      }
    }
    return out
  }

  // The AC bans these four words as SUBSTRINGS of any visible string.
  const BANNED = /land|wave|todo|mock/i

  it('no visible string in the idle console contains "land", "Wave", "TODO" or "mock"', async () => {
    renderConsole()
    const consoleRoot = await screen.findByTestId('controller-console')

    const offenders = visibleStrings(consoleRoot).filter(text => BANNED.test(text))
    expect(offenders).toEqual([])
  })

  it('...nor with both slots mounted and the ⌘K palette open', async () => {
    const user = userEvent.setup()
    renderConsole({
      liveWorldSlot: () => <div>live</div>,
      runSheetSlot: () => <div>sheet</div>,
    })
    const consoleRoot = await screen.findByTestId('controller-console')
    await user.keyboard('{Control>}k{/Control}')
    const palette = await screen.findByRole('dialog', { name: /command palette/i })

    const offenders = [...visibleStrings(consoleRoot), ...visibleStrings(palette)].filter(text =>
      BANNED.test(text),
    )
    expect(offenders).toEqual([])
  })

  it('the shortcut strip does not lie: Ctrl+K opens the palette that "posts as a persona"', async () => {
    const user = userEvent.setup()
    renderConsole()
    await screen.findByTestId('controller-console')

    await user.keyboard('{Control>}k{/Control}')

    const palette = await screen.findByRole('dialog', { name: /command palette/i })
    expect(within(palette).getByRole('region', { name: 'Personas' })).toBeInTheDocument()
  })
})
