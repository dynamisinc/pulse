/**
 * features/controller/runSheet/RunSheetMockPauseBridge.test.tsx
 * ---------------------------------------------------------------------------
 * The mock pause bridge (inject-queue story 07, review M-2):
 *  - MOCK mode: the tier `usePauseState` reports is copied into the mock queue
 *    (`injectMock.setPauseTier`) on mount and on every change, and the queue read is
 *    invalidated so the banner follows at once;
 *  - the mock then behaves as the server does: under `injects` a released burst publishes
 *    nothing more but manual fire works; under `freeze` fire is refused (409);
 *  - LIVE mode: it renders nothing, never calls `usePauseState` (no pause-tier read of its
 *    own) and leaves the mock untouched (the server owns the tier live).
 *
 * `usePauseState` is mocked at the module boundary; `USE_MOCK_DATA` is a getter so the live
 * branch can be selected (the repo's precedent for flipping it per test).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { usePauseState, type PauseState, type PauseTier } from '../hooks/usePauseState'
import { RunSheetMockPauseBridge } from './RunSheetMockPauseBridge'
import { injectMock } from './injectMock'
import { InjectConflictError } from './injectErrors'

const mockFlag = vi.hoisted(() => ({ value: true }))
vi.mock('@/core/config/mockData', () => ({
  get USE_MOCK_DATA() {
    return mockFlag.value
  },
}))

vi.mock('../hooks/usePauseState', async () => {
  const actual = await vi.importActual<typeof import('../hooks/usePauseState')>(
    '../hooks/usePauseState',
  )
  return { ...actual, usePauseState: vi.fn() }
})

const mockedUsePauseState = vi.mocked(usePauseState)

function stub(tier: PauseTier): PauseState {
  return {
    tier,
    label: 'RUNNING',
    isPaused: tier !== 'running',
    isFrozen: tier === 'freeze',
    overlayRegister: 'out-of-fiction',
    setTier: vi.fn(),
    resume: vi.fn(),
    setOverlayRegister: vi.fn(),
    refusal: null,
    dismissRefusal: vi.fn(),
  }
}

function mount(client = new QueryClient()) {
  // A NEW element per render: re-rendering the same element would be bailed out by React.
  const ui = () => (
    <QueryClientProvider client={client}>
      <RunSheetMockPauseBridge />
    </QueryClientProvider>
  )
  const utils = render(ui())
  return { ...utils, client, rerenderBridge: () => utils.rerender(ui()) }
}

beforeEach(() => {
  mockFlag.value = true
  mockedUsePauseState.mockClear()
  injectMock.reset({
    seed: [
      {
        kind: 'burst',
        title: 'Burst',
        burstWindowSeconds: 60,
        posts: [
          { personaId: 'persona-fairhavenwater', text: 'one' },
          { personaId: 'persona-fairhavenwater', text: 'two' },
        ],
      },
      { kind: 'post', title: 'Solo', posts: [{ personaId: 'persona-fairhavenwater', text: 'x' }] },
    ],
  })
})

afterEach(() => {
  injectMock.dispose()
  vi.restoreAllMocks()
})

describe('RunSheetMockPauseBridge (mock mode)', () => {
  it('copies the tier into the mock queue on mount and on every change', () => {
    mockedUsePauseState.mockReturnValue(stub('injects'))
    const { rerenderBridge } = mount()
    expect(injectMock.snapshot().pauseTier).toBe('injects')

    mockedUsePauseState.mockReturnValue(stub('freeze'))
    rerenderBridge()
    expect(injectMock.snapshot().pauseTier).toBe('freeze')

    mockedUsePauseState.mockReturnValue(stub('running'))
    rerenderBridge()
    expect(injectMock.snapshot().pauseTier).toBe('running')
  })

  it('invalidates the queue read so the panel banner follows at once', () => {
    mockedUsePauseState.mockReturnValue(stub('running'))
    const client = new QueryClient()
    const invalidate = vi.spyOn(client, 'invalidateQueries')
    const { rerenderBridge } = mount(client)
    invalidate.mockClear()

    mockedUsePauseState.mockReturnValue(stub('injects'))
    rerenderBridge()
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['injects'] })
  })

  it('then the mock honours the tier like the server: injects pauses bursts but not manual fire', async () => {
    vi.useFakeTimers()
    try {
      mockedUsePauseState.mockReturnValue(stub('injects'))
      mount()
      const [burst, solo] = injectMock.snapshot().items
      if (!burst || !solo) throw new Error('seed missing')
      await injectMock.fire(burst.id)
      vi.advanceTimersByTime(300_000)
      expect(injectMock.snapshot().items[0]?.firedCount).toBe(1) // burst suspended
      expect((await injectMock.fire(solo.id)).status).toBe('fired') // manual fire still works
    } finally {
      injectMock.dispose()
      vi.useRealTimers()
    }
  })

  it('and FREEZE refuses fire with a 409', async () => {
    mockedUsePauseState.mockReturnValue(stub('freeze'))
    mount()
    const [first] = injectMock.snapshot().items
    if (!first) throw new Error('seed missing')
    await expect(injectMock.fire(first.id)).rejects.toBeInstanceOf(InjectConflictError)
  })

  it('renders nothing visible', () => {
    mockedUsePauseState.mockReturnValue(stub('running'))
    const { container } = mount()
    expect(container).toBeEmptyDOMElement()
  })
})

describe('RunSheetMockPauseBridge (live mode)', () => {
  it('renders nothing, never calls usePauseState, and leaves the mock untouched', () => {
    mockFlag.value = false
    mockedUsePauseState.mockReturnValue(stub('freeze'))
    const { container } = mount()
    expect(container).toBeEmptyDOMElement()
    expect(mockedUsePauseState).not.toHaveBeenCalled()
    expect(injectMock.snapshot().pauseTier).toBe('running')
  })
})
