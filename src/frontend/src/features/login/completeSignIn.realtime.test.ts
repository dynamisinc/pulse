/**
 * features/login/completeSignIn.realtime.test.ts
 * ---------------------------------------------------------------------------
 * Every way into the app finishes through `completeSignIn` (store the new pair, forget the
 * previous identity, navigate), and every way OUT through `endSession`. Both must end the shared
 * hub connection (COR-001): the server joined it to the previous identity's exercise and role
 * groups once, at connect, from the token presented then, so a connection that survives an
 * identity switch on the tab keeps delivering the PREVIOUS exercise to the new identity.
 *
 * Pinned here, with the real token store and the real `resetClientSession`:
 *  1. ORDER, on the real app-wide singleton: the new pair is stored, THEN the shared connection
 *     is stopped, THEN the caller navigates - i.e. the old connection is gone before any consumer
 *     of the new identity can mount and start. (Spied: the singleton builds a real SignalR
 *     connection on first use, which a unit test must not do.)
 *  2. THE WHOLE SWITCH, on the real wrapper over a fake transport registered the way
 *     `connection.ts` registers the singleton: identity A is connected with a handler; sign-in as
 *     B stops A's connection at once (A's frames reach nobody), and the consumer that starts after
 *     the navigation gets a NEW connection on B's token with the handler still attached.
 *  3. SIGN-OUT THEN SIGN-IN (the shared-kiosk case): each end of a session stops whatever is
 *     live, and the next sign-in starts clean.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession, getAccessToken } from '@/core/auth'
import { registerSessionReset } from '@/core/auth/sessionReset'
import { HubConnectionState, realtimeConnection } from '@/core/realtime/connection'
import { queryClient as sharedQueryClient } from '@/core/services/queryClient'
import { createFakeTransport } from '@/test/fakeHubConnection'
import { completeSignIn } from './completeSignIn'

vi.mock('@/core/services/api', () => ({ api: { get: vi.fn(), post: vi.fn() } }))

const IDENTITY_A = { token: 'identity-A-access', refreshToken: 'identity-A-refresh' }
const IDENTITY_B = { token: 'identity-B-access', refreshToken: 'identity-B-refresh' }

/** Unregisters the fake transport's session reset, whatever the test body did (Gate-1 L-3). */
let unregisterFakeReset: (() => void) | undefined

beforeEach(() => {
  sessionStorage.clear()
  localStorage.clear()
  sharedQueryClient.clear()
})

afterEach(() => {
  unregisterFakeReset?.()
  unregisterFakeReset = undefined
  vi.restoreAllMocks()
})

describe('completeSignIn - the app-wide shared connection', () => {
  it('stores the new pair, then stops the shared connection, then navigates', () => {
    const order: string[] = []
    vi.spyOn(realtimeConnection, 'stop').mockImplementation(() => {
      order.push(`stop (token on the tab: ${getAccessToken()})`)
      return Promise.resolve()
    })

    completeSignIn(IDENTITY_B, {
      persist: false,
      navigate: () => { order.push('navigate') },
    })

    expect(order).toEqual(['stop (token on the tab: identity-B-access)', 'navigate'])
  })

  it('every sign-in path stops it, whichever store the pair goes to', () => {
    const stop = vi.spyOn(realtimeConnection, 'stop').mockResolvedValue(undefined)

    completeSignIn(IDENTITY_A, { persist: true, navigate: vi.fn() }) // a participant
    completeSignIn(IDENTITY_B, { persist: false, navigate: vi.fn() }) // staff

    expect(stop).toHaveBeenCalledTimes(2)
  })
})

describe('completeSignIn - an identity switch on a live connection', () => {
  function connectAs() {
    const transport = createFakeTransport()
    unregisterFakeReset = registerSessionReset(() => {
      void transport.connection.stop()
    })
    return transport
  }

  it('A\'s connection is stopped before B\'s consumers start, and B gets its own on B\'s token', async () => {
    completeSignIn(IDENTITY_A, { persist: true, navigate: vi.fn() })
    const { connection, fakes } = connectAs()
    const delivered: unknown[] = []
    connection.subscribe('PostReceived', payload => delivered.push(payload)) // a consumer of A
    await connection.start()
    expect(fakes[0]?.startedWithToken).toBe('identity-A-access')

    // B signs in on the same tab. The navigation is when B's consumers mount and start.
    const atNavigation: { oldStopped: boolean, oldState?: HubConnectionState } = {
      oldStopped: false,
    }
    completeSignIn(IDENTITY_B, {
      persist: true,
      navigate: () => {
        atNavigation.oldStopped = fakes[0]?.stopCallCount === 1
        atNavigation.oldState = fakes[0]?.state
        void connection.start() // B's first consumer
      },
    })
    await connection.start()

    expect(atNavigation.oldStopped).toBe(true) // gone before B's consumers ran
    expect(atNavigation.oldState).not.toBe(HubConnectionState.Connected)
    expect(fakes).toHaveLength(2)
    expect(fakes[1]?.startedWithToken).toBe('identity-B-access')
    expect(connection.state).toBe(HubConnectionState.Connected)

    // A's exercise can no longer reach B; B's does, through the handler that survived.
    fakes[0]?.emit('PostReceived', 'a post from identity A\'s exercise')
    fakes[1]?.emit('PostReceived', 'a post from identity B\'s exercise')
    expect(delivered).toEqual(['a post from identity B\'s exercise'])

  })

  it('sign-out then sign-in as someone else: each end of a session stops what is live', async () => {
    completeSignIn(IDENTITY_A, { persist: true, navigate: vi.fn() })
    const { connection, fakes } = connectAs()
    await connection.start()

    await endSession() // sign-out
    expect(fakes[0]?.stopCallCount).toBe(1)
    expect(connection.state).toBe(HubConnectionState.Disconnected)
    expect(getAccessToken()).toBeNull()

    completeSignIn(IDENTITY_B, { persist: true, navigate: vi.fn() }) // the next person
    await connection.start()

    expect(fakes[0]?.stopCallCount).toBe(1) // the first connection was not stopped twice
    expect(fakes[1]?.startedWithToken).toBe('identity-B-access')
    expect(connection.state).toBe(HubConnectionState.Connected)

  })
})
