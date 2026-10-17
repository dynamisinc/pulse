/**
 * features/controller/ControllerConsoleRoute.tablet.test.tsx
 * ---------------------------------------------------------------------------
 * The controller console at TABLET sizes (mobile-tablet story 12; D5-021 to D5-026,
 * docs/design/D5-controller-console/TABLET-AMENDMENT.md). The REAL `ControllerConsoleRoute` under a
 * real `SessionProvider` (the readOnlyConsole suite's setup), with a CONTROLLABLE viewport so a
 * test can rotate the device mid-session.
 *
 *  - the four signed arrangements at 1024x768, 1180x820, 768x1024 and 820x1180;
 *  - the command band: kill switch first, Pause, End exercise at the far right; sticky; not in a
 *    tab; the flyouts sit in the pane area, below it;
 *  - the pane switcher: badges are text, ARIA tabs, panes stay MOUNTED (a typed value and a
 *    scroll offset survive a tab switch and a rotation, the active tab and the open persona dock
 *    survive a rotation);
 *  - the Steering row is collapsed by default with a one-line summary, one tap opens it;
 *  - Export posts and Exercise report live in the "More" menu;
 *  - roles: a controller, an evaluator and a planner each get on a tablet what they get on a
 *    desktop (the same controls, no new ones, no guard removed);
 *  - desktop (1440) is unchanged: no tablet frame.
 */
import { act, render, screen, waitFor, within } from '@testing-library/react'
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
import { reviewStore } from './engine/services/reviewStore'
import { engineControlStore } from './engine/hooks/useEngineControl'
import { engineSettingsStore } from './engine/hooks/useEngineSettings'
import { composeAsPersonaDraftStore } from './hooks/useComposeAsPersona'
import { resetPauseStateForTest } from './hooks/usePauseState'
import { resetNoiseMockForTest } from './noise/noiseMock'
import { injectMock } from './runSheet/injectMock'
import { post, WATER } from './liveWorld/liveWorldTestKit'
import { READ_DWELL_MS } from './liveWorld/useLiveWorldUnread'
import { ControllerConsoleRoute } from './ControllerConsoleRoute'
import { resetSessionRole, setSessionRole } from './lifecycle/lifecycle.sessionKit.testUtils'

vi.setConfig({ testTimeout: 60_000 })

vi.mock('@/core/auth/sessionResolver', async importOriginal => ({
  ...(await importOriginal<typeof import('@/core/auth/sessionResolver')>()),
  resolveSession: (await import('./lifecycle/lifecycle.sessionKit.testUtils')).resolveSession,
}))

// ---------------------------------------------------------------------------
// A viewport the test can change: `matchMedia` answers from the current size and tells its
// subscribers when it changes, which is what a rotation does.

let viewport = { width: 1440, height: 900 }
const listeners = new Set<() => void>()

function stubViewport(width: number, height: number) {
  viewport = { width, height }
  vi.stubGlobal('matchMedia', (query: string) => {
    const evaluate = () => {
      const minWidth = /min-width:\s*(\d+)px/.exec(query)
      const minHeight = /min-height:\s*(\d+)px/.exec(query)
      if (minWidth) return viewport.width >= Number(minWidth[1])
      if (minHeight) return viewport.height >= Number(minHeight[1])
      return false
    }
    return {
      get matches() {
        return evaluate()
      },
      media: query,
      onchange: null,
      addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }
  })
}

/** Rotates / resizes the device: the queries re-evaluate and every subscriber is told. */
function resizeTo(width: number, height: number) {
  viewport = { width, height }
  act(() => {
    listeners.forEach(listener => listener())
  })
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
  injectMock.reset()
})

afterEach(() => {
  listeners.clear()
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

async function renderConsole(role: ExerciseRole, width: number, height: number) {
  setSessionRole(role)
  stubViewport(width, height)
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
  await waitFor(() => expect(screen.getAllByTestId('run-sheet-row').length).toBeGreaterThan(0))
  await waitFor(() => expect(screen.getAllByTestId('live-world-row').length).toBeGreaterThan(0))
  await waitFor(() => expect(screen.getAllByTestId('review-card').length).toBeGreaterThan(0))
}

/** Ctrl+K, then pick a persona in the palette: the persona dock opens. */
async function openDock(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard('{Control>}k{/Control}')
  await user.click(await screen.findByTestId('persona-picker-option-persona-fairhavenwater'))
  await screen.findByTestId('persona-composer')
}

const visible = (testId: string) => getComputedStyle(screen.getByTestId(testId)).visibility === 'visible'
const tabNamed = (name: RegExp) => screen.getByRole('tab', { name })

describe('the signed arrangements', () => {
  it('1180x820: Live world | Run sheet side by side, Review docked at 296px', async () => {
    await renderConsole('controller', 1180, 820)
    expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'landscapeWide')
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument()
    expect(visible('console-slot-live-world')).toBe(true)
    expect(visible('console-slot-run-sheet')).toBe(true)
    expect(visible('review-queue-column')).toBe(true)
    expect(getComputedStyle(screen.getByTestId('console-slots')).gridTemplateColumns).toBe(
      'minmax(0, 1fr) minmax(0, 1fr) 296px',
    )
  })

  it('1024x768: one Live world / Run sheet switcher, Review docked at 296px', async () => {
    await renderConsole('controller', 1024, 768)
    expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'landscape')
    expect(screen.getAllByRole('tab').map(tab => tab.id)).toEqual([
      'console-pane-tab-live-world',
      'console-pane-tab-run-sheet',
    ])
    expect(visible('console-slot-live-world')).toBe(true)
    expect(visible('console-slot-run-sheet')).toBe(false)
    expect(visible('review-queue-column')).toBe(true)
    expect(getComputedStyle(screen.getByTestId('console-slots')).gridTemplateColumns).toBe(
      'minmax(0, 1fr) 296px',
    )
  })

  it('768x1024: a full tab switcher with Review as a badged tab', async () => {
    await renderConsole('controller', 768, 1024)
    expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'portrait')
    expect(screen.getAllByRole('tab')).toHaveLength(3)
    expect(visible('console-slot-live-world')).toBe(true)
    expect(visible('review-queue-column')).toBe(false)
    expect(tabNamed(/Review/)).toHaveTextContent(/\d+ · \d+ under 60s/)
  })

  it('820x1180: the switcher above a docked Review queue, about 60/40', async () => {
    await renderConsole('controller', 820, 1180)
    expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'portraitTall')
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(visible('review-queue-column')).toBe(true)
    expect(getComputedStyle(screen.getByTestId('console-slots')).gridTemplateRows).toBe(
      'auto minmax(0, 3fr) minmax(0, 2fr)',
    )
  })

  it('1440: the desktop console, no tablet frame', async () => {
    await renderConsole('controller', 1440, 900)
    expect(screen.queryByTestId('console-tablet-frame')).not.toBeInTheDocument()
    expect(screen.queryByTestId('console-command-band')).not.toBeInTheDocument()
    expect(screen.getByTestId('console-slots')).toHaveAttribute('data-layout', 'split')
  })
})

describe('the command band', () => {
  it('holds the kill switch first, then Pause, then End exercise at the far right', async () => {
    await renderConsole('controller', 1024, 768)
    const band = screen.getByTestId('console-command-band')
    const killSwitch = within(band).getByTestId('engine-kill-switch')
    const pause = within(band).getByRole('button', { name: /pause/i })
    const endExercise = within(band).getByRole('button', { name: /end exercise/i })
    const follows = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)
    expect(follows(killSwitch, pause)).toBe(true)
    expect(follows(pause, endExercise)).toBe(true)
    expect(within(band).getByTestId('console-command-band-end')).toContainElement(endExercise)
    expect(getComputedStyle(band).position).toBe('sticky')
  })

  it('is outside every tab and every panel, and not a second copy of the desktop strip', async () => {
    await renderConsole('controller', 768, 1024)
    const band = screen.getByTestId('console-command-band')
    expect(band.closest('[role="tabpanel"]')).toBeNull()
    expect(screen.getAllByTestId('engine-kill-switch')).toHaveLength(1)
    // Switching tabs never moves or hides it.
    await userEvent.setup().click(tabNamed(/Run sheet/))
    expect(getComputedStyle(band).visibility).toBe('visible')
    expect(within(band).getByTestId('engine-kill-switch')).toBeVisible()
  })

  it('is not part of the pane area the flyouts are positioned over', async () => {
    await renderConsole('controller', 1180, 820)
    const frame = screen.getByTestId('console-tablet-frame')
    const band = screen.getByTestId('console-command-band')
    const paneArea = screen.getByTestId('console-slots').closest('[data-testid="console-tablet-frame"] > div:last-child')
    expect(frame.firstElementChild).toBe(band)
    expect(paneArea).not.toBeNull()
    expect(paneArea).not.toContainElement(band)
  })
})

describe('the tab badges', () => {
  it('say what needs attention in text: "N new", "N due", "N · M under 60s"', async () => {
    await renderConsole('controller', 768, 1024)
    await waitFor(() => expect(screen.getByTestId('console-pane-badge-live-world')).toHaveTextContent(/^\d+ new$/))
    await waitFor(() => expect(screen.getByTestId('console-pane-badge-run-sheet')).toHaveTextContent(/^\d+ due$/))
    expect(screen.getByTestId('console-pane-badge-review')).toHaveTextContent(/^\d+ · \d+ under 60s$/)
    // "due" counts the run sheet items still waiting to be fired.
    const pending = injectMock.snapshot().items.filter(item => item.status === 'pending').length
    expect(screen.getByTestId('console-pane-badge-run-sheet')).toHaveTextContent(`${pending} due`)
  })
})

describe('panes stay mounted', () => {
  it('keeps a hidden pane mounted: a typed value and a scroll offset survive a tab switch', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    const live = screen.getByTestId('console-slot-live-world')
    const marker = document.createElement('input')
    marker.setAttribute('data-testid', 'half-typed')
    live.appendChild(marker)
    await user.type(marker, 'half a thought')
    live.scrollTop = 40

    await user.click(tabNamed(/Run sheet/))
    expect(visible('console-slot-live-world')).toBe(false)
    expect(visible('console-slot-run-sheet')).toBe(true)
    expect(screen.getByTestId('half-typed')).toBe(marker)

    await user.click(tabNamed(/Live world/))
    expect(screen.getByTestId('half-typed')).toBe(marker)
    expect(marker).toHaveValue('half a thought')
    expect(live.scrollTop).toBe(40)
  })

  it('keeps the active tab and the pane contents through a rotation', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    await user.click(tabNamed(/Run sheet/))
    const sheet = screen.getByTestId('console-slot-run-sheet')
    const marker = document.createElement('input')
    marker.setAttribute('data-testid', 'half-typed')
    sheet.appendChild(marker)
    await user.type(marker, 'edit in flight')

    resizeTo(768, 1024)
    await waitFor(() =>
      expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'portrait'),
    )
    expect(tabNamed(/Run sheet/)).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('console-slot-run-sheet')).toBe(sheet)
    expect(screen.getByTestId('half-typed')).toBe(marker)
    expect(marker).toHaveValue('edit in flight')
    expect(visible('console-slot-run-sheet')).toBe(true)

    // Review is a tab in portrait; select it, rotate back, and the choice is still remembered.
    await user.click(tabNamed(/Review/))
    resizeTo(1024, 768)
    await waitFor(() =>
      expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'landscape'),
    )
    expect(visible('review-queue-column')).toBe(true)
    resizeTo(768, 1024)
    await waitFor(() => expect(tabNamed(/Review/)).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByTestId('half-typed')).toBe(marker)
  })

  it('keeps the persona dock open through a rotation', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    await openDock(user)
    const composer = await screen.findByTestId('persona-dock-host')
    resizeTo(768, 1024)
    await waitFor(() =>
      expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'portrait'),
    )
    expect(screen.getByTestId('persona-dock-host')).toBe(composer)
  })

  it('puts the persona dock inside the pane area, not over the command band', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    await openDock(user)
    const dock = await screen.findByTestId('persona-dock-host')
    expect(screen.getByTestId('console-command-band').contains(dock)).toBe(false)
    expect(screen.getByTestId('console-tablet-frame').contains(dock)).toBe(true)
  })
})

// A controllable IntersectionObserver (jsdom has none): the test reports a row as in view.
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = []
  readonly observed = new Set<Element>()
  private readonly callback: IntersectionObserverCallback
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback
    FakeIntersectionObserver.instances.push(this)
  }
  observe(element: Element) { this.observed.add(element) }
  unobserve(element: Element) { this.observed.delete(element) }
  disconnect() { this.observed.clear() }
  takeRecords(): IntersectionObserverEntry[] { return [] }
  report(element: Element, ratio: number) {
    const entry = { target: element, isIntersecting: ratio > 0, intersectionRatio: ratio }
    this.callback(
      [entry as unknown as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    )
  }
}

describe('a hidden Live world pane reads nothing (CR-001)', () => {
  it('keeps counting a post while its tab is hidden, and drains it once the tab shows', async () => {
    const user = userEvent.setup()
    FakeIntersectionObserver.instances = []
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver)
    Object.defineProperty(document, 'hasFocus', { configurable: true, value: () => true })
    try {
      await renderConsole('controller', 1024, 768)
      const badge = () => Number(/^(\d+) new$/.exec(
        screen.getByTestId('console-pane-badge-live-world').textContent ?? '',
      )?.[1])
      await user.click(tabNamed(/Run sheet/))
      expect(visible('console-slot-live-world')).toBe(false)
      const before = badge()

      act(() => postStore.appendPost(post('live-while-hidden', {
        authorPersonaId: WATER,
        text: 'Arrives while nobody is looking',
        scenarioTime: '2033-09-04T23:30:00.000Z',
      })))
      await waitFor(() => expect(badge()).toBe(before + 1))
      const row = screen.getAllByTestId('live-world-row')
        .find(element => element.dataset.postId === 'live-while-hidden')
      if (row === undefined) throw new Error('the arrival has no row')
      const io = FakeIntersectionObserver.instances.at(-1)
      if (io === undefined) throw new Error('no IntersectionObserver')

      // The hidden pane keeps its box, so the observer reports the row as in view.
      vi.useFakeTimers()
      try {
        act(() => io.report(row, 1))
        act(() => { vi.advanceTimersByTime(READ_DWELL_MS + 100) })
      } finally {
        vi.useRealTimers()
      }
      expect(badge()).toBe(before + 1)

      // Showing the pane starts the dwell for the rows already in view: they drain.
      await user.click(tabNamed(/Live world/))
      await waitFor(() => expect(badge()).toBe(before), { timeout: 4000 })
    } finally {
      delete (document as unknown as Record<string, unknown>).hasFocus
    }
  })
})

describe('the Steering row', () => {
  it('is collapsed by default, with a one-line text summary, and opens in one tap', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1180, 820)
    const toggle = screen.getByTestId('console-steering-toggle')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByTestId('console-steering-summary')).toHaveTextContent(
      /^Storyline target (\d+|none|unknown) · Noise \S+/,
    )
    expect(screen.getByTestId('world-steering-panel')).not.toBeVisible()

    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByTestId('world-steering-panel')).toBeVisible()
    expect(within(screen.getByTestId('world-steering-panel')).getByTestId('noise-control')).toBeVisible()
    expect(screen.queryByTestId('console-steering-summary')).not.toBeInTheDocument()
  })

  it('follows a noise change into the summary without a second noise read', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1180, 820)
    await user.click(screen.getByTestId('console-steering-toggle'))
    const high = within(screen.getByTestId('noise-control')).getByRole('radio', { name: /high/i })
    await user.click(high)
    await user.click(screen.getByTestId('console-steering-toggle'))
    await waitFor(() =>
      expect(screen.getByTestId('console-steering-summary')).toHaveTextContent('Noise High'),
    )
  })
})

describe('the More menu', () => {
  it('holds Export posts and Exercise report on a tablet, and the title row holds neither', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    const more = screen.getByTestId('console-more-menu')
    expect(more).toHaveAttribute('aria-label', 'More actions')
    expect(getComputedStyle(more).minHeight).toBe('44px')
    expect(screen.getByTestId('console-more-menu-panel')).toBeInTheDocument()
    expect(screen.getByTestId('export-posts')).not.toBeVisible()

    await user.click(more)
    const panel = await screen.findByTestId('console-more-menu-panel')
    expect(within(panel).getByTestId('export-posts')).toBeVisible()
    expect(within(panel).getByTestId('exercise-report')).toBeVisible()
  })

  it('is not used on the desktop console, where both buttons sit in the title row', async () => {
    await renderConsole('controller', 1440, 900)
    expect(screen.queryByTestId('console-more-menu')).not.toBeInTheDocument()
    expect(screen.getByTestId('export-posts')).toBeVisible()
    expect(screen.getByTestId('exercise-report')).toBeVisible()
  })
})

describe('roles on a tablet', () => {
  const WRITE_CONTROLS = ['engine-kill-switch', 'console-shortcut-strip'] as const

  it('a controller gets the kill switch, the shortcut strip, End exercise and no View-only chip', async () => {
    await renderConsole('controller', 1180, 820)
    for (const id of WRITE_CONTROLS) expect(screen.getByTestId(id)).toBeInTheDocument()
    expect(within(screen.getByTestId('console-command-band')).getByRole('button', { name: /end exercise/i }))
      .toBeInTheDocument()
    expect(screen.queryByTestId('console-view-only-chip')).not.toBeInTheDocument()
    expect(screen.getByTestId('export-posts')).toBeInTheDocument()
  })

  it.each(['evaluator', 'planner'] as const)(
    'a %s gets on a tablet what they get on desktop: read-only, no write control added',
    async role => {
      await renderConsole(role, 1180, 820)
      for (const id of WRITE_CONTROLS) {
        // A planner may post as a persona (identity-auth-roles story 17: content-editing role), so
        // the ⌘K shortcut strip stays for them exactly as on desktop; the kill switch does not.
        if (role === 'planner' && id === 'console-shortcut-strip') {
          expect(screen.getByTestId(id)).toBeInTheDocument()
          continue
        }
        expect(screen.queryByTestId(id)).not.toBeInTheDocument()
      }
      // The chip names the role: an evaluator is "View only", a planner holds the content tools.
      expect(
        screen.getByTestId(role === 'planner' ? 'console-planner-chip' : 'console-view-only-chip'),
      ).toBeInTheDocument()
      expect(
        within(screen.getByTestId('console-command-band')).queryByRole('button', { name: /end exercise/i }),
      ).not.toBeInTheDocument()
      // The read-only surfaces stay (Export posts is any staff role, DF-14).
      expect(screen.getByTestId('export-posts')).toBeInTheDocument()
    },
  )
})

describe('touch and keyboard parity (story 14, D5-024)', () => {
  it('Cmd+K from an iPad hardware keyboard toggles the palette and is preventDefault-ed', async () => {
    await renderConsole('controller', 1024, 768)
    const open = new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(open) })
    // The browser / iPadOS default for the chord is suppressed.
    expect(open.defaultPrevented).toBe(true)
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()

    const close = new KeyboardEvent('keydown', { key: 'K', metaKey: true, bubbles: true, cancelable: true })
    act(() => { window.dispatchEvent(close) })
    expect(close.defaultPrevented).toBe(true)
    await waitFor(() => expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument())
  })

  it('touch only: tapping the PERSONAS tool opens the palette; one tap on a persona opens the dock', async () => {
    const user = userEvent.setup()
    await renderConsole('controller', 1024, 768)
    await user.click(screen.getByTestId('toolstrip-tool-personas'))
    expect(await screen.findByTestId('command-palette')).toBeInTheDocument()
    await user.click(await screen.findByTestId('persona-picker-option-persona-fairhavenwater'))
    expect(await screen.findByTestId('persona-composer')).toBeInTheDocument()
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument()
  })

  it('focus in the Review pane survives a rotation that turns Review into a tab', async () => {
    await renderConsole('controller', 1024, 768)
    const [card] = screen.getAllByTestId('review-card')
    if (card === undefined) throw new Error('no review card rendered')
    act(() => card.focus())
    expect(card).toHaveFocus()

    resizeTo(768, 1024)
    await waitFor(() =>
      expect(screen.getByTestId('console-tablet-frame')).toHaveAttribute('data-band', 'portrait'),
    )
    // The pane holding focus was selected, so focus is neither hidden nor dropped to <body>.
    expect(tabNamed(/Review/)).toHaveAttribute('aria-selected', 'true')
    expect(visible('review-queue-column')).toBe(true)
    expect(document.activeElement).not.toBe(document.body)
    expect(card).toHaveFocus()
  })

  it('the shortcut strip is the key hint on a fine pointer (the tap hint is in shortcutHints.test)', async () => {
    await renderConsole('controller', 1024, 768)
    // jsdom's stub answers every pointer query false: a fine pointer, the key hint.
    expect(screen.getByTestId('console-shortcut-strip')).toHaveAttribute('data-pointer', 'fine')
  })
})
