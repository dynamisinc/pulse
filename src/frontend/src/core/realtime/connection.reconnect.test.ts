/**
 * core/realtime/connection.reconnect.test.ts
 * ---------------------------------------------------------------------------
 * #856: the staff console's hub connection after the session's principal changes WITHOUT a
 * sign-in (an exercise switch), and after a terminal close that is not a sign-out.
 *
 * The server (ASP.NET Core servicing update) returns 403 to a long-poll/SSE request whose user
 * differs from its negotiate request, so a connection left running through a switch goes quiet.
 * Asserted against the REAL wrapper over fake hub connections (`@/test/fakeHubConnection`):
 *  - `reconnect()` abandons the live connection and starts a new one on the CURRENT token with
 *    handlers re-attached; it does nothing when nothing was started or subscribed;
 *  - a terminal close rebuilds ONCE with the current token, recovers when that works, and does
 *    NOT loop when the hub keeps refusing (no reconnect storm); a good connect refills the budget;
 *  - no rebuild when signed out (no token stored).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HubConnectionState } from './connection'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { createFakeTransport } from '@/test/fakeHubConnection'

const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0))

beforeEach(() => {
  setTokens({ token: 'token-exercise-A' })
})
afterEach(() => {
  clearTokens()
})

describe('reconnect() - exercise switch', () => {
  it('stops the old connection and starts a new one on the current token, handlers intact', async () => {
    const transport = createFakeTransport()
    const received: unknown[] = []
    transport.connection.subscribe('PostReceived', p => received.push(p))
    await transport.connection.start()
    const [first] = transport.fakes
    expect(first?.startedWithToken).toBe('token-exercise-A')

    setTokens({ token: 'token-exercise-B' })
    await transport.connection.reconnect()
    await flush()

    expect(first?.stopCallCount).toBe(1)
    expect(transport.fakes).toHaveLength(2)
    const second = transport.latest()
    expect(second.startedWithToken).toBe('token-exercise-B')
    expect(transport.connection.state).toBe(HubConnectionState.Connected)
    second.emit('PostReceived', 'hello')
    expect(received).toEqual(['hello'])
    first?.emit('PostReceived', 'late-from-old')
    expect(received).toEqual(['hello'])
  })

  it('does nothing when nothing was started or subscribed', async () => {
    const transport = createFakeTransport()
    await transport.connection.reconnect()
    expect(transport.fakes).toHaveLength(0)
  })

  it('never rejects when the new connection cannot start', async () => {
    const transport = createFakeTransport((fake, index) => {
      if (index === 1) fake.startImpl = () => Promise.reject(new Error('403'))
    })
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    await expect(transport.connection.reconnect()).resolves.toBeUndefined()
    await flush()
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
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

  it('does not storm: a hub that keeps refusing gets one rebuild, then the loss is announced', async () => {
    const transport = createFakeTransport((fake, index) => {
      if (index >= 1) fake.startImpl = () => Promise.reject(new Error('403'))
    })
    const states: HubConnectionState[] = []
    transport.connection.onStateChange(s => states.push(s))
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()

    transport.latest().triggerClose()
    await flush()
    await flush()

    expect(transport.fakes).toHaveLength(2) // original + exactly one rebuild
    expect(transport.latest().startCallCount).toBe(1)
    expect(states.filter(s => s === HubConnectionState.Disconnected).length).toBeGreaterThan(0)
    expect(transport.connection.state).toBe(HubConnectionState.Disconnected)
  })

  it('refills the budget after a successful connect', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    transport.latest().triggerClose()
    await flush()
    expect(transport.fakes).toHaveLength(2)

    transport.latest().triggerClose()
    await flush()
    expect(transport.fakes).toHaveLength(3)
  })

  it('does not rebuild when signed out', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()
    clearTokens()

    transport.latest().triggerClose()
    await flush()

    expect(transport.fakes).toHaveLength(1)
  })

  it('does not rebuild a connection a deliberate stop() abandoned', async () => {
    const transport = createFakeTransport()
    transport.connection.subscribe('X', () => {})
    await transport.connection.start()

    await transport.connection.stop()
    await flush()

    expect(transport.fakes).toHaveLength(1)
  })
})
