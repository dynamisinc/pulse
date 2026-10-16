/**
 * features/controller/engine/services/liveReviewStore.refresh.test.ts
 * ---------------------------------------------------------------------------
 * Refresh discipline of the LIVE review store (see its "REFRESH DISCIPLINE" header):
 *  - N expired drafts nudging the shared scheduler => exactly one GET in flight, constant rate;
 *  - the scheduler backs off (3 s -> 10 s -> 30 s) when the same expired set never resolves
 *    (FullStop) and stops when nothing is expired;
 *  - a stale GET response never erases a pushed-in draft nor reverts a pushed terminal state;
 *  - an older GET never overwrites a newer committed one.
 * GET resolution is controlled with deferred promises.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetExerciseClock, setExerciseClock } from '@/core/clock'
import { HubConnectionState } from '@/core/realtime/connection'
import type { RealtimeConnection, RealtimeEventHandler } from '@/core/realtime/connection'
import { liveReviewStore } from './liveReviewStore'

const getMock = vi.fn()

vi.mock('@/core/services/api', () => ({
  api: {
    get: (...args: unknown[]) => getMock(...args),
    post: () => Promise.resolve({ data: {} }),
  },
}))

interface Deferred {
  readonly promise: Promise<{ data: unknown }>
  resolve: (data: unknown) => void
}

function deferred(): Deferred {
  let resolve: (data: unknown) => void = () => {}
  const promise = new Promise<{ data: unknown }>(res => {
    resolve = data => res({ data })
  })
  return { promise, resolve }
}

class PushConnection implements RealtimeConnection {
  state = HubConnectionState.Disconnected
  private handler: RealtimeEventHandler | null = null
  subscribe(_event: string, handler: RealtimeEventHandler): () => void {
    this.handler = handler
    return () => {}
  }
  onStateChange(_handler?: (state: HubConnectionState) => void): () => void {
    return () => {}
  }
  stop(): Promise<void> {
    return Promise.resolve()
  }
  start(): Promise<void> {
    return Promise.resolve()
  }
  push(payload: unknown): void {
    this.handler?.(payload)
  }
}

/** A PushConnection whose connection-state changes the test can drive (hub Connected). */
class StatefulConnection extends PushConnection {
  private stateHandler: ((state: HubConnectionState) => void) | null = null
  override onStateChange(handler: (state: HubConnectionState) => void): () => void {
    this.stateHandler = handler
    return () => {}
  }
  emitState(state: HubConnectionState): void {
    this.stateHandler?.(state)
  }
}

function wireItem(draftId: string, disposition = 'counting-down') {
  return {
    exerciseId: 'ex-1',
    storylineId: 'story-1',
    draftId,
    routedAtLevel: 'delayed-auto',
    disposition,
    countdown: {
      exerciseId: 'ex-1',
      storylineId: 'story-1',
      draftId,
      startedScenarioMinute: 10,
      countdownMinutes: 3,
      decision: 'none',
    },
    posts: [{ personaHandle: 'FulcoEM', text: 't', sentiment: 0, hashtags: [] }],
    storylineTag: '#T',
    storylineBrief: 'b',
    actionLabel: 'reply',
  }
}

const ids = () => liveReviewStore.getItems().map(i => i.draftId)

async function settle(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0)
}

beforeEach(() => {
  vi.useFakeTimers()
  getMock.mockReset()
  liveReviewStore.resetForTests()
  // Scenario minute 20: every countdown (deadline minute 13) is expired.
  setExerciseClock({ scenarioNow: () => new Date(20 * 60_000) })
})

afterEach(() => {
  liveReviewStore.resetForTests()
  resetExerciseClock()
  vi.useRealTimers()
})

describe('expiry scheduler - one poller, coalesced, backed off', () => {
  it('several expired drafts => exactly one GET in flight and a constant 3 s rate', async () => {
    const queue = ['a', 'b', 'c'].map(d => wireItem(d))
    getMock.mockImplementation(() => Promise.resolve({ data: queue }))
    const connection = new PushConnection()
    // seed the snapshot with the expired drafts
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    getMock.mockClear()

    // five "drivers" nudge at once
    for (let i = 0; i < 5; i += 1) liveReviewStore.requestExpiryRefresh()
    await settle()
    expect(getMock).toHaveBeenCalledTimes(1)

    await vi.advanceTimersByTimeAsync(2999)
    expect(getMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(getMock).toHaveBeenCalledTimes(2)
    // more nudges mid-run change nothing
    liveReviewStore.requestExpiryRefresh()
    await vi.advanceTimersByTimeAsync(3000)
    expect(getMock).toHaveBeenCalledTimes(3)
  })

  it('a refresh requested while a GET is pending reuses it (no second request)', async () => {
    const d = deferred()
    getMock.mockReturnValue(d.promise)
    const first = liveReviewStore.refetch()
    const second = liveReviewStore.refetch()
    await settle()
    expect(getMock).toHaveBeenCalledTimes(1)
    d.resolve([])
    await Promise.all([first, second])
    expect(getMock).toHaveBeenCalledTimes(1)
  })

  it('backs off 3 s -> 10 s -> 30 s when the same expired set never resolves', async () => {
    getMock.mockImplementation(() => Promise.resolve({ data: [wireItem('a')] }))
    liveReviewStore.requestExpiryRefresh()
    await settle()
    const callsAfter = async (ms: number) => {
      const before = getMock.mock.calls.length
      await vi.advanceTimersByTimeAsync(ms)
      return getMock.mock.calls.length - before
    }
    // First polls at the 3 s cadence...
    expect(await callsAfter(3000)).toBe(1)
    expect(await callsAfter(3000)).toBe(1)
    // ...burn through the first step (5 unchanged polls), then 3 s no longer suffices.
    await vi.advanceTimersByTimeAsync(3000 * 4)
    expect(await callsAfter(3000)).toBe(0)
    expect(await callsAfter(7000)).toBe(1) // 10 s step
    // Burn through the 10 s step, then the cap is 30 s.
    await vi.advanceTimersByTimeAsync(10_000 * 5)
    expect(await callsAfter(10_000)).toBe(0)
    expect(await callsAfter(20_000)).toBe(1) // 30 s step
    expect(await callsAfter(30_000)).toBe(1)
    expect(await callsAfter(30_000)).toBe(1) // capped, not growing
  })

  it('stops polling once nothing is expired any more', async () => {
    getMock
      .mockResolvedValueOnce({ data: [wireItem('a')] })
      .mockResolvedValue({ data: [wireItem('a', 'held')] })
    liveReviewStore.requestExpiryRefresh()
    await settle()
    await vi.advanceTimersByTimeAsync(3000) // second poll: resolved
    const calls = getMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMock).toHaveBeenCalledTimes(calls)
  })
})

describe('stale-response guard', () => {
  it('a draft pushed while a GET is pending survives the stale response', async () => {
    const connection = new PushConnection()
    const stale = deferred()
    const fresh = deferred()
    getMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()

    connection.push(wireItem('new-draft'))
    expect(ids()).toEqual(['new-draft'])

    stale.resolve([]) // predates the push
    await settle()
    expect(ids()).toEqual(['new-draft']) // not erased
    expect(getMock).toHaveBeenCalledTimes(2) // one fresh follow-up
    fresh.resolve([wireItem('new-draft')])
    await settle()
    expect(ids()).toEqual(['new-draft'])
  })

  it('a Published push during a pending GET is not reverted to CountingDown', async () => {
    const connection = new PushConnection()
    getMock.mockResolvedValueOnce({ data: [wireItem('a')] })
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    expect(ids()).toEqual(['a'])

    const stale = deferred()
    const fresh = deferred()
    getMock.mockReturnValueOnce(stale.promise).mockReturnValueOnce(fresh.promise)
    const refresh = liveReviewStore.refetch()
    connection.push(wireItem('a', 'published'))
    expect(ids()).toEqual([])

    stale.resolve([wireItem('a')]) // still says CountingDown
    await settle()
    expect(ids()).toEqual([]) // not resurrected
    fresh.resolve([])
    await refresh
    expect(ids()).toEqual([])
  })

  it('an older GET does not overwrite a newer committed one', async () => {
    const connection = new PushConnection()
    const older = deferred()
    const newer = deferred()
    getMock.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise)
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    // the session ends and restarts: a second GET overlaps the first
    liveReviewStore.resetForTests()
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    expect(getMock).toHaveBeenCalledTimes(2)

    newer.resolve([wireItem('new')])
    await settle()
    older.resolve([wireItem('old')])
    await settle()
    expect(ids()).toEqual(['new'])
  })
})

describe('invalidation - trailing refresh', () => {
  it('hub Connected during the initial GET => one trailing GET reveals a pre-join draft', async () => {
    const connection = new StatefulConnection()
    const first = deferred()
    const trailing = deferred()
    getMock.mockReturnValueOnce(first.promise).mockReturnValueOnce(trailing.promise)
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    expect(getMock).toHaveBeenCalledTimes(1)

    connection.emitState(HubConnectionState.Connected)
    connection.emitState(HubConnectionState.Connected) // collapses into one trailing GET
    await settle()
    expect(getMock).toHaveBeenCalledTimes(1)

    first.resolve([]) // predates draft X, no push was delivered for it
    await settle()
    expect(ids()).toEqual([])
    expect(getMock).toHaveBeenCalledTimes(2)

    trailing.resolve([wireItem('x', 'queued')])
    await settle()
    expect(ids()).toEqual(['x'])
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMock).toHaveBeenCalledTimes(2)
  })

  it('expiry nudges during an in-flight GET still coalesce (no extra GET)', async () => {
    const connection = new StatefulConnection()
    const first = deferred()
    getMock.mockReturnValueOnce(first.promise)
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    for (let i = 0; i < 3; i += 1) liveReviewStore.requestExpiryRefresh()
    void liveReviewStore.refetch()
    await settle()
    first.resolve([])
    await settle()
    expect(getMock).toHaveBeenCalledTimes(1)
  })
})

describe('exhausted stale retries - backed-off reconciliation', () => {
  it('recovers a server-only draft after three conflicting GETs, then stops', async () => {
    const connection = new PushConnection()
    const g1 = deferred()
    const g2 = deferred()
    const g3 = deferred()
    getMock
      .mockReturnValueOnce(g1.promise)
      .mockReturnValueOnce(g2.promise)
      .mockReturnValueOnce(g3.promise)
      .mockResolvedValue({ data: ['a', 'b', 'c', 'd'].map(d => wireItem(d, 'queued')) })
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()

    const withA = [wireItem('a', 'queued')]
    connection.push(wireItem('b', 'queued'))
    g1.resolve(withA)
    await settle()
    connection.push(wireItem('c', 'queued'))
    g2.resolve(withA)
    await settle()
    connection.push(wireItem('d', 'queued'))
    g3.resolve(withA)
    await settle()
    expect(getMock).toHaveBeenCalledTimes(3)
    expect(ids()).toEqual(['b', 'c', 'd']) // A still hidden

    await vi.advanceTimersByTimeAsync(1999)
    expect(getMock).toHaveBeenCalledTimes(3)
    await vi.advanceTimersByTimeAsync(1)
    await settle()
    expect(getMock).toHaveBeenCalledTimes(4)
    expect(ids().sort()).toEqual(['a', 'b', 'c', 'd'])

    await vi.advanceTimersByTimeAsync(120_000) // success cancels the reconciliation
    expect(getMock).toHaveBeenCalledTimes(4)
  })

  it('keeps retrying with backoff (2 s, 5 s, 15 s cap) while GETs keep conflicting', async () => {
    const connection = new PushConnection()
    let n = 0
    getMock.mockImplementation(() => {
      n += 1
      connection.push(wireItem(`p${n}`, 'queued')) // a push lands during every GET
      return Promise.resolve({ data: [] })
    })
    liveReviewStore.ensureStarted(connection as unknown as RealtimeConnection)
    await settle()
    const base = getMock.mock.calls.length
    expect(base).toBe(3)
    await vi.advanceTimersByTimeAsync(2000)
    expect(getMock.mock.calls.length).toBe(base + 3)
    await vi.advanceTimersByTimeAsync(4999)
    expect(getMock.mock.calls.length).toBe(base + 3)
    await vi.advanceTimersByTimeAsync(1)
    expect(getMock.mock.calls.length).toBe(base + 6)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getMock.mock.calls.length).toBe(base + 9)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(getMock.mock.calls.length).toBe(base + 12)
    liveReviewStore.resetForTests() // clears the pending timer
    getMock.mockClear()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(getMock).not.toHaveBeenCalled()
  })
})
