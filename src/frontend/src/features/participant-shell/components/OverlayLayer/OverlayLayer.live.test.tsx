/**
 * features/participant-shell/components/OverlayLayer/OverlayLayer.live.test.tsx
 * ---------------------------------------------------------------------------
 * The END-TO-END frontend proof for world-steering story 08 (CTL-023,
 * D5-014/1.3, AC2/AC3/AC5): a live server push reaches the ALREADY-BUILT,
 * UNMODIFIED `OverlayLayer.tsx` and shows/clears the correct register's holding
 * page with NO manual refresh.
 *
 * Unlike `OverlayLayer.test.tsx` (which mocks `./overlayState` wholesale to
 * drive each render branch), this file deliberately does NOT mock that seam —
 * it is the wiring that is under test. `USE_MOCK_DATA` is mocked to `false` to
 * select the live branch; the shared realtime connection is a fake (the store's
 * own `ensureStarted(connection)` seam, so no second/real hub connection is
 * built); `../../chromeConfig` is mocked exactly as the sibling suite does, so
 * no extra provider is needed for the NFR-008 watermark slot.
 *
 * World: participant. `OverlayLayer.tsx` is untouched by this story — that it
 * needs no change is the point.
 */
import type { ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { OverlayLayer } from './OverlayLayer'
import { liveOverlayStateStore } from './overlayState'
import { useChromeConfig } from '../../chromeConfig'
import type { ChromeConfig } from '../../mountContract'

const getMock = vi.fn()

vi.mock('@/core/config/mockData', () => ({ USE_MOCK_DATA: false }))

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
  },
}))

vi.mock('@/core/exerciseContext', () => ({
  useExerciseContext: () => ({
    exerciseId: 'ex-test-overlay-live-0001',
    exerciseName: 'Overlay Live Test Exercise',
    timeZone: 'UTC',
    status: 'active',
  }),
}))

vi.mock('../../chromeConfig', () => ({
  useChromeConfig: vi.fn(),
  isWatermarkRequired: (config: { enabled: boolean }) => !config.enabled,
}))

const CHROME_ENABLED: ChromeConfig = {
  enabled: true,
  top: { text: 'top', fg: '#000000', bg: '#ffffff' },
  bottom: { text: 'bottom', fg: '#000000', bg: '#ffffff' },
}

class FakeConnection implements RealtimeConnection {
  state: HubConnectionState = HubConnectionState.Disconnected

  private readonly pushHandlers = new Set<RealtimeEventHandler>()
  private readonly stateListeners = new Set<(state: HubConnectionState) => void>()

  subscribe(eventName: string, handler: RealtimeEventHandler): () => void {
    if (eventName !== 'OverlayStateChanged') return () => {}
    this.pushHandlers.add(handler)
    return () => this.pushHandlers.delete(handler)
  }

  onStateChange(listener: (state: HubConnectionState) => void): () => void {
    this.stateListeners.add(listener)
    return () => this.stateListeners.delete(listener)
  }

  start(): Promise<void> {
    return Promise.resolve()
  }

  push(payload: unknown): void {
    act(() => {
      for (const handler of this.pushHandlers) handler(payload)
    })
  }
}

function Wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

let connection: FakeConnection

beforeEach(() => {
  vi.mocked(useChromeConfig).mockReturnValue(CHROME_ENABLED)
  getMock.mockReset()
  getMock.mockResolvedValue({ data: { state: 'none', register: 'in-fiction', message: '', sequence: 0 } })
  connection = new FakeConnection()
  // Pre-start with the fake so the component's own idempotent `ensureStarted()`
  // no-ops rather than building a real HubConnection.
  liveOverlayStateStore.ensureStarted(connection)
})

afterEach(() => {
  liveOverlayStateStore.resetForTests()
})

describe('OverlayLayer + the live overlay-state push (world-steering/08)', () => {
  it('renders nothing until a Freeze arrives, then shows the out-of-fiction holding page live', async () => {
    render(<OverlayLayer />, { wrapper: Wrapper })

    expect(screen.queryByTestId('pulse-overlay-pause-out-of-fiction')).not.toBeInTheDocument()

    connection.push({ state: 'pause', register: 'out-of-fiction', message: '', sequence: 1 })

    const page = await screen.findByTestId('pulse-overlay-pause-out-of-fiction')
    expect(page).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'EXERCISE PAUSED' })).toBeInTheDocument()
    expect(page).toHaveAttribute('aria-modal', 'true')
  })

  it('renders the in-fiction register\'s copy when that is the pushed register (AC5)', async () => {
    render(<OverlayLayer />, { wrapper: Wrapper })

    connection.push({ state: 'pause', register: 'in-fiction', message: '', sequence: 1 })

    expect(await screen.findByTestId('pulse-overlay-pause-in-fiction')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: "We'll be right back" })).toBeInTheDocument()
    expect(screen.queryByText('EXERCISE PAUSED')).not.toBeInTheDocument()
  })

  it('clears the holding page when the Resume push arrives — no manual refresh (AC3)', async () => {
    render(<OverlayLayer />, { wrapper: Wrapper })
    connection.push({ state: 'pause', register: 'out-of-fiction', message: '', sequence: 1 })
    expect(await screen.findByTestId('pulse-overlay-pause-out-of-fiction')).toBeInTheDocument()

    connection.push({ state: 'none', register: 'in-fiction', message: '', sequence: 2 })

    await waitFor(() =>
      expect(screen.queryByTestId('pulse-overlay-pause-out-of-fiction')).not.toBeInTheDocument(),
    )
  })

  it('shows the holding page from the SEEDING GET alone, for a participant who joins mid-Freeze (AC4)', async () => {
    liveOverlayStateStore.resetForTests()
    getMock.mockResolvedValue({
      data: { state: 'pause', register: 'out-of-fiction', message: '', sequence: 5 },
    })
    liveOverlayStateStore.ensureStarted(connection)

    render(<OverlayLayer />, { wrapper: Wrapper })

    expect(await screen.findByTestId('pulse-overlay-pause-out-of-fiction')).toBeInTheDocument()
  })
})
