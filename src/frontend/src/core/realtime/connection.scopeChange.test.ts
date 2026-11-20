/**
 * core/realtime/connection.scopeChange.test.ts
 * ---------------------------------------------------------------------------
 * #856: the shared hub connection when the session's EXERCISE changes without a sign-in (a staff
 * switch), and after a terminal close that is not a sign-out.
 *
 * The server cuts the old connection on a switch, SignalR's auto-reconnect would rejoin as the
 * new exercise before the console commits it, and the hub refuses long-poll/SSE requests whose
 * user changed. So the switch owner calls `stop('scope-changed')` BEFORE the switch request and
 * `resume()` once the new scope is committed. Asserted against the REAL wrapper over fake hub
 * connections (`@/test/fakeHubConnection`), on fake timers:
 *  - stop('scope-changed') ends the connection with that reason, nobody restarts it on their
 *    own, `resume()` opens ONE new connection on the CURRENT token with handlers re-attached;
 *  - a consumer that restarts on `'stopped'` builds exactly one connection;
 *  - a stop during a start in flight leaves no overtaken connection live; back-to-back switches
 *    end on a single live connection;
 *  - a terminal close rebuilds ONCE with the current token and recovers; the rebuild budget is
 *    refilled only after STABLE_CONNECTION_MS of staying connected, so a hub that accepts and
 *    then drops us cannot loop; no rebuild when signed out or after a deliberate stop;
 *  - a listener that synchronously restarts on the close owns the restart (one new connection);
 *  - a late frame from the abandoned connection reaches nobody;
 *  - a failed rebuild announces the loss only if its connection is still the current one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { HubConnectionState, STABLE_CONNECTION_MS } from './connection'
import type { RealtimeStateReason } from './connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport } from '@/test/fakeHubConnection'
import type { FakeTransport } from '@/test/fakeHubConnection'

const flush = () => vi.advanceTimersByTimeAsync(0)

interface Seen {
  readonly state: HubConnectionState
  readonly reason: RealtimeStateReason | undefined
}

function observe(transport: FakeTransport): Seen[] {
  const seen: Seen[] = []
  transport.connection.onStateChange((state, reason) => seen.push({ state, reason }))
  return seen
}

const reasonlessLoss = (seen: Seen[]) =>
  seen.filter(s => s.state === HubConnectionState.Disconnected && s.reason === undefined).length

beforeEach(() => {
  vi.useFakeTimers()
  setTokens({ token: 'token-exercise-A' })
})
afterEach(() => {
  vi.useRealTimers()
  clearTokens()
})

describe('stop(scope-changed) then resume() - the exercise switch', () => {
  it('ends with the scope-changed reason; nobody restarts it; resume opens one connection on the current token', async () => {
    const transport = createFakeTransport()
    const received: unknown[] = []
    transport.connection.subscribe('PostReceived', p => received.push(p))
    await transport.connection.start()
    const seen = observe(transport)
    const [first] = transport.fakes
    expect(first?.startedWithToken).toBe('token-exercise-A')

    void transport.connection.stop('scope-changed')
    await flush()

    expect(seen).toEqual([{ state: HubConnectionState.Disconnected, reason: 'scope-changed' }])
    expect(transport.fakes).toHaveLength(1) // not restarted on the old principal
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)

    setTokens({ token: 'token-exercise-B' })
    await transport.connection.resume()

    expect(transport.fakes).toHaveLength(2)
    const second = transport.latest()
    expect(second.startedWithToken).toBe('token-exercise-B')
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
    second.emit('PostReceived', 'hello')
    first?.emit('PostReceived', 'late-from-old')
    expect(received).toEqual(['hello'])
  })

  it('resume() shares a start a consumer already made, and does nothing when nothing is subscribed', async () => {
    const idle = createFakeTransport()
    await idle.connection.resume()
    expect(idle.fakes).toHaveLength(0)

    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    void transport.connection.stop('scope-changed')
    await flush()
    void transport.connection.start() // a consumer's own re-attach got there first
    await transport.connection.resume()
    expect(transport.fakes).toHaveLength(2)
  })

  it('resume() never rejects when the new connection cannot start', async () => {
    const transport = createFakeTransport((fake, index) => {
      if (index === 1) fake.startImpl = () => Promise.reject(new Error('403'))
    })
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    void transport.connection.stop('scope-changed')
    await expect(transport.connection.resume()).resolves.toBeUndefined()
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('a consumer that restarts on "stopped" builds exactly one connection', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    transport.connection.onStateChange((_state, reason) => {
      if (reason === 'stopped') void transport.connection.start().catch(() => {})
    })

    void transport.connection.stop() // a sign-in's reset
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
  })

  it('a stop during a start in flight leaves no overtaken connection live', async () => {
    let hold: { release: () => void } | undefined
    const transport = createFakeTransport((fake, index) => {
      if (index === 0) {
        fake.completesDespiteStop = true // a transport that finishes its handshake anyway
        hold = fake.holdStart()
      }
    })
    transport.connection.subscribe('X', () => {})
    const inFlight = transport.connection.start()
    inFlight.catch(() => {})

    void transport.connection.stop('scope-changed')
    hold?.release()
    await flush()
    await flush()
    expect(transport.fakes[0]?.state).toBe(HubConnectionState.Disconnected)

    await transport.connection.resume()
    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[0]?.state).toBe(HubConnectionState.Disconnected)
    expect(transport.latest().state).toBe(HubConnectionState.Connected)
  })

  it('two back-to-back switches end on a single live connection on the latest token', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()

    void transport.connection.stop('scope-changed')
    setTokens({ token: 'token-exercise-B' })
    await transport.connection.resume()
    void transport.connection.stop('scope-changed')
    setTokens({ token: 'token-exercise-C' })
    await transport.connection.resume()
    await flush()

    expect(transport.fakes).toHaveLength(3)
    expect(transport.fakes.filter(f => f.state === HubConnectionState.Connected)).toHaveLength(1)
    expect(transport.latest().startedWithToken).toBe('token-exercise-C')
  })
})

describe('terminal close that is not a sign-out', () => {
  it('rebuilds once with the current token and recovers', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    setTokens({ token: 'token-exercise-B' })

    transport.latest().triggerClose()
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.latest().startedWithToken).toBe('token-exercise-B')
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
  })

  it('a hub that keeps refusing gets one rebuild, then the loss is announced (no storm)', async () => {
    const transport = createFakeTransport((fake, index) => {
      if (index >= 1) fake.startImpl = () => Promise.reject(new Error('403'))
    })
    const seen = observe(transport)
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()

    transport.latest().triggerClose()
    await flush()
    await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS * 3)

    expect(transport.fakes).toHaveLength(2)
    expect(transport.latest().startCallCount).toBe(1)
    expect(reasonlessLoss(seen)).toBeGreaterThan(0)
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('a rebuilt connection that connects and then drops again and again: one rebuild per window, no loop', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()

    transport.latest().triggerClose() // rebuild #1 (budget spent)
    await flush()
    expect(transport.fakes).toHaveLength(2)

    for (let i = 0; i < 6; i += 1) {
      await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS - 1000) // never stable long enough
      transport.latest().triggerClose()
      await flush()
    }
    expect(transport.fakes).toHaveLength(2) // no further rebuild
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('refills the budget after the connection stayed up for STABLE_CONNECTION_MS', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    transport.latest().triggerClose()
    await flush()
    expect(transport.fakes).toHaveLength(2)

    await vi.advanceTimersByTimeAsync(STABLE_CONNECTION_MS)
    transport.latest().triggerClose()
    await flush()
    expect(transport.fakes).toHaveLength(3)
  })

  it('does not rebuild when signed out, nor a connection a deliberate stop() abandoned', async () => {
    const signedOut = createFakeTransport()
    signedOut.connection.subscribe('X', () => {})
    await signedOut.connection.start()
    clearTokens()
    signedOut.latest().triggerClose()
    await flush()
    expect(signedOut.fakes).toHaveLength(1)

    setTokens({ token: 'token-exercise-A' })
    const stopped = createFakeTransport()
    stopped.connection.subscribe('X', () => {})
    await stopped.connection.start()
    await stopped.connection.stop()
    await flush()
    expect(stopped.fakes).toHaveLength(1)
  })

  it('a listener that restarts synchronously on the close owns the restart: one new connection', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    transport.connection.onStateChange(state => {
      if (state === HubConnectionState.Disconnected) void transport.connection.start().catch(() => {})
    })

    transport.latest().triggerClose()
    await flush()

    expect(transport.fakes).toHaveLength(2)
    expect(transport.fakes[0]?.startCallCount).toBe(1) // the dead connection was not revived
    expect(transport.latest().startCallCount).toBe(1)
  })

  it('a late frame from the dead connection after the rebuild reaches nobody', async () => {
    const transport = createFakeTransport()
    const received: unknown[] = []
    transport.connection.subscribe('PostReceived', p => received.push(p))
    await transport.connection.start()
    const dead = transport.latest()

    dead.triggerClose()
    await flush()
    dead.emit('PostReceived', 'late-from-dead')
    transport.latest().emit('PostReceived', 'from-rebuilt')

    expect(received).toEqual(['from-rebuilt'])
  })

  it('a failed rebuild that a stop()/resume() overtook does not announce a reasonless loss', async () => {
    let hold: { fail: () => void } | undefined
    const transport = createFakeTransport((fake, index) => {
      if (index === 1) hold = fake.holdStart()
    })
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    const seen = observe(transport)

    transport.latest().triggerClose() // rebuild started, held
    await flush()
    expect(reasonlessLoss(seen)).toBe(1) // the close itself
    void transport.connection.stop('scope-changed') // the switch overtakes the rebuild
    await transport.connection.resume() // and starts its own connection
    hold?.fail() // now the overtaken rebuild's start fails
    await flush()

    expect(reasonlessLoss(seen)).toBe(1)
    expect(transport.latest().state).toBe(HubConnectionState.Connected)
  })
})
