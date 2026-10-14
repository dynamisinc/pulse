/**
 * core/realtime/connection.sessionReset.test.ts
 * ---------------------------------------------------------------------------
 * The shared hub connection belongs to ONE identity for its whole life (the server joins it to
 * the `exercise:{id}` and role groups once, from the token presented at connect). So whenever
 * the identity on a tab changes without a reload, the client must stop it (COR-001):
 *   - sign-out (`endSession()`), and
 *   - every sign-in (`resetClientSession()`, which `completeSignIn` calls).
 *
 * This file pins the WIRING, not the stop logic (that is `connection.test.ts`):
 *   1. `resetClientSession()` and `endSession()` stop the shared `realtimeConnection`;
 *   2. they do it THROUGH THE REGISTRY (`core/auth/sessionReset`): running the registry alone
 *      is enough, and nothing in `core/auth` imports `core/realtime`, so the layering the
 *      registry exists to protect stays intact;
 *   3. a stop that somehow fails cannot break the reset (the other resets and the logout that
 *      follows still happen).
 *
 * `realtimeConnection.stop` is spied rather than faked: the singleton builds a real
 * `HubConnection` on first use, which a unit test must not do.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { endSession, resetClientSession } from '@/core/auth'
import { runSessionResets } from '@/core/auth/sessionReset'
import { clearTokens, setTokens } from '@/core/auth/tokenStore'
import { realtimeConnection } from './connection'

let stopSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stopSpy = vi.spyOn(realtimeConnection, 'stop').mockResolvedValue(undefined)
})

afterEach(() => {
  stopSpy.mockRestore()
  clearTokens()
})

describe('the shared connection is stopped when the session ends', () => {
  it('resetClientSession() (every sign-in, and sign-out) stops it exactly once', () => {
    resetClientSession()

    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  it('endSession() (sign-out) stops it', async () => {
    setTokens({ token: 'identity-A' })

    await endSession()

    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  it('runs through the registry alone: runSessionResets() is enough', () => {
    runSessionResets()

    expect(stopSpy).toHaveBeenCalledTimes(1)
  })

  it('a stop that throws cannot break the reset', () => {
    stopSpy.mockImplementation(() => {
      throw new Error('boom')
    })

    expect(() => resetClientSession()).not.toThrow()
  })
})

/** Every non-test source file of `core/auth`, as raw text. */
const authSources = import.meta.glob(['../auth/*.{ts,tsx}', '!../auth/*.test.{ts,tsx}'], {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>

describe('core/auth stays free of core/realtime (the registry is what keeps it so)', () => {
  it('scans a real set of files (cannot pass vacuously)', () => {
    expect(Object.keys(authSources)).toContain('../auth/endSession.ts')
    expect(Object.keys(authSources)).toContain('../auth/sessionReset.ts')
  })

  it('no non-test file in core/auth imports core/realtime', () => {
    const importers = Object.entries(authSources)
      .filter(([, text]) => /from\s+['"][^'"]*realtime[^'"]*['"]/.test(text))
      .map(([name]) => name)

    expect(importers).toEqual([])
  })
})
